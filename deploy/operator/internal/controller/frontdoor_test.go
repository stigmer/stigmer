// Pins the front door and the bundled sign-in against a real API server,
// with cert-manager's and Gateway API's definitions stubbed, no controllers
// running, and Keycloak's admin API in memory (keycloaktest):
//
//   - an Ingress front door whose certificate cert-manager has not issued
//     waits, relaying cert-manager's words, while status.url already names
//     the public URL; once the Certificate is Ready, the front door is;
//   - switching to a Gateway removes the Ingresses, waits for the Gateway's
//     controller to take the routes, refuses in its words when it does not,
//     and is Ready once the routes are accepted and the listener programmed;
//   - the bundled sign-in mints its Secrets, runs Keycloak, converges the
//     realm and creates the owner, says where the one-time password is, and
//     once the owner has replaced it deletes the setup Secret and opens
//     sign-up to the declared domains.

package controller

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/keycloak/keycloaktest"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func liveObject(t *testing.T, apiVersion, kind, ns, name string) *unstructured.Unstructured {
	t.Helper()
	u := &unstructured.Unstructured{}
	u.SetAPIVersion(apiVersion)
	u.SetKind(kind)
	err := k8s.Get(context.Background(), client.ObjectKey{Namespace: ns, Name: name}, u)
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func setStatus(t *testing.T, u *unstructured.Unstructured, status map[string]any) {
	t.Helper()
	u.Object["status"] = status
	if err := k8s.Update(context.Background(), u); err != nil {
		t.Fatal(err)
	}
}

func condition(kind, status, reason, message string) map[string]any {
	return map[string]any{"type": kind, "status": status, "reason": reason, "message": message,
		"lastTransitionTime": "2026-11-20T00:00:00Z"}
}

