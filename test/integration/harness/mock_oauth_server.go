package harness

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// MockOAuthServer implements a minimal OAuth 2.0 authorization server for testing
// the MCP server OAuth connect flow (initiateOAuthConnect / completeOAuthConnect).
//
// Implements:
//   - RFC 8414: OAuth Authorization Server Metadata (/.well-known/oauth-authorization-server)
//   - RFC 7591: Dynamic Client Registration (/register)
//   - Authorization endpoint (/authorize) - returns code immediately (no browser)
//   - Token endpoint (/token) - exchanges code for access_token + refresh_token
type MockOAuthServer struct {
	Server *httptest.Server

	mu             sync.Mutex
	issuedCodes    map[string]codeRecord
	registeredApps []registeredClient
	issuedTokens   []string
	refreshTokens  map[string]string // refresh_token -> access_token
}

type codeRecord struct {
	clientID    string
	redirectURI string
	createdAt   time.Time
}

type registeredClient struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// StartMockOAuthServer creates and starts a mock OAuth authorization server.
// The server handles discovery, DCR, authorization, and token exchange.
func StartMockOAuthServer(t *testing.T) *MockOAuthServer {
	t.Helper()

	mock := &MockOAuthServer{
		issuedCodes:   make(map[string]codeRecord),
		refreshTokens: make(map[string]string),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/oauth-authorization-server", mock.handleMetadata)
	mux.HandleFunc("/register", mock.handleRegister)
	mux.HandleFunc("/authorize", mock.handleAuthorize)
	mux.HandleFunc("/token", mock.handleToken)

	mock.Server = httptest.NewServer(mux)
	t.Cleanup(func() {
		mock.Server.Close()
	})

	t.Logf("Mock OAuth server started at %s", mock.Server.URL)
	return mock
}

// URL returns the base URL of the mock OAuth server.
func (m *MockOAuthServer) URL() string {
	return m.Server.URL
}

// IssuedTokens returns all access tokens that were issued by this server.
func (m *MockOAuthServer) IssuedTokens() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]string, len(m.issuedTokens))
	copy(result, m.issuedTokens)
	return result
}

// RegisteredApps returns all clients registered via DCR.
func (m *MockOAuthServer) RegisteredApps() []registeredClient {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]registeredClient, len(m.registeredApps))
	copy(result, m.registeredApps)
	return result
}

func (m *MockOAuthServer) handleMetadata(w http.ResponseWriter, r *http.Request) {
	metadata := map[string]interface{}{
		"issuer":                           m.Server.URL,
		"authorization_endpoint":           m.Server.URL + "/authorize",
		"token_endpoint":                   m.Server.URL + "/token",
		"registration_endpoint":            m.Server.URL + "/register",
		"response_types_supported":         []string{"code"},
		"grant_types_supported":            []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported": []string{"S256"},
		"scopes_supported":                 []string{"read", "write"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metadata)
}

func (m *MockOAuthServer) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	clientID := "test_client_" + randomHex(8)
	clientSecret := "test_secret_" + randomHex(16)

	client := registeredClient{
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}

	m.mu.Lock()
	m.registeredApps = append(m.registeredApps, client)
	m.mu.Unlock()

	resp := map[string]interface{}{
		"client_id":                clientID,
		"client_secret":            clientSecret,
		"client_id_issued_at":      time.Now().Unix(),
		"client_secret_expires_at": 0,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

func (m *MockOAuthServer) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID := r.URL.Query().Get("client_id")
	redirectURI := r.URL.Query().Get("redirect_uri")
	state := r.URL.Query().Get("state")

	code := "authcode_" + randomHex(16)

	m.mu.Lock()
	m.issuedCodes[code] = codeRecord{
		clientID:    clientID,
		redirectURI: redirectURI,
		createdAt:   time.Now(),
	}
	m.mu.Unlock()

	// Return the code immediately via redirect (no browser interaction)
	redirectURL := redirectURI + "?code=" + code + "&state=" + state
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (m *MockOAuthServer) handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.ParseForm()
	grantType := r.FormValue("grant_type")

	switch grantType {
	case "authorization_code":
		m.handleAuthorizationCodeGrant(w, r)
	case "refresh_token":
		m.handleRefreshTokenGrant(w, r)
	default:
		errorResponse(w, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token")
	}
}

func (m *MockOAuthServer) handleAuthorizationCodeGrant(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")

	m.mu.Lock()
	_, exists := m.issuedCodes[code]
	if exists {
		delete(m.issuedCodes, code)
	}
	m.mu.Unlock()

	if !exists {
		errorResponse(w, "invalid_grant", "authorization code is invalid or expired")
		return
	}

	accessToken := "access_" + randomHex(24)
	refreshToken := "refresh_" + randomHex(24)

	m.mu.Lock()
	m.issuedTokens = append(m.issuedTokens, accessToken)
	m.refreshTokens[refreshToken] = accessToken
	m.mu.Unlock()

	resp := map[string]interface{}{
		"access_token":  accessToken,
		"token_type":    "Bearer",
		"expires_in":    3600,
		"refresh_token": refreshToken,
		"scope":         "read write",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (m *MockOAuthServer) handleRefreshTokenGrant(w http.ResponseWriter, r *http.Request) {
	refreshToken := r.FormValue("refresh_token")

	m.mu.Lock()
	_, exists := m.refreshTokens[refreshToken]
	m.mu.Unlock()

	if !exists {
		errorResponse(w, "invalid_grant", "refresh token is invalid or expired")
		return
	}

	newAccessToken := "access_" + randomHex(24)

	m.mu.Lock()
	m.issuedTokens = append(m.issuedTokens, newAccessToken)
	m.refreshTokens[refreshToken] = newAccessToken
	m.mu.Unlock()

	resp := map[string]interface{}{
		"access_token": newAccessToken,
		"token_type":   "Bearer",
		"expires_in":   3600,
		"scope":        "read write",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func errorResponse(w http.ResponseWriter, errorCode, description string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{
		"error":             errorCode,
		"error_description": description,
	})
}

func randomHex(n int) string {
	bytes := make([]byte, n)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
