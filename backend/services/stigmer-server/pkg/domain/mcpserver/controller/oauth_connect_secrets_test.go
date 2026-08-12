package mcpserver

// Tests for the pending_oauth_state at-rest sealing (oss#394; the OSS twin
// of stigmer-cloud#193 / cloud PR #294).
//
// The suite uses a real keyed SecretService over a real SQLite store —
// actual encrypt/decrypt round-trips and raw-row assertions, never mock
// echoes (the channelapp suite's precedent). The seal/unseal seams are
// exercised directly where the full RPC would need a live environment
// gRPC client; the vendor initiate path does no network I/O, so it is
// covered end-to-end through the controller.

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// A real 32-byte key so seal/unseal round-trips are exercised for real
// (mirrors the channelapp suite).
var oauthSecretsTestKey = []byte("0123456789abcdef0123456789abcdef")

type oauthSecretsHarness struct {
	controller   *McpServerController
	store        *sqlite.Store
	pendingStore *oauth.PendingOAuthStateStore
	secrets      *encryption.SecretService
}

// setupOAuthSecretsHarness wires a controller with the OAuth Connect
// dependencies the way server.go does: SQLite-backed stores plus the shared
// SecretService instance.
func setupOAuthSecretsHarness(t *testing.T, secrets *encryption.SecretService) *oauthSecretsHarness {
	t.Helper()

	st, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	pendingStore, err := oauth.NewPendingOAuthStateStore(st.DB())
	if err != nil {
		t.Fatalf("failed to create pending state store: %v", err)
	}
	grantStore, err := oauth.NewOAuthGrantStore(st.DB())
	if err != nil {
		t.Fatalf("failed to create grant store: %v", err)
	}

	controller := NewMcpServerController(st)
	controller.SetOAuthDependencies(grantStore, pendingStore, secrets, "http://127.0.0.1/oauth/callback")

	return &oauthSecretsHarness{
		controller:   controller,
		store:        st,
		pendingStore: pendingStore,
		secrets:      secrets,
	}
}

// saveVendorFixtures stores an OAuthApp (client secret encrypted at rest, as
// the oauthapp controller would persist it) and an McpServer whose auth block
// references it. Returns the McpServer ID and the OAuthApp's stored ciphertext.
func saveVendorFixtures(t *testing.T, h *oauthSecretsHarness, plainClientSecret string) (string, string) {
	t.Helper()
	ctx := context.Background()

	storedSecret := h.secrets.MustEncrypt(plainClientSecret)
	app := &oauthappv1.OAuthApp{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "oauthapp-testvendor",
			Name: "Test Vendor",
			Slug: "test-vendor",
			Org:  "test-org",
		},
		Spec: &oauthappv1.OAuthAppSpec{
			Provider:         "TestVendor",
			ClientId:         "client-123",
			ClientSecret:     storedSecret,
			AuthorizationUrl: "https://vendor.example.com/oauth/authorize",
			TokenUrl:         "https://vendor.example.com/oauth/token",
			Scopes:           []string{"read"},
		},
	}
	if err := h.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_oauth_app, app.GetMetadata().GetId(), app); err != nil {
		t.Fatalf("failed to save oauth app: %v", err)
	}

	mcpServerID := "mcpserver-vendor-test"
	mcpServer := createTestMcpServer("vendor-oauth-server")
	mcpServer.Metadata.Id = mcpServerID
	mcpServer.Spec.Auth = &mcpserverv1.McpServerAuth{
		OauthAppRef:  &apiresource.ApiResourceReference{Slug: "test-vendor"},
		TargetEnvVar: "VENDOR_TOKEN",
	}
	if err := h.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		t.Fatalf("failed to save mcp server: %v", err)
	}

	return mcpServerID, storedSecret
}

// readPendingRowRaw reads the pending row exactly as it rests in SQLite,
// bypassing the controllers — the at-rest truth the fix is about.
func readPendingRowRaw(t *testing.T, h *oauthSecretsHarness, state string) (codeVerifier, clientSecret string) {
	t.Helper()
	err := h.store.DB().QueryRow(
		`SELECT code_verifier, client_secret FROM pending_oauth_state WHERE state = ?`, state,
	).Scan(&codeVerifier, &clientSecret)
	if err != nil {
		t.Fatalf("failed to read pending row: %v", err)
	}
	return codeVerifier, clientSecret
}

