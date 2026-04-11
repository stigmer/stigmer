package oauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DCRRequest is the Dynamic Client Registration request per RFC 7591.
type DCRRequest struct {
	RedirectURIs            []string `json:"redirect_uris"`
	ClientName              string   `json:"client_name"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
}

// DCRResponse is the Dynamic Client Registration response per RFC 7591.
type DCRResponse struct {
	ClientID                string `json:"client_id"`
	ClientSecret            string `json:"client_secret,omitempty"`
	ClientName              string `json:"client_name,omitempty"`
	TokenEndpointAuthMethod string `json:"token_endpoint_auth_method,omitempty"`
}

var dcrHTTPClient = &http.Client{Timeout: 15 * time.Second}

// RegisterClient performs OAuth Dynamic Client Registration (RFC 7591)
// at the given registration endpoint.
//
// Registers a public client (token_endpoint_auth_method: "none") since
// MCP OAuth uses PKCE instead of client secrets. The returned client_id
// is stored in the user's OAuthGrant for subsequent token operations.
func RegisterClient(ctx context.Context, registrationEndpoint, redirectURI, clientName string) (*DCRResponse, error) {
	reqBody := DCRRequest{
		RedirectURIs:            []string{redirectURI},
		ClientName:              clientName,
		GrantTypes:              []string{"authorization_code"},
		ResponseTypes:           []string{"code"},
		TokenEndpointAuthMethod: "none",
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal DCR request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, registrationEndpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create DCR request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := dcrHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("DCR request to %s failed: %w", registrationEndpoint, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read DCR response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"DCR at %s returned HTTP %d: %s",
			registrationEndpoint, resp.StatusCode, truncateBody(respBody),
		)
	}

	var dcrResp DCRResponse
	if err := json.Unmarshal(respBody, &dcrResp); err != nil {
		return nil, fmt.Errorf("failed to parse DCR response: %w", err)
	}

	if dcrResp.ClientID == "" {
		return nil, fmt.Errorf("DCR response from %s is missing client_id", registrationEndpoint)
	}

	return &dcrResp, nil
}

func truncateBody(body []byte) string {
	const maxLen = 256
	if len(body) <= maxLen {
		return string(body)
	}
	return string(body[:maxLen]) + "..."
}
