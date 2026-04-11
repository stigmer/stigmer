package oauth

import (
	"encoding/json"
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
