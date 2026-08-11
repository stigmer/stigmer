package mcpserver

// End-to-end pins for the DCR initiate pre-flight (oss#235): discovery →
// DCR → authorize probe, through the real controller against a fake
// authorization server. The blocked arm asserts the whole contract — code,
// user-facing copy, and that no pending state row is left behind. The
// fail-open arm pins that only HTTP 400 blocks (bot-protection 4xx/5xx must
// pass through), reusing the classification proven unit-level in
// oauth/preflight_test.go.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fakeAuthServer is a minimal MCP authorization server: RFC 8414 metadata,
// RFC 7591 registration, and an /authorize whose response is configurable
// per test — the single knob the pre-flight classifies on.
type fakeAuthServer struct {
	srv *httptest.Server

	authorizeStatus      int
	authorizeContentType string
	authorizeBody        string
}

func startFakeAuthServer(t *testing.T) *fakeAuthServer {
	t.Helper()
	fake := &fakeAuthServer{}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/oauth-authorization-server", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                           fake.srv.URL,
			"authorization_endpoint":           fake.srv.URL + "/authorize",
			"token_endpoint":                   fake.srv.URL + "/token",
			"registration_endpoint":            fake.srv.URL + "/register",
			"code_challenge_methods_supported": []string{"S256"},
		})
	})
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"client_id": "preflight-test-client"})
	})
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		if fake.authorizeStatus == http.StatusFound {
			http.Redirect(w, r, fake.srv.URL+"/login", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", fake.authorizeContentType)
		w.WriteHeader(fake.authorizeStatus)
		_, _ = w.Write([]byte(fake.authorizeBody))
	})

	fake.srv = httptest.NewServer(mux)
	t.Cleanup(fake.srv.Close)
	return fake
}

// saveDcrMcpServer stores an McpServer whose http.url points at the fake
// authorization server, with no oauth_app_ref — the DCR initiate arm.
func saveDcrMcpServer(t *testing.T, h *oauthSecretsHarness, fake *fakeAuthServer, name string) string {
	t.Helper()
	mcpServerID := "mcpserver-preflight-" + name
	mcpServer := createTestMcpServerWithHttp(name)
	mcpServer.Metadata.Id = mcpServerID
	mcpServer.Spec.GetHttp().Url = fake.srv.URL + "/mcp"
	mcpServer.Spec.Auth = &mcpserverv1.McpServerAuth{TargetEnvVar: "TEST_TOKEN"}
	if err := h.store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		t.Fatalf("failed to save mcp server: %v", err)
	}
	return mcpServerID
}

func countPendingRows(t *testing.T, h *oauthSecretsHarness) int {
	t.Helper()
	var count int
	if err := h.store.DB().QueryRow(`SELECT COUNT(*) FROM pending_oauth_state`).Scan(&count); err != nil {
		t.Fatalf("failed to count pending rows: %v", err)
	}
	return count
}

func newPreflightHarness(t *testing.T) *oauthSecretsHarness {
	t.Helper()
	secrets, err := encryption.NewSecretService(oauthSecretsTestKey)
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}
	return setupOAuthSecretsHarness(t, secrets)
}

// TestInitiateDCR_PreflightBlocked pins the Canva shape: DCR succeeds but
// the authorization endpoint 400s the built authorize URL (redirect-host
// allowlist). Initiate must fail FAILED_PRECONDITION with copy an end user
// can act on, and must not leave a pending handshake row behind.
func TestInitiateDCR_PreflightBlocked(t *testing.T) {
	h := newPreflightHarness(t)
	fake := startFakeAuthServer(t)
	fake.authorizeStatus = http.StatusBadRequest
	fake.authorizeContentType = "text/html"
	fake.authorizeBody = `<html><body>Invalid redirect URI. It must be from an allowed host.</body></html>`

	mcpServerID := saveDcrMcpServer(t, h, fake, "canva-like")

	_, err := h.controller.InitiateOAuthConnect(context.Background(), &mcpserverv1.InitiateOAuthConnectInput{
		McpServerId: mcpServerID,
	})
	if err == nil {
		t.Fatal("expected initiate to fail when the authorization endpoint rejects pre-flight")
	}
	if status.Code(err) != codes.FailedPrecondition {
		t.Errorf("code = %v, want FailedPrecondition", status.Code(err))
	}

	msg := status.Convert(err).Message()
	for _, want := range []string{
		"canva-like",         // names the provider
		"HTTP 400",           // names the observed refusal
		"127.0.0.1",          // names this deployment's callback host (from the harness redirect URI)
		"redirect-host allowlist", // names the actionable cause
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("message %q missing %q", msg, want)
		}
	}

	if n := countPendingRows(t, h); n != 0 {
		t.Errorf("blocked initiate left %d pending row(s); handshake state must not outlive a refused flow", n)
	}
}

// TestInitiateDCR_PreflightBlockedWithVendorDetail pins that an RFC-shaped
// JSON rejection surfaces the provider's own words in the user copy.
func TestInitiateDCR_PreflightBlockedWithVendorDetail(t *testing.T) {
	h := newPreflightHarness(t)
	fake := startFakeAuthServer(t)
	fake.authorizeStatus = http.StatusBadRequest
	fake.authorizeContentType = "application/json"
	fake.authorizeBody = `{"error":"invalid_request","error_description":"redirect_uri host is not permitted"}`

	mcpServerID := saveDcrMcpServer(t, h, fake, "json-detail")

	_, err := h.controller.InitiateOAuthConnect(context.Background(), &mcpserverv1.InitiateOAuthConnectInput{
		McpServerId: mcpServerID,
	})
	if err == nil {
		t.Fatal("expected initiate to fail")
	}
	if msg := status.Convert(err).Message(); !strings.Contains(msg, "redirect_uri host is not permitted") {
		t.Errorf("message %q missing the provider's error_description", msg)
	}
}

// TestInitiateDCR_PreflightFailsOpen pins that non-400 authorize responses
// never block initiate: 403/503 are what bot-protection layers return to
// server-side GETs from healthy providers, and 302 is a healthy login
// redirect. Each must yield a normal authorize URL and a pending row.
func TestInitiateDCR_PreflightFailsOpen(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
	}{
		{"bot-protection-403", http.StatusForbidden},
		{"outage-503", http.StatusServiceUnavailable},
		{"healthy-302", http.StatusFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newPreflightHarness(t)
			fake := startFakeAuthServer(t)
			fake.authorizeStatus = tc.status
			fake.authorizeContentType = "text/html"
			fake.authorizeBody = "irrelevant"

			mcpServerID := saveDcrMcpServer(t, h, fake, fmt.Sprintf("open-%d", tc.status))

			out, err := h.controller.InitiateOAuthConnect(context.Background(), &mcpserverv1.InitiateOAuthConnectInput{
				McpServerId: mcpServerID,
			})
			if err != nil {
				t.Fatalf("initiate must fail open on HTTP %d, got: %v", tc.status, err)
			}
			if out.GetAuthorizationUrl() == "" {
				t.Error("expected an authorization URL")
			}
			if n := countPendingRows(t, h); n != 1 {
				t.Errorf("expected 1 pending row, got %d", n)
			}
		})
	}
}
