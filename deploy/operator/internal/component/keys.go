// The keys component: the server's three keys, minted once into
// <name>-keys and never rewritten, and a fourth for an install that runs
// the computer-less runner.
//
// STIGMER_ENCRYPTION_KEY encrypts what the server stores (losing it loses
// every stored credential); STIGMER_RUNNER_TOKEN_KEY signs the tokens each
// run is handed; STIGMER_PLATFORM_TOKEN_KEY, an RSA key, signs the user
// tokens service accounts mint. STIGMER_PAYLOAD_ENCRYPTION_KEY seals what
// the computer-less runner and the server pass through Temporal, so
// Temporal's history, kept in the database, is readable only with it; it is
// minted only for an install with per-session sandboxes, and added to an
// existing Secret when an install moves to one. Each is in the exact form
// the server's key loader accepts (canonical base64 of 32 bytes; base64 of a
// PEM RSA key of at least 2048 bits), so a key the operator mints is never
// one the server refuses at boot.
//
// The Secret carries no owner reference. Deleting the Stigmer keeps it, a
// new Stigmer of the same name uses it, and a restore of the database is
// readable only with it, which is why the Ready sentence names it as the
// one thing to copy out of the cluster. A key that is present is never
// replaced; a malformed one is refused in words rather than overwritten.

package component

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Keys is the keys component.
type Keys struct{}

// Name implements Component.
func (Keys) Name() string { return render.ComponentKeys }

// Dependencies implements Component.
func (Keys) Dependencies() []string { return nil }

// KeyNames are the keys in every keys Secret, in the order they are minted.
var KeyNames = []string{render.EncryptionKey, render.RunnerTokenKey, render.PlatformTokenKey}

// KeyNamesFor are the keys in this Stigmer's keys Secret: KeyNames, and the
// payload key when the computer-less runner runs.
func KeyNamesFor(st *stigmerv1.Stigmer) []string {
	if !render.ComputerlessRunner(st) {
		return KeyNames
	}
	return append(append([]string{}, KeyNames...), render.PayloadKey)
}

// MintKey makes a new value for one key.
func MintKey(name string) ([]byte, error) {
	if name == render.PlatformTokenKey {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, fmt.Errorf("generating the platform token key: %w", err)
		}
		der, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return nil, fmt.Errorf("encoding the platform token key: %w", err)
		}
		block := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
		return []byte(base64.StdEncoding.EncodeToString(block)), nil
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("reading random bytes for %s: %w", name, err)
	}
	return []byte(base64.StdEncoding.EncodeToString(b)), nil
}

// ValidateKey says, in words, why a key's value would be refused by the
// server's loader, or returns "".
func ValidateKey(name string, value []byte) string {
	decoded, err := base64.StdEncoding.DecodeString(string(value))
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != string(bytes.TrimSpace(value)) {
		return fmt.Sprintf("%s is not canonical base64", name)
	}
	if name != render.PlatformTokenKey {
		if len(decoded) != 32 {
			return fmt.Sprintf("%s decodes to %d bytes; the server needs exactly 32", name, len(decoded))
		}
		return ""
	}
	block, _ := pem.Decode(decoded)
	if block == nil {
		return fmt.Sprintf("%s does not decode to a PEM key", name)
	}
	var parsed any
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		parsed = k
	} else if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		parsed = k
	} else {
		return fmt.Sprintf("%s is not a PKCS#8 or PKCS#1 private key", name)
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return fmt.Sprintf("%s is not an RSA key; the server signs with RS256", name)
	}
	if rsaKey.N.BitLen() < 2048 {
		return fmt.Sprintf("%s is a %d-bit RSA key; the server needs at least 2048 bits", name, rsaKey.N.BitLen())
	}
	return ""
}

// Reconcile implements Component.
func (Keys) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	name := render.KeysSecret(st)
	ref := Ref("Secret", st.Namespace, name)

	var secret corev1.Secret
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, &secret)
	if apierrors.IsNotFound(err) {
		data := map[string][]byte{}
		for _, key := range KeyNamesFor(st) {
			v, merr := MintKey(key)
			if merr != nil {
				return Result{}, merr
			}
			data[key] = v
		}
		created := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: st.Namespace, Labels: render.Labels(st, render.ComponentKeys)},
			Type:       corev1.SecretTypeOpaque,
			Data:       data,
		}
		if cerr := env.Client.Create(ctx, created); cerr != nil && !apierrors.IsAlreadyExists(cerr) {
			return Result{}, fmt.Errorf("creating Secret %s: %w", name, cerr)
		}
		return Ready(keepSentence(st)), nil
	}
	if err != nil {
		return Result{}, fmt.Errorf("reading Secret %s: %w", name, err)
	}

	missing := map[string][]byte{}
	for _, key := range KeyNamesFor(st) {
		value, ok := secret.Data[key]
		if !ok || len(value) == 0 {
			v, merr := MintKey(key)
			if merr != nil {
				return Result{}, merr
			}
			missing[key] = v
			continue
		}
		if why := ValidateKey(key, value); why != "" {
			return Refused(stigmerv1.ReasonConfigurationRefused, ref,
				fmt.Sprintf("Secret %s holds a key the server would refuse: %s. Restore the copy you kept, or delete the key to have a new one minted (data encrypted with the old one becomes unreadable)", name, why)), nil
		}
	}
	if len(missing) > 0 {
		before := secret.DeepCopy()
		if secret.Data == nil {
			// A Secret made with no data (`kubectl create secret generic`).
			secret.Data = map[string][]byte{}
		}
		for k, v := range missing {
			secret.Data[k] = v
		}
		if perr := env.Client.Patch(ctx, &secret, client.MergeFrom(before)); perr != nil {
			return Result{}, fmt.Errorf("adding keys to Secret %s: %w", name, perr)
		}
	}
	return Ready(keepSentence(st)), nil
}

func keepSentence(st *stigmerv1.Stigmer) string {
	keep := fmt.Sprintf("keys in Secret %s; keep a copy outside the cluster: what Stigmer stores is readable only with it", render.KeysSecret(st))
	if render.BackupsOn(st) {
		keep += "; a complete backup is the database's archive and the bucket's files, plus this Secret"
	}
	return keep
}