func TestTheFrontDoorIsReadyOnlyWithItsCertificate(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	createIgnoringExisting(t, stubCRD("cert-manager.io", "certificates", "Certificate", nil))
	createIgnoringExisting(t, stubCRD("cert-manager.io", "issuers", "Issuer", nil))
	for _, kind := range []struct{ plural, kind string }{{"httproutes", "HTTPRoute"}, {"gateways", "Gateway"}} {
		crd := stubCRD("gateway.networking.k8s.io", kind.plural, kind.kind, nil)
		// A *.k8s.io group's definitions carry the approval Gateway API's own carry.
		crd.SetAnnotations(map[string]string{"api-approved.kubernetes.io": "https://github.com/kubernetes-sigs/gateway-api/pull/1538"})
		createIgnoringExisting(t, crd)
	}

	s := stigmer(ns, "stigmer")
	s.Spec.Server.AllowUnauthenticatedExposure = true
	s.Spec.Ingress = &stigmerv1.IngressSpec{
		Hostname: "stigmer.acme.dev",
		TLS:      &stigmerv1.IngressTLSSpec{Issuer: &stigmerv1.IssuerReference{Name: "letsencrypt", Kind: "ClusterIssuer"}},
	}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	r := &StigmerReconciler{Client: k8s, Reader: k8s, Components: []component.Component{component.FrontDoor{}}}

	got := reconcileOnce(t, r, s)
	fd := componentStatus(got, render.ComponentFrontDoor)
	if fd == nil || fd.Phase != stigmerv1.PhasePending || fd.Reason != stigmerv1.ReasonCertificatePending {
		t.Fatalf("before the certificate: %+v", fd)
	}
	if got.Status.URL != "https://stigmer.acme.dev" {
		t.Errorf("status.url %q while the certificate waits", got.Status.URL)
	}
	var ing networkingv1.Ingress
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.FrontDoorIngress(s)}, &ing); err != nil {
		t.Fatalf("no Ingress: %v", err)
	}
	if ing.Spec.TLS[0].SecretName != render.FrontDoorTLSSecret(s) || ing.Spec.Rules[0].Host != "stigmer.acme.dev" {
		t.Errorf("Ingress %+v", ing.Spec)
	}
	cert := liveObject(t, "cert-manager.io/v1", "Certificate", ns, render.FrontDoorCertificate(s))
	if cert == nil {
		t.Fatal("no Certificate")
	}
	setStatus(t, cert, map[string]any{"conditions": []any{condition("Ready", "False", "DoesNotExist", "Issuing certificate as Secret does not exist")}})
	fd = componentStatus(reconcileOnce(t, r, s), render.ComponentFrontDoor)
	if fd.Phase != stigmerv1.PhasePending || !strings.Contains(fd.Message, "Issuing certificate as Secret does not exist") {
		t.Fatalf("cert-manager's words are not relayed: %+v", fd)
	}
	cert = liveObject(t, "cert-manager.io/v1", "Certificate", ns, render.FrontDoorCertificate(s))
	setStatus(t, cert, map[string]any{"conditions": []any{condition("Ready", "True", "Ready", "Certificate is up to date")}})
	fd = componentStatus(reconcileOnce(t, r, s), render.ComponentFrontDoor)
	if fd.Phase != stigmerv1.PhaseReady || !strings.Contains(fd.Message, "https://stigmer.acme.dev serves the console") {
		t.Fatalf("with the certificate: %+v", fd)
	}

	// The Gateway arm.
	if err := k8s.Get(ctx, client.ObjectKeyFromObject(s), s); err != nil {
		t.Fatal(err)
	}
	s.Spec.Ingress.TLS = nil
	s.Spec.Ingress.GatewayRef = &stigmerv1.GatewayReference{Name: "public", Namespace: ns}
	if err := k8s.Update(ctx, s); err != nil {
		t.Fatal(err)
	}
	fd = componentStatus(reconcileOnce(t, r, s), render.ComponentFrontDoor)
	if fd.Phase != stigmerv1.PhasePending || fd.Reason != stigmerv1.ReasonFrontDoorPending {
		t.Fatalf("routes not yet taken: %+v", fd)
	}
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.FrontDoorIngress(s)}, &ing); !apierrors.IsNotFound(err) {
		t.Errorf("the Ingress outlived the switch to a Gateway: %v", err)
	}
	route := liveObject(t, render.GatewayAPIVersion, render.HTTPRouteKind, ns, render.FrontDoorRoute(s))
	parent := func(accepted string) map[string]any {
		return map[string]any{"parents": []any{map[string]any{
			"parentRef":      map[string]any{"name": "public", "namespace": ns},
			"controllerName": "example.com/gateway",
			"conditions": []any{
				condition("Accepted", accepted, "NotAllowedByListeners", "no listener allows routes from this namespace"),
				condition("ResolvedRefs", "True", "ResolvedRefs", "resolved"),
			},
		}}}
	}
	setStatus(t, route, parent("False"))
	fd = componentStatus(reconcileOnce(t, r, s), render.ComponentFrontDoor)
	if fd.Phase != stigmerv1.PhaseRefused || fd.Reason != stigmerv1.ReasonGatewayNotAccepted || !strings.Contains(fd.Message, "no listener allows routes") {
		t.Fatalf("a refused route: %+v", fd)
	}
	route = liveObject(t, render.GatewayAPIVersion, render.HTTPRouteKind, ns, render.FrontDoorRoute(s))
	setStatus(t, route, parent("True"))
	gw := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": render.GatewayAPIVersion, "kind": render.GatewayKind,
		"metadata": map[string]any{"name": "public", "namespace": ns},
		"spec": map[string]any{"listeners": []any{map[string]any{
			"name": "https", "protocol": "HTTPS", "port": int64(443), "hostname": "*.acme.dev",
			"tls": map[string]any{"certificateRefs": []any{map[string]any{"name": "wildcard"}}},
		}}},
	}}
	if err := k8s.Create(ctx, gw); err != nil {
		t.Fatal(err)
	}
	setStatus(t, gw, map[string]any{"listeners": []any{map[string]any{"name": "https", "conditions": []any{condition("Programmed", "True", "Programmed", "")}}}})
	fd = componentStatus(reconcileOnce(t, r, s), render.ComponentFrontDoor)
	if fd.Phase != stigmerv1.PhaseReady || !strings.Contains(fd.Message, "through Gateway") {
		t.Fatalf("an accepted route on a programmed listener: %+v", fd)
	}
}

