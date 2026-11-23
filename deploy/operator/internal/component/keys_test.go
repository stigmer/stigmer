// Pins that a minted key is one the server's loader accepts (canonical
// base64 of 32 bytes; base64 of a PEM RSA key of at least 2048 bits), and
// that the checks refuse each malformed shape in words. The payload key is
// minted only for an install with per-session sandboxes, added to an
// existing keys Secret, and never rewritten; the shared-runner key is minted
// once into its own Secret, long enough for the server, and reused.

package component

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func TestMintedKeysAreAccepted(t *testing.T) {
	for _, name := range append(KeyNames, render.PayloadKey) {
		v, err := MintKey(name)
		if err != nil {
			t.Fatal(err)
		}
		if why := ValidateKey(name, v); why != "" {
			t.Errorf("a minted %s is refused: %s", name, why)
		}
	}
	a, _ := MintKey(render.EncryptionKey)
	b, _ := MintKey(render.EncryptionKey)
	if string(a) == string(b) {
		t.Error("two minted keys are equal")
	}
}

func TestMalformedKeysAreRefused(t *testing.T) {
	short := base64.StdEncoding.EncodeToString(make([]byte, 16))
	small, _ := rsa.GenerateKey(rand.Reader, 1024)
	der := x509.MarshalPKCS1PrivateKey(small)
	weak := base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der}))
	cases := []struct{ name, value, says string }{
		{render.EncryptionKey, "not base64!", "not canonical base64"},
		{render.RunnerTokenKey, short, "16 bytes; the server needs exactly 32"},
		{render.PlatformTokenKey, base64.StdEncoding.EncodeToString([]byte("nope")), "does not decode to a PEM key"},
		{render.PlatformTokenKey, weak, "1024-bit RSA key"},
	}
	for _, c := range cases {
		if why := ValidateKey(c.name, []byte(c.value)); !strings.Contains(why, c.says) {
			t.Errorf("%s %q: got %q, want %q", c.name, c.value, why, c.says)
		}
	}
}

func TestPasswordsCarryNoCharacterAConnectionStringBreaksOn(t *testing.T) {
	for range 50 {
		p, err := Password()
		if err != nil {
			t.Fatal(err)
		}
		if strings.ContainsAny(p, " +/=%'\"@:") || len(p) < 30 {
			t.Errorf("password %q", p)
		}
	}
}

func perSessionStigmer() *stigmerv1.Stigmer {
	return &stigmerv1.Stigmer{
		ObjectMeta: metav1.ObjectMeta{Name: "stigmer", Namespace: "team", UID: "u1"},
		Spec: stigmerv1.StigmerSpec{
			ObjectStore: &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "b", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}},
			Sandboxes:   &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox},
		},
	}
}

func readSecret(t *testing.T, c client.Client, name string) *corev1.Secret {
	t.Helper()
	var s corev1.Secret
	if err := c.Get(context.Background(), client.ObjectKey{Namespace: "team", Name: name}, &s); err != nil {
		t.Fatalf("reading Secret %s: %v", name, err)
	}
	return &s
}

func TestThePayloadKeyIsMintedOnlyForPerSessionInstallsAndKept(t *testing.T) {
	ctx := context.Background()
	c := fake.NewClientBuilder().Build()
	shared := perSessionStigmer()
	shared.Spec.Sandboxes = nil
	if _, err := (Keys{}).Reconcile(ctx, &Env{Client: c, Reader: c, Stigmer: shared}); err != nil {
		t.Fatal(err)
	}
	keys := readSecret(t, c, "stigmer-keys")
	if _, ok := keys.Data[render.PayloadKey]; ok {
		t.Error("an install on the shared driver is minted a payload key")
	}
	first := keys.Data[render.EncryptionKey]

	// The same install moves to a per-session driver: the payload key is
	// added beside the keys it already has.
	st := perSessionStigmer()
	for range 2 {
		if res, err := (Keys{}).Reconcile(ctx, &Env{Client: c, Reader: c, Stigmer: st}); err != nil || res.Phase != stigmerv1.PhaseReady {
			t.Fatalf("%+v %v", res, err)
		}
	}
	keys = readSecret(t, c, "stigmer-keys")
	payload := keys.Data[render.PayloadKey]
	if why := ValidateKey(render.PayloadKey, payload); len(payload) == 0 || why != "" {
		t.Fatalf("the payload key is missing or refused: %q", why)
	}
	if string(keys.Data[render.EncryptionKey]) != string(first) {
		t.Error("adding the payload key rewrote another key")
	}
	if _, err := (Keys{}).Reconcile(ctx, &Env{Client: c, Reader: c, Stigmer: st}); err != nil {
		t.Fatal(err)
	}
	if again := readSecret(t, c, "stigmer-keys").Data[render.PayloadKey]; string(again) != string(payload) {
		t.Error("the payload key was rewritten on a later pass")
	}
}

func TestTheSharedRunnerKeyIsMintedOnceAndReused(t *testing.T) {
	ctx := context.Background()
	c := fake.NewClientBuilder().Build()
	env := &Env{Client: c, Reader: c, Stigmer: perSessionStigmer()}
	if err := ensureSharedRunnerKey(ctx, env); err != nil {
		t.Fatal(err)
	}
	s := readSecret(t, c, "stigmer-shared-runner-key")
	key := string(s.Data[render.SharedRunnerKeyKey])
	if len(key) < 32 || strings.ContainsAny(key, "+/=") {
		t.Errorf("the shared-runner key %d characters long, or not base64url: the server asks for at least 32", len(key))
	}
	if len(s.OwnerReferences) != 1 || s.OwnerReferences[0].UID != "u1" {
		t.Errorf("the shared-runner key is not owned by the Stigmer: %v", s.OwnerReferences)
	}
	if err := ensureSharedRunnerKey(ctx, env); err != nil {
		t.Fatal(err)
	}
	if again := string(readSecret(t, c, "stigmer-shared-runner-key").Data[render.SharedRunnerKeyKey]); again != key {
		t.Error("the shared-runner key was minted again")
	}
}
