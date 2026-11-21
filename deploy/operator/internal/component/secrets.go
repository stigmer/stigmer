// Secrets the operator mints once and never rewrites, and the checks on
// Secrets an adopter names.
//
// A minted value is created, never applied: server-side apply would make the
// operator the owner of the data fields and put the value back on every
// pass, so a key someone rotated by hand would be silently reverted. Only a
// key that is missing is added. Every read goes through the uncached
// reader, because the cache holds only Secrets the operator labelled, and an
// adopter's Secrets carry no label of ours.

package component

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Password is 24 random bytes in URL-safe base64: no space, quote or plus,
// so it survives every connection string it is put in.
func Password() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("reading random bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// EnsureBasicAuthSecret creates a username and password Secret once, owned by
// the Stigmer.
func EnsureBasicAuthSecret(ctx context.Context, env *Env, name, username, component string) error {
	var existing corev1.Secret
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: env.Stigmer.Namespace, Name: name}, &existing)
	if err == nil {
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return fmt.Errorf("reading Secret %s: %w", name, err)
	}
	password, err := Password()
	if err != nil {
		return err
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       env.Stigmer.Namespace,
			Labels:          render.Labels(env.Stigmer, component),
			OwnerReferences: []metav1.OwnerReference{OwnerReference(env.Stigmer)},
		},
		Type: corev1.SecretTypeBasicAuth,
		Data: map[string][]byte{
			corev1.BasicAuthUsernameKey: []byte(username),
			corev1.BasicAuthPasswordKey: []byte(password),
		},
	}
	if err := env.Client.Create(ctx, secret); err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("creating Secret %s: %w", name, err)
	}
	return nil
}

// CheckSecretKeys reports, as a Refused result, a named Secret or one of its
// keys that does not exist; ok is true when all are there.
func CheckSecretKeys(ctx context.Context, env *Env, name, purpose string, keys ...string) (bool, Result, error) {
	ns := env.Stigmer.Namespace
	ref := Ref("Secret", ns, name)
	var secret corev1.Secret
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: ns, Name: name}, &secret)
	if apierrors.IsNotFound(err) {
		return false, Refused(stigmerv1.ReasonSecretMissing, ref,
			fmt.Sprintf("Secret %s does not exist in namespace %s: create it with %s under key %s", name, ns, purpose, keys[0])), nil
	}
	if err != nil {
		return false, Result{}, fmt.Errorf("reading Secret %s: %w", name, err)
	}
	for _, key := range keys {
		if len(secret.Data[key]) == 0 {
			return false, Refused(stigmerv1.ReasonSecretMissing, ref,
				fmt.Sprintf("Secret %s has no key %s: add %s under that key", name, key, purpose)), nil
		}
	}
	return true, Result{}, nil
}
