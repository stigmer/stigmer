package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/config"
)

// oauthDisabled is the zero-value OAuth config used by tests that exercise the
// default (passthrough-only) behavior.
var oauthDisabled = config.OAuthMetadata{}

// oauthEnabled mirrors the production prod-overlay configuration.
var oauthEnabled = config.OAuthMetadata{
	Enabled:              true,
	Resource:             "https://mcp.stigmer.ai",
	AuthorizationServers: []string{"https://stigmer-prod.us.auth0.com/"},
	ScopesSupported:      []string{"openid", "profile"},
}

func TestExtractBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"valid token", "Bearer sk-12345", "sk-12345"},
		{"missing header", "", ""},
		{"basic auth", "Basic dXNlcjpwYXNz", ""},
		{"bearer lowercase", "bearer sk-12345", ""},
		{"bearer with extra whitespace", "Bearer   sk-12345  ", "sk-12345"},
		{"bearer empty token", "Bearer ", ""},
		{"just bearer keyword", "Bearer", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.header != "" {
				r.Header.Set("Authorization", tt.header)
			}
			got := extractBearerToken(r)
			if got != tt.want {
				t.Errorf("extractBearerToken = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestHealthHandler(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health", nil)

	healthHandler(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	body := strings.TrimSpace(w.Body.String())
	if body != `{"status":"ok"}` {
		t.Errorf("body = %q, want %q", body, `{"status":"ok"}`)
	}
}

func TestAuthMiddleware_validToken(t *testing.T) {
	var called bool
	var gotKey string

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		key, err := auth.GetAPIKey(r.Context())
		if err != nil {
			t.Errorf("inner handler: GetAPIKey error: %v", err)
			return
		}
		gotKey = key
		w.WriteHeader(http.StatusOK)
	})

	handler := authMiddleware(inner, oauthDisabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	r.Header.Set("Authorization", "Bearer my-secret")

	handler.ServeHTTP(w, r)

	if !called {
		t.Fatal("inner handler was not called")
	}
	if gotKey != "my-secret" {
		t.Errorf("API key = %q, want %q", gotKey, "my-secret")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestAuthMiddleware_missingToken(t *testing.T) {
	var called bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := authMiddleware(inner, oauthDisabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)

	handler.ServeHTTP(w, r)

	if called {
		t.Fatal("inner handler should not be called when token is missing")
	}
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	// With OAuth disabled, the legacy behavior must be unchanged: no challenge.
	if got := w.Header().Get("WWW-Authenticate"); got != "" {
		t.Errorf("WWW-Authenticate = %q, want empty when OAuth disabled", got)
	}
}

func TestAuthMiddleware_malformedToken(t *testing.T) {
	var called bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := authMiddleware(inner, oauthDisabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	r.Header.Set("Authorization", "Basic dXNlcjpwYXNz")

	handler.ServeHTTP(w, r)

	if called {
		t.Fatal("inner handler should not be called for non-Bearer auth")
	}
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_oauthEnabled_missingToken_challenges(t *testing.T) {
	var called bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := authMiddleware(inner, oauthEnabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)

	handler.ServeHTTP(w, r)

	if called {
		t.Fatal("inner handler should not be called when token is missing")
	}
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}

	challenge := w.Header().Get("WWW-Authenticate")
	if !strings.HasPrefix(challenge, "Bearer ") {
		t.Fatalf("WWW-Authenticate = %q, want a Bearer challenge", challenge)
	}
	wantMeta := `resource_metadata="https://mcp.stigmer.ai/.well-known/oauth-protected-resource"`
	if !strings.Contains(challenge, wantMeta) {
		t.Errorf("WWW-Authenticate = %q, want it to contain %s", challenge, wantMeta)
	}
	if !strings.Contains(challenge, `scope="openid profile"`) {
		t.Errorf("WWW-Authenticate = %q, want it to contain the advertised scopes", challenge)
	}
}

func TestAuthMiddleware_oauthEnabled_withToken_passesThrough(t *testing.T) {
	var called bool
	var gotKey string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		key, err := auth.GetAPIKey(r.Context())
		if err != nil {
			t.Errorf("inner handler: GetAPIKey error: %v", err)
			return
		}
		gotKey = key
		w.WriteHeader(http.StatusOK)
	})

	handler := authMiddleware(inner, oauthEnabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set("Authorization", "Bearer my-secret")

	handler.ServeHTTP(w, r)

	if !called {
		t.Fatal("inner handler was not called for an authenticated request")
	}
	if gotKey != "my-secret" {
		t.Errorf("API key = %q, want %q", gotKey, "my-secret")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	// A client that supplies a Bearer header must never see the challenge.
	if got := w.Header().Get("WWW-Authenticate"); got != "" {
		t.Errorf("WWW-Authenticate = %q, want empty for an authenticated request", got)
	}
}

func TestBearerChallenge_format(t *testing.T) {
	got := bearerChallenge(config.OAuthMetadata{
		Enabled:  true,
		Resource: "https://mcp.stigmer.ai/", // trailing slash must be normalized
	})
	want := `Bearer realm="stigmer", resource_metadata="https://mcp.stigmer.ai/.well-known/oauth-protected-resource"`
	if got != want {
		t.Errorf("bearerChallenge =\n  %q\nwant\n  %q", got, want)
	}
}

func TestProtectedResourceMetadataHandler_GET(t *testing.T) {
	handler := protectedResourceMetadataHandler(oauthEnabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource", nil)
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	// Public discovery document must be CORS-accessible from any origin.
	if aco := w.Header().Get("Access-Control-Allow-Origin"); aco != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want *", aco)
	}

	var doc struct {
		Resource             string   `json:"resource"`
		AuthorizationServers []string `json:"authorization_servers"`
		ScopesSupported      []string `json:"scopes_supported"`
		BearerMethods        []string `json:"bearer_methods_supported"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if doc.Resource != "https://mcp.stigmer.ai" {
		t.Errorf("resource = %q, want https://mcp.stigmer.ai", doc.Resource)
	}
	if len(doc.AuthorizationServers) != 1 || doc.AuthorizationServers[0] != "https://stigmer-prod.us.auth0.com/" {
		t.Errorf("authorization_servers = %v, want [https://stigmer-prod.us.auth0.com/]", doc.AuthorizationServers)
	}
	if len(doc.BearerMethods) != 1 || doc.BearerMethods[0] != "header" {
		t.Errorf("bearer_methods_supported = %v, want [header]", doc.BearerMethods)
	}
}

func TestProtectedResourceMetadataHandler_CORSPreflight(t *testing.T) {
	handler := protectedResourceMetadataHandler(oauthEnabled)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/.well-known/oauth-protected-resource", nil)
	handler.ServeHTTP(w, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("OPTIONS status = %d, want %d", w.Code, http.StatusNoContent)
	}
	if aco := w.Header().Get("Access-Control-Allow-Origin"); aco != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want *", aco)
	}
}

func TestStatusWriter_capturesCode(t *testing.T) {
	w := httptest.NewRecorder()
	sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}

	sw.WriteHeader(http.StatusNotFound)

	if sw.status != http.StatusNotFound {
		t.Errorf("status = %d, want %d", sw.status, http.StatusNotFound)
	}
	if w.Code != http.StatusNotFound {
		t.Errorf("underlying recorder status = %d, want %d", w.Code, http.StatusNotFound)
	}
}