func TestTheBundledSignInCreatesTheOwnerAndOpensSignUpAfterThem(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	createIgnoringExisting(t, &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "mail"},
		Data: map[string][]byte{"username": []byte("u"), "password": []byte("p")}})

	s := stigmer(ns, "stigmer")
	s.Spec.Owner = &stigmerv1.OwnerSpec{Email: "Priya@acme.dev"}
	s.Spec.Ingress = &stigmerv1.IngressSpec{Hostname: "stigmer.acme.dev", TLS: &stigmerv1.IngressTLSSpec{SecretName: "tls"}}
	s.Spec.Identity = &stigmerv1.IdentitySpec{Bundled: &stigmerv1.BundledIdentitySpec{
		SignUp: &stigmerv1.SignUpSpec{EmailDomains: []string{"acme.dev"}},
		SMTP:   &stigmerv1.SMTPSpec{Host: "mail", From: "stigmer@acme.dev", SecretName: "mail"},
	}}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}

	var fake *keycloaktest.Fake
	identity := component.Identity{Endpoint: func(*stigmerv1.Stigmer) string { return fake.URL }}
	res, err := identity.Reconcile(ctx, env)
	if err != nil {
		t.Fatal(err)
	}
	if res.Phase != stigmerv1.PhaseDeploying {
		t.Fatalf("before Keycloak runs: %+v", res)
	}
	var admin corev1.Secret
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.KeycloakAdminSecret(s)}, &admin); err != nil {
		t.Fatalf("no admin Secret: %v", err)
	}
	fake = keycloaktest.New(string(admin.Data["username"]), string(admin.Data["password"]))
	defer fake.Close()

	var kc appsv1.Deployment
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.KeycloakDeployment(s)}, &kc); err != nil {
		t.Fatalf("no Keycloak Deployment: %v", err)
	}
	kc.Status.Replicas, kc.Status.AvailableReplicas, kc.Status.ReadyReplicas, kc.Status.ObservedGeneration = 1, 1, 1, kc.Generation
	if err := k8s.Status().Update(ctx, &kc); err != nil {
		t.Fatal(err)
	}

	res, err = identity.Reconcile(ctx, env)
	if err != nil {
		t.Fatal(err)
	}
	if res.Phase != stigmerv1.PhaseReady || !strings.Contains(res.Message, component.OwnerSetupHint) {
		t.Fatalf("with Keycloak up: %+v", res)
	}
	owner := fake.User("stigmer", "priya@acme.dev")
	if owner == nil {
		t.Fatal("the owner's account was not created")
	}
	if fake.Realm("stigmer")["registrationAllowed"] != false {
		t.Error("sign-up is open before the owner signed in")
	}

	owner["requiredActions"] = []any{}
	res, err = identity.Reconcile(ctx, env)
	if err != nil {
		t.Fatal(err)
	}
	if res.Phase != stigmerv1.PhaseReady || !strings.Contains(res.Message, "sign-up is open to addresses at acme.dev") {
		t.Fatalf("after the owner: %+v", res)
	}
	var setup corev1.Secret
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.OwnerSetupSecret(s)}, &setup); !apierrors.IsNotFound(err) {
		t.Errorf("the one-time password outlived its use: %v", err)
	}
	smtp, _ := fake.Realm("stigmer")["smtpServer"].(map[string]any)
	if smtp["user"] != "u" || smtp["from"] != "stigmer@acme.dev" {
		t.Errorf("mail settings %v", smtp)
	}
}
