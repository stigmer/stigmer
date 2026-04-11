package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// AuthServerMetadata holds the OAuth 2.0 Authorization Server Metadata
// discovered via RFC 8414 (.well-known/oauth-authorization-server).
type AuthServerMetadata struct {
	Issuer                        string   `json:"issuer"`
	AuthorizationEndpoint         string   `json:"authorization_endpoint"`
	TokenEndpoint                 string   `json:"token_endpoint"`
	RegistrationEndpoint          string   `json:"registration_endpoint,omitempty"`
	ScopesSupported               []string `json:"scopes_supported,omitempty"`
	CodeChallengeMethodsSupported []string `json:"code_challenge_methods_supported,omitempty"`
}

var discoveryHTTPClient = &http.Client{Timeout: 10 * time.Second}

// DiscoverAuthorizationServer fetches the OAuth Authorization Server Metadata
// from the MCP server's .well-known endpoint per RFC 8414.
//
// The serverURL should be the base URL of the MCP HTTP server (e.g.,
// "https://mcp.linear.app/mcp"). The discovery endpoint is constructed
// by appending /.well-known/oauth-authorization-server to the URL origin.
func DiscoverAuthorizationServer(ctx context.Context, serverURL string) (*AuthServerMetadata, error) {
	wellKnownURL, err := buildWellKnownURL(serverURL)
	if err != nil {
		return nil, fmt.Errorf("invalid server URL for discovery: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wellKnownURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create discovery request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := discoveryHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("discovery request to %s failed: %w", wellKnownURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"authorization server discovery failed: %s returned HTTP %d (expected 200). "+
				"This MCP server may not support the MCP Authorization specification",
			wellKnownURL, resp.StatusCode,
		)
	}

	var metadata AuthServerMetadata
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil {
		return nil, fmt.Errorf("failed to parse authorization server metadata: %w", err)
	}

	if err := validateMetadata(&metadata, wellKnownURL); err != nil {
		return nil, err
	}

	return &metadata, nil
}

// buildWellKnownURL constructs the .well-known URL from the MCP server URL.
// Per RFC 8414, the well-known URI is at the origin (scheme + host).
func buildWellKnownURL(serverURL string) (string, error) {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return "", err
	}

	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported scheme %q: only http and https are supported", parsed.Scheme)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("server URL has no host")
	}

	origin := fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host)
	return strings.TrimRight(origin, "/") + "/.well-known/oauth-authorization-server", nil
}

func validateMetadata(m *AuthServerMetadata, sourceURL string) error {
	if m.AuthorizationEndpoint == "" {
		return fmt.Errorf("authorization server at %s is missing authorization_endpoint", sourceURL)
	}
	if m.TokenEndpoint == "" {
		return fmt.Errorf("authorization server at %s is missing token_endpoint", sourceURL)
	}
	if len(m.CodeChallengeMethodsSupported) > 0 && !slices.Contains(m.CodeChallengeMethodsSupported, "S256") {
		return fmt.Errorf(
			"authorization server at %s does not support S256 PKCE (supports: %v). "+
				"S256 is required by the MCP Authorization specification",
			sourceURL, m.CodeChallengeMethodsSupported,
		)
	}
	return nil
}
