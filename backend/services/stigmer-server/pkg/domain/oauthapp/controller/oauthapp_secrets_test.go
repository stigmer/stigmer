package oauthapp

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	oauthsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/oauthapp/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// appCtx simulates the apiresource interceptor, which injects the RPC's
// resource kind into the request context in production.
func appCtx() context.Context {
	return context.WithValue(context.Background(),
		apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_oauth_app)
}

type testHarness struct {
	store      store.Store
	controller *OAuthAppController
	secrets    *encryption.SecretService
}

// newTestHarness builds a controller over a real sqlite store with a real
// 32-byte key so encrypt/redact round-trips are exercised for real (the
// channelapp harness shape).
func newTestHarness(t *testing.T) *testHarness {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	secrets, err := encryption.NewSecretService([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}

	return &testHarness{
		store:      s,
		controller: NewOAuthAppController(s, secrets),
		secrets:    secrets,
	}
}

func newOAuthApp(name, org string) *oauthappv1.OAuthApp {
	return &oauthappv1.OAuthApp{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "OAuthApp",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
		},
		Spec: &oauthappv1.OAuthAppSpec{
			Provider:         "github",
			ClientId:         "client-id-1234",
			ClientSecret:     "shh-client-secret",
			AuthorizationUrl: "https://github.com/login/oauth/authorize",
			TokenUrl:         "https://github.com/login/oauth/access_token",
		},
	}
}

// TestCreateRejectsCiphertextShapedClientSecret pins the oss#395 boundary:
// a client-supplied enc:v<N>: client_secret must be refused with
// INVALID_ARGUMENT, never stored verbatim (where a later decrypt would
// treat it as genuine deployment-key ciphertext).
func TestCreateRejectsCiphertextShapedClientSecret(t *testing.T) {
	h := newTestHarness(t)

	for _, smuggled := range []string{
		"enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=",
		"enc:v2:ZnV0dXJlLXZlcnNpb24=", // whole family, not just v1
	} {
		app := newOAuthApp("Acme GitHub App", "acme")
		app.Spec.ClientSecret = smuggled

		_, err := h.controller.Create(appCtx(), app)
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("create with client_secret %q: expected InvalidArgument, got %v", smuggled, err)
		}
	}
}

func TestUpdateRejectsCiphertextShapedClientSecret(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Create(appCtx(), newOAuthApp("Acme GitHub App", "acme"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	update := newOAuthApp("Acme GitHub App", "acme")
	update.Metadata.Id = created.GetMetadata().GetId()
	update.Metadata.Slug = created.GetMetadata().GetSlug()
	update.Spec.ClientSecret = "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ="

	if _, err := h.controller.Update(appCtx(), update); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for ciphertext-shaped client_secret on update, got %v", err)
	}
}

// The rejection is unconditional: it must fire on a keyless deployment
// too, or a deployment that later gains a key would wake up holding
// smuggled "ciphertext".
func TestKeylessCreateStillRejectsCiphertextShapedClientSecret(t *testing.T) {
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	keyless, _ := encryption.NewSecretService(nil)
	controller := NewOAuthAppController(s, keyless)

	app := newOAuthApp("Acme GitHub App", "acme")
	app.Spec.ClientSecret = "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ="

	if _, err := controller.Create(appCtx(), app); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument on keyless deployment, got %v", err)
	}
}

// TestApplyRoundTripsWithMarker pins the arm ordering the rejection must
// not break: get returns the ***REDACTED*** marker, applying it back
// preserves the STORED ciphertext — which is enc:v1:-shaped by definition
// and must be restored by the marker arm before the prefix arm can see it.
func TestApplyRoundTripsWithMarker(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Apply(appCtx(), newOAuthApp("Acme GitHub App", "acme"))
	if err != nil {
		t.Fatalf("apply-create failed: %v", err)
	}
	if created.GetSpec().GetClientSecret() != oauthsteps.RedactedMarker {
		t.Fatalf("client_secret must be redacted in responses, got %q",
			created.GetSpec().GetClientSecret())
	}

	fetched, err := h.controller.Get(appCtx(), &apiresource.ApiResourceId{
		Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if _, err := h.controller.Apply(appCtx(), fetched); err != nil {
		t.Fatalf("apply-update with redacted secret failed: %v", err)
	}

	stored := &oauthappv1.OAuthApp{}
	if err := h.store.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_oauth_app,
		created.GetMetadata().GetId(), stored); err != nil {
		t.Fatalf("stored app not found: %v", err)
	}
	if !h.secrets.IsEncrypted(stored.GetSpec().GetClientSecret()) {
		t.Errorf("stored client_secret must be encrypted, got %q",
			stored.GetSpec().GetClientSecret())
	}
	if h.secrets.MustDecrypt(stored.GetSpec().GetClientSecret()) != "shh-client-secret" {
		t.Error("apply round-trip must preserve the original client_secret")
	}
}