// TestInitiateVendorOAuth_SealsPendingSecretsAtRest runs the vendor initiate
// path end-to-end (it does no network I/O) and asserts the row rests sealed.
func TestInitiateVendorOAuth_SealsPendingSecretsAtRest(t *testing.T) {
	secrets, err := encryption.NewSecretService(oauthSecretsTestKey)
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}
	h := setupOAuthSecretsHarness(t, secrets)
	const plainClientSecret = "super-secret-vendor-credential"
	mcpServerID, appStoredCiphertext := saveVendorFixtures(t, h, plainClientSecret)

	out, err := h.controller.InitiateOAuthConnect(context.Background(), &mcpserverv1.InitiateOAuthConnectInput{
		McpServerId: mcpServerID,
		Org:         "test-org",
	})
	if err != nil {
		t.Fatalf("InitiateOAuthConnect failed: %v", err)
	}

	restingVerifier, restingSecret := readPendingRowRaw(t, h, out.GetState())

	if !secrets.IsEncrypted(restingVerifier) {
		t.Errorf("code_verifier must rest sealed, got %q", restingVerifier)
	}
	if !secrets.IsEncrypted(restingSecret) {
		t.Errorf("client_secret must rest sealed, got %q", restingSecret)
	}

	// Snapshot, not alias: the pending row must carry its own ciphertext,
	// never the OAuthApp's stored value.
	if restingSecret == appStoredCiphertext {
		t.Error("pending row aliases the OAuthApp's stored ciphertext instead of holding its own snapshot")
	}

	if got := secrets.MustDecrypt(restingSecret); got != plainClientSecret {
		t.Errorf("sealed client_secret round-trip = %q, want %q", got, plainClientSecret)
	}

	// The sealed verifier must be THE verifier of this flow: its S256 hash
	// must match the code_challenge that went to the authorization server.
	authURL, err := url.Parse(out.GetAuthorizationUrl())
	if err != nil {
		t.Fatalf("failed to parse authorization URL: %v", err)
	}
	challenge := authURL.Query().Get("code_challenge")
	verifierHash := sha256.Sum256([]byte(secrets.MustDecrypt(restingVerifier)))
	if got := base64.RawURLEncoding.EncodeToString(verifierHash[:]); got != challenge {
		t.Errorf("sealed verifier does not match the flow's code_challenge: S256(verifier) = %q, challenge = %q", got, challenge)
	}
}

// TestSealPendingOAuthState covers the write seam directly: the DCR shape
// (empty client secret) and the disabled-encryption posture.
func TestSealPendingOAuthState(t *testing.T) {
	keyed, err := encryption.NewSecretService(oauthSecretsTestKey)
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}

	t.Run("DCR empty client secret stays empty", func(t *testing.T) {
		state := &oauth.PendingOAuthState{CodeVerifier: "verifier-abc", ClientSecret: ""}
		if err := sealPendingOAuthState(keyed, state); err != nil {
			t.Fatalf("seal failed: %v", err)
		}
		if !keyed.IsEncrypted(state.CodeVerifier) {
			t.Errorf("code_verifier must be sealed, got %q", state.CodeVerifier)
		}
		if state.ClientSecret != "" {
			t.Errorf("empty client_secret must stay empty (public client), got %q", state.ClientSecret)
		}
	})

	t.Run("disabled encryption passes plaintext through", func(t *testing.T) {
		// The deployment-wide posture when no key is configured (see the
		// channelapp resolveSecret step): plaintext with a WARN, not a refusal.
		disabled, err := encryption.NewSecretService(nil)
		if err != nil {
			t.Fatalf("failed to create disabled secret service: %v", err)
		}
		state := &oauth.PendingOAuthState{CodeVerifier: "verifier-abc", ClientSecret: "secret-xyz"}
		if err := sealPendingOAuthState(disabled, state); err != nil {
			t.Fatalf("seal failed: %v", err)
		}
		if state.CodeVerifier != "verifier-abc" || state.ClientSecret != "secret-xyz" {
			t.Errorf("disabled encryption must pass values through, got verifier=%q secret=%q",
				state.CodeVerifier, state.ClientSecret)
		}
	})

	t.Run("nil service passes plaintext through", func(t *testing.T) {
		state := &oauth.PendingOAuthState{CodeVerifier: "verifier-abc"}
		if err := sealPendingOAuthState(nil, state); err != nil {
			t.Fatalf("seal failed: %v", err)
		}
		if state.CodeVerifier != "verifier-abc" {
			t.Errorf("nil service must pass values through, got %q", state.CodeVerifier)
		}
	})
}

