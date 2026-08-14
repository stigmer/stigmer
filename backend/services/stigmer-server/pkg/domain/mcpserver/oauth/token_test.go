package oauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveFromAuthedUser_BothTokensPresent(t *testing.T) {
	raw := `{
		"access_token": "xoxb-bot-token",
		"token_type": "bearer",
		"scope": "",
		"authed_user": {
			"access_token": "xoxp-user-token",
			"token_type": "bearer",
			"scope": "channels:read,chat:write"
		}
	}`

	var resp TokenResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	resp.resolveFromAuthedUser()

	if resp.AccessToken != "xoxp-user-token" {
		t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "xoxp-user-token")
	}
	if resp.TokenType != "bearer" {
		t.Errorf("TokenType = %q, want %q", resp.TokenType, "bearer")
	}
	if resp.Scope != "channels:read,chat:write" {
		t.Errorf("Scope = %q, want %q", resp.Scope, "channels:read,chat:write")
	}
}

func TestResolveFromAuthedUser_StandardOAuth(t *testing.T) {
	raw := `{
		"access_token": "github-pat-123",
		"token_type": "bearer",
		"scope": "repo,user"
	}`

	var resp TokenResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	resp.resolveFromAuthedUser()

	if resp.AccessToken != "github-pat-123" {
		t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "github-pat-123")
	}
	if resp.Scope != "repo,user" {
		t.Errorf("Scope = %q, want %q", resp.Scope, "repo,user")
	}
}

func TestResolveFromAuthedUser_OnlyAuthedUser(t *testing.T) {
	raw := `{
		"access_token": "",
		"authed_user": {
			"access_token": "xoxp-user-only",
			"token_type": "bearer",
			"scope": "search:read"
		}
	}`

	var resp TokenResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	resp.resolveFromAuthedUser()

	if resp.AccessToken != "xoxp-user-only" {
		t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "xoxp-user-only")
	}
	if resp.TokenType != "bearer" {
		t.Errorf("TokenType = %q, want %q", resp.TokenType, "bearer")
	}
	if resp.Scope != "search:read" {
		t.Errorf("Scope = %q, want %q", resp.Scope, "search:read")
	}
}

func TestResolveFromAuthedUser_NilAuthedUser(t *testing.T) {
	resp := TokenResponse{
		AccessToken: "original-token",
		TokenType:   "bearer",
		Scope:       "read",
	}
	resp.resolveFromAuthedUser()

	if resp.AccessToken != "original-token" {
		t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "original-token")
	}
}

func TestResolveFromAuthedUser_BlankAuthedUserToken(t *testing.T) {
	raw := `{
		"access_token": "xoxb-bot-token",
		"token_type": "bearer",
		"authed_user": {
			"access_token": "",
			"scope": "channels:read"
		}
	}`

	var resp TokenResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	resp.resolveFromAuthedUser()

	if resp.AccessToken != "xoxb-bot-token" {
		t.Errorf("AccessToken = %q, want %q (blank authed_user should not overwrite)",
			resp.AccessToken, "xoxb-bot-token")
	}
	if resp.Scope != "channels:read" {
		t.Errorf("Scope = %q, want %q (non-blank authed_user fields should still apply)",
			resp.Scope, "channels:read")
	}
}

func TestResolveFromAuthedUser_OverwritesBotScopeAndType(t *testing.T) {
	raw := `{
		"access_token": "xoxb-bot-token",
		"token_type": "bot",
		"scope": "bot:basic",
		"authed_user": {
			"access_token": "xoxp-user-token",
			"token_type": "user",
			"scope": "channels:read"
		}
	}`

	var resp TokenResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	resp.resolveFromAuthedUser()

	if resp.AccessToken != "xoxp-user-token" {
		t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "xoxp-user-token")
	}
	if resp.TokenType != "user" {
		t.Errorf("TokenType = %q, want %q", resp.TokenType, "user")
	}
	if resp.Scope != "channels:read" {
		t.Errorf("Scope = %q, want %q", resp.Scope, "channels:read")
	}
}

// ---------------------------------------------------------------------------
// Client-secret placement (stigmer/stigmer#410)
//
// Pins the token-request wire shape: which channel carries the client
// secret for each token_endpoint_auth_method, and that exactly one channel
// is ever used per request (RFC 6749 §2.3). Both ExchangeCode and
// RefreshToken share doTokenRequest, so each mode is pinned on both.
// ---------------------------------------------------------------------------

