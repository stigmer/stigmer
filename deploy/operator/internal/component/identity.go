// The identity component: how people sign in.
//
// With your own issuer (spec.identity.oidc) there is nothing to run; the
// server's settings carry it. With the bundled sign-in the component mints
// the operator's admin credential and the owner's one-time password, runs
// Keycloak on the bundled database, and converges the realm over Keycloak's
// admin API on every pass (internal/keycloak): the realm, the console's and
// the native apps' clients with Stigmer's audience, the owner's account, and
// sign-up, opened for the declared domains once the owner has replaced the
// one-time password. Once they have, the owner setup Secret is deleted, and
// the Ready sentence stops pointing at it.
//
// The admin API is reached at Keycloak's in-cluster Service; Endpoint
// replaces that address in tests.

package component

import (
	"context"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/keycloak"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// OwnerSetupHint is the phrase the identity component's Ready sentence
// carries while the owner's one-time password is unused; the Stigmer's Ready
// sentence then says where to read it.
const OwnerSetupHint = "with the one-time password"

// Identity is the identity component.
type Identity struct {
	// Endpoint is the sign-in's admin base URL; nil means its Service.
	Endpoint func(*stigmerv1.Stigmer) string
}

// Name implements Component.
func (Identity) Name() string { return render.ComponentIdentity }

// Dependencies implements Component.
func (Identity) Dependencies() []string { return []string{render.ComponentDatabase} }

// Reconcile implements Component.
func (i Identity) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	if !render.BundledIdentity(st) {
		if err := removeObject(ctx, env, corev1.SchemeGroupVersion.WithKind("Service"), render.KeycloakService(st)); err != nil {
			return Result{}, err
		}
		if err := removeObject(ctx, env, appsv1.SchemeGroupVersion.WithKind("Deployment"), render.KeycloakDeployment(st)); err != nil {
			return Result{}, err
		}
		if render.SignInOn(st) {
			return Ready(fmt.Sprintf("people sign in at your issuer %s", render.OIDC(st).Issuer)), nil
		}
		return Ready("sign-in is off: every caller acts as the owner"), nil
	}

	admin := render.KeycloakAdminSecret(st)
	if err := EnsureBasicAuthSecret(ctx, env, admin, render.OperatorClientID, render.ComponentIdentity); err != nil {
		return Result{}, err
	}
	var smtp *keycloak.SMTP
	if b := st.Spec.Identity; b != nil && b.Bundled != nil && b.Bundled.SMTP != nil {
		s := b.Bundled.SMTP
		smtp = &keycloak.SMTP{Host: s.Host, Port: s.Port, From: s.From, StartTLS: s.StartTLS}
		if smtp.Port == 0 {
			smtp.Port = 587
		}
		if s.SecretName != "" {
			ok, res, err := CheckSecretKeys(ctx, env, s.SecretName, "the mail server's user name and password", "username", "password")
			if err != nil || !ok {
				return res, err
			}
			user, password, err := secretPair(ctx, env, s.SecretName, "username", "password")
			if err != nil {
				return Result{}, err
			}
			smtp.User, smtp.Password = user, password
		}
	}

	if err := Apply(ctx, env, render.KeycloakServiceObject(st), render.KeycloakDeploymentObject(st)); err != nil {
		return Result{}, err
	}
	deployRef := Ref("Deployment", st.Namespace, render.KeycloakDeployment(st))
	ready, err := deploymentAvailable(ctx, env, render.KeycloakDeployment(st))
	if err != nil {
		return Result{}, err
	}
	if !ready {
		return Explain(ctx, env, render.SelectorLabels(st, render.ComponentIdentity), []string{"keycloak"},
			Deploying(stigmerv1.ReasonDeploying, deployRef, "waiting for the sign-in (Keycloak) to start"))
	}

	setup := render.OwnerSetupSecret(st)
	setupExists, err := ownerSetupExists(ctx, env)
	if err != nil {
		return Result{}, err
	}
	username, password, err := secretPair(ctx, env, admin, corev1.BasicAuthUsernameKey, corev1.BasicAuthPasswordKey)
	if err != nil {
		return Result{}, err
	}
	endpoint := render.KeycloakInternalURL(st)
	if i.Endpoint != nil {
		endpoint = i.Endpoint(st)
	}
	kc, err := keycloak.Login(ctx, endpoint, username, password)
	if err != nil {
		return Deploying(stigmerv1.ReasonRealmConverging, deployRef, "the sign-in is up but its admin API does not answer yet: "+err.Error()), nil
	}
	var domains []string
	if b := st.Spec.Identity; b != nil && b.Bundled != nil && b.Bundled.SignUp != nil {
		domains = b.Bundled.SignUp.EmailDomains
	}
	out, err := keycloak.Converge(ctx, kc, keycloak.Desired{
		Realm:           render.Realm,
		PublicURL:       render.PublicURL(st),
		Audience:        render.OIDC(st).Audience,
		ConsoleClientID: render.ConsoleClientID,
		NativeClientID:  render.NativeClientID,
		OwnerEmail:      strings.ToLower(st.Spec.Owner.Email),
		OwnerPassword:   func() (string, error) { return ownerSetupPassword(ctx, env) },
		SignUpDomains:   domains,
		SMTP:            smtp,
	})
	if err != nil {
		return Deploying(stigmerv1.ReasonRealmConverging, Ref("Deployment", st.Namespace, render.KeycloakDeployment(st)), err.Error()), nil
	}

	sentence := fmt.Sprintf("people sign in at %s", render.BundledIssuer(st))
	if !out.OwnerSignedIn {
		return Ready(fmt.Sprintf("%s; %s signs in first %s in Secret %s, then sets their own", sentence, st.Spec.Owner.Email, OwnerSetupHint, setup)), nil
	}
	if setupExists {
		if err := removeObject(ctx, env, corev1.SchemeGroupVersion.WithKind("Secret"), setup); err != nil {
			return Result{}, err
		}
	}
	switch {
	case out.SignUpOpen:
		sentence += fmt.Sprintf("; sign-up is open to addresses at %s", strings.Join(domains, ", "))
	case len(domains) == 0:
		sentence += "; only the owner signs in until spec.identity.bundled.signUp names your email domains"
	}
	return Ready(sentence), nil
}