// TestUnsealPendingOAuthState covers the read seam directly: sealed rows,
// legacy plaintext rows, and corrupt ciphertext.
func TestUnsealPendingOAuthState(t *testing.T) {
	keyed, err := encryption.NewSecretService(oauthSecretsTestKey)
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}

	t.Run("sealed row yields original plaintexts", func(t *testing.T) {
		state := &oauth.PendingOAuthState{
			CodeVerifier: keyed.MustEncrypt("verifier-abc"),
			ClientSecret: keyed.MustEncrypt("secret-xyz"),
		}
		if err := unsealPendingOAuthState(keyed, state); err != nil {
			t.Fatalf("unseal failed: %v", err)
		}
		if state.CodeVerifier != "verifier-abc" || state.ClientSecret != "secret-xyz" {
			t.Errorf("unseal round-trip = verifier=%q secret=%q", state.CodeVerifier, state.ClientSecret)
		}
	})

	t.Run("legacy plaintext row passes through", func(t *testing.T) {
		// Rows written before the sealing release (or while encryption was
		// disabled) must still complete — the zero-downtime guarantee.
		state := &oauth.PendingOAuthState{CodeVerifier: "verifier-abc", ClientSecret: ""}
		if err := unsealPendingOAuthState(keyed, state); err != nil {
			t.Fatalf("unseal failed on legacy row: %v", err)
		}
		if state.CodeVerifier != "verifier-abc" || state.ClientSecret != "" {
			t.Errorf("legacy row must pass through, got verifier=%q secret=%q",
				state.CodeVerifier, state.ClientSecret)
		}
	})

	t.Run("corrupt ciphertext errors loudly", func(t *testing.T) {
		state := &oauth.PendingOAuthState{CodeVerifier: "enc:v1:%%%not-base64%%%"}
		if err := unsealPendingOAuthState(keyed, state); err == nil {
			t.Fatal("corrupt ciphertext must error, got nil")
		}
	})
}

// TestCompleteOAuthConnect_CorruptCiphertextFailsBeforeExchange pins the
// short-circuit ordering: a row that cannot be unsealed must never reach the
// vendor's token endpoint (ciphertext must not be sent as credentials).
func TestCompleteOAuthConnect_CorruptCiphertextFailsBeforeExchange(t *testing.T) {
	secrets, err := encryption.NewSecretService(oauthSecretsTestKey)
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}
	h := setupOAuthSecretsHarness(t, secrets)
	// Gives the controller a non-nil managedEnvService so CompleteOAuthConnect
	// passes its dependency checks; the flow must fail before any use of it.
	h.controller.SetConnectDependencies(nil, nil, nil, nil, nil)

	tokenEndpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("token endpoint must not be reached when the pending row cannot be unsealed")
	}))
	defer tokenEndpoint.Close()

	ctx := context.Background()
	const stateParam = "corrupt-row-state"
	if err := h.pendingStore.Save(ctx, &oauth.PendingOAuthState{
		State:         stateParam,
		CodeVerifier:  "enc:v1:%%%not-base64%%%",
		ClientID:      "client-123",
		TokenEndpoint: tokenEndpoint.URL,
		McpServerID:   "mcpserver-vendor-test",
		AuthMethod:    "vendor_oauth",
		RedirectURI:   "http://127.0.0.1/oauth/callback",
	}); err != nil {
		t.Fatalf("failed to save pending row: %v", err)
	}

	_, err = h.controller.CompleteOAuthConnect(ctx, &mcpserverv1.CompleteOAuthConnectInput{
		McpServerId:       "mcpserver-vendor-test",
		State:             stateParam,
		AuthorizationCode: "auth-code-123",
	})
	if err == nil {
		t.Fatal("CompleteOAuthConnect must fail on a corrupt row, got nil")
	}
	if !strings.Contains(err.Error(), "retry the connect flow") {
		t.Errorf("error must guide the user to re-initiate (the row is consumed), got: %v", err)
	}
}