// capturedTokenRequest records the credential-bearing parts of a token
// request as the vendor's server saw them.
type capturedTokenRequest struct {
	basicUser  string
	basicPass  string
	hasBasic   bool
	formSecret string
	formClient string
}

// captureTokenServer returns a token endpoint that records each request's
// Authorization header and form body, always answering with a valid token.
func captureTokenServer(t *testing.T, captured *capturedTokenRequest) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		captured.basicUser, captured.basicPass, captured.hasBasic = r.BasicAuth()
		captured.formSecret = r.PostFormValue("client_secret")
		captured.formClient = r.PostFormValue("client_id")

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token": "at-123", "token_type": "bearer"}`))
	}))
}

func TestTokenRequest_SecretPlacement(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		secret     string
		wantBasic  bool
		wantInForm bool
	}{
		{
			name:       "default empty method uses Basic (historical behavior)",
			method:     "",
			secret:     "s3cret",
			wantBasic:  true,
			wantInForm: false,
		},
		{
			name:       "explicit client_secret_basic uses Basic",
			method:     TokenAuthMethodBasic,
			secret:     "s3cret",
			wantBasic:  true,
			wantInForm: false,
		},
		{
			name:       "client_secret_post puts the secret in the form body only",
			method:     TokenAuthMethodPost,
			secret:     "s3cret",
			wantBasic:  false,
			wantInForm: true,
		},
		{
			name:       "public client (no secret) authenticates with neither channel",
			method:     "",
			secret:     "",
			wantBasic:  false,
			wantInForm: false,
		},
		{
			name:       "post method without a secret is a no-op (public client)",
			method:     TokenAuthMethodPost,
			secret:     "",
			wantBasic:  false,
			wantInForm: false,
		},
	}

	type tokenCall struct {
		name string
		call func(ctx context.Context, endpoint, secret, method string) (*TokenResponse, error)
	}
	calls := []tokenCall{
		{
			name: "ExchangeCode",
			call: func(ctx context.Context, endpoint, secret, method string) (*TokenResponse, error) {
				return ExchangeCode(ctx, endpoint, "code-1", "http://127.0.0.1/cb", "verifier-1", "client-1", secret, method)
			},
		},
		{
			name: "RefreshToken",
			call: func(ctx context.Context, endpoint, secret, method string) (*TokenResponse, error) {
				return RefreshToken(ctx, endpoint, "rt-1", "client-1", secret, method)
			},
		},
	}

	for _, call := range calls {
		for _, tt := range tests {
			t.Run(call.name+"/"+tt.name, func(t *testing.T) {
				var captured capturedTokenRequest
				server := captureTokenServer(t, &captured)
				defer server.Close()

				resp, err := call.call(context.Background(), server.URL, tt.secret, tt.method)
				if err != nil {
					t.Fatalf("%s: %v", call.name, err)
				}
				if resp.AccessToken != "at-123" {
					t.Errorf("AccessToken = %q, want %q", resp.AccessToken, "at-123")
				}

				if captured.hasBasic != tt.wantBasic {
					t.Errorf("Basic auth present = %v, want %v", captured.hasBasic, tt.wantBasic)
				}
				if tt.wantBasic {
					if captured.basicUser != "client-1" || captured.basicPass != tt.secret {
						t.Errorf("Basic credentials = %q:%q, want %q:%q",
							captured.basicUser, captured.basicPass, "client-1", tt.secret)
					}
				}

				wantFormSecret := ""
				if tt.wantInForm {
					wantFormSecret = tt.secret
				}
				if captured.formSecret != wantFormSecret {
					t.Errorf("form client_secret = %q, want %q", captured.formSecret, wantFormSecret)
				}

				// client_id always rides the form body regardless of method.
				if captured.formClient != "client-1" {
					t.Errorf("form client_id = %q, want %q", captured.formClient, "client-1")
				}

				// The invariant behind the per-mode expectations: the secret
				// never travels both channels in one request.
				if captured.hasBasic && captured.formSecret != "" {
					t.Error("client secret sent via BOTH Basic header and form body — RFC 6749 §2.3 violation")
				}
			})
		}
	}
}