// ownerSetupExists reports whether the Secret holding the owner's one-time
// password exists. It never mints one: a pass after the owner signed in
// only removes it.
func ownerSetupExists(ctx context.Context, env *Env) (bool, error) {
	st := env.Stigmer
	name := render.OwnerSetupSecret(st)
	var secret corev1.Secret
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, &secret)
	if err == nil {
		return true, nil
	}
	if apierrors.IsNotFound(err) {
		return false, nil
	}
	return false, fmt.Errorf("reading Secret %s: %w", name, err)
}

// ownerSetupPassword reads the owner's one-time password, minting the Secret
// that holds it. Converge calls it only while the owner's account does not
// exist yet.
func ownerSetupPassword(ctx context.Context, env *Env) (string, error) {
	st := env.Stigmer
	name := render.OwnerSetupSecret(st)
	var secret corev1.Secret
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, &secret)
	if err == nil {
		return string(secret.Data[render.OwnerSetupPasswordKey]), nil
	}
	if !apierrors.IsNotFound(err) {
		return "", fmt.Errorf("reading Secret %s: %w", name, err)
	}
	password, err := Password()
	if err != nil {
		return "", err
	}
	created := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       st.Namespace,
			Labels:          render.Labels(st, render.ComponentIdentity),
			OwnerReferences: []metav1.OwnerReference{OwnerReference(st)},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{render.OwnerSetupPasswordKey: []byte(password)},
	}
	if err := env.Client.Create(ctx, created); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return "", fmt.Errorf("creating Secret %s: %w", name, err)
		}
		// Another pass minted it first: use the password it holds.
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, &secret); err != nil {
			return "", fmt.Errorf("reading Secret %s: %w", name, err)
		}
		return string(secret.Data[render.OwnerSetupPasswordKey]), nil
	}
	return password, nil
}

// secretPair reads two keys of a Secret.
func secretPair(ctx context.Context, env *Env, name, a, b string) (string, string, error) {
	var secret corev1.Secret
	if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: env.Stigmer.Namespace, Name: name}, &secret); err != nil {
		return "", "", fmt.Errorf("reading Secret %s: %w", name, err)
	}
	return string(secret.Data[a]), string(secret.Data[b]), nil
}

// deploymentAvailable reports whether a Deployment has an available replica.
func deploymentAvailable(ctx context.Context, env *Env, name string) (bool, error) {
	var d appsv1.Deployment
	if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: env.Stigmer.Namespace, Name: name}, &d); err != nil {
		if apierrors.IsNotFound(err) {
			return false, nil
		}
		return false, fmt.Errorf("reading Deployment %s: %w", name, err)
	}
	return d.Status.AvailableReplicas > 0 && d.Status.ObservedGeneration >= d.Generation, nil
}
