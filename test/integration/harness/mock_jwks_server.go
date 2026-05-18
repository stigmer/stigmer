package harness

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// MockJWKSServer serves a JWKS endpoint and signs JWTs for testing
// IdentityProvider federation without an external IdP. When started via
// StartMockOIDCServer it also serves OpenID Connect discovery, enabling
// Spring Security's JwtDecoders.fromOidcIssuerLocation() to bootstrap
// against a local HTTP server instead of a real Auth0 tenant.
type MockJWKSServer struct {
	URL      string
	JWKSURL  string
	Issuer   string
	Audience string

	privateKey *rsa.PrivateKey
	keyID      string
	server     *http.Server
	listener   net.Listener
}

// StartMockJWKSServer creates an in-process HTTP server that serves a JWKS
// endpoint at /jwks. The server is stopped on test cleanup.
// Accepts testing.TB so it can be used from both test functions and TestMain.
func StartMockJWKSServer(t testing.TB, issuer string) *MockJWKSServer {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	keyID := "test-key-1"

	mux := http.NewServeMux()
	m := &MockJWKSServer{
		Issuer:     issuer,
		privateKey: privateKey,
		keyID:      keyID,
	}

	mux.HandleFunc("/jwks", m.handleJWKS)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for mock JWKS server: %v", err)
	}

	m.listener = listener
	m.server = &http.Server{Handler: mux}
	m.URL = fmt.Sprintf("http://%s", listener.Addr().String())
	m.JWKSURL = m.URL + "/jwks"

	go m.server.Serve(listener)

	t.Cleanup(func() {
		m.server.Close()
	})

	t.Logf("mock JWKS server started: jwks=%s, issuer=%s", m.JWKSURL, issuer)
	return m
}

// StartMockOIDCServer creates an in-process HTTP server that serves both a
// JWKS endpoint and OpenID Connect discovery at /.well-known/openid-configuration.
// This allows the Java service to start in production security mode with
// SECURITY_AUTHENTICATION_IDP_URL pointing at this server instead of Auth0.
// Accepts testing.TB so it can be used from both test functions and TestMain.
func StartMockOIDCServer(t testing.TB, issuer, audience string) *MockJWKSServer {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	keyID := "oidc-test-key-1"

	m := &MockJWKSServer{
		Issuer:     issuer,
		Audience:   audience,
		privateKey: privateKey,
		keyID:      keyID,
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for mock OIDC server: %v", err)
	}

	m.listener = listener
	baseURL := fmt.Sprintf("http://%s", listener.Addr().String())
	m.URL = baseURL
	m.JWKSURL = baseURL + "/jwks"

	// The issuer in the OIDC discovery document must exactly match what we
	// set in the JWT "iss" claim and what the Java service is configured with.
	// If the caller passed a placeholder issuer, override it with the actual URL.
	if issuer == "" {
		m.Issuer = baseURL + "/"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/jwks", m.handleJWKS)
	mux.HandleFunc("/.well-known/openid-configuration", m.handleOIDCDiscovery)

	m.server = &http.Server{Handler: mux}

	go m.server.Serve(listener)

	t.Cleanup(func() {
		m.server.Close()
	})

	t.Logf("mock OIDC server started: discovery=%s/.well-known/openid-configuration, jwks=%s, issuer=%s",
		m.URL, m.JWKSURL, m.Issuer)
	return m
}

func (m *MockJWKSServer) handleJWKS(w http.ResponseWriter, _ *http.Request) {
	jwks := map[string]any{
		"keys": []map[string]any{
			{
				"kty": "RSA",
				"use": "sig",
				"kid": m.keyID,
				"alg": "RS256",
				"n":   base64.RawURLEncoding.EncodeToString(m.privateKey.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(m.privateKey.E)).Bytes()),
			},
		},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jwks)
}

// handleOIDCDiscovery returns the minimal OpenID Provider Configuration that
// Spring Security's NimbusJwtDecoder needs: issuer, jwks_uri, and the
// required OIDC fields (authorization_endpoint, token_endpoint, etc.).
func (m *MockJWKSServer) handleOIDCDiscovery(w http.ResponseWriter, _ *http.Request) {
	discovery := map[string]any{
		"issuer":                                m.Issuer,
		"authorization_endpoint":                m.URL + "/authorize",
		"token_endpoint":                        m.URL + "/oauth/token",
		"userinfo_endpoint":                     m.URL + "/userinfo",
		"jwks_uri":                              m.JWKSURL,
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"response_types_supported":              []string{"code"},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(discovery)
}

// NewMockJWKSServer creates a MockJWKSServer without a testing.TB dependency.
// The caller must call Close() when done. Use this from TestMain where
// *testing.T is not available.
func NewMockJWKSServer(issuer string) (*MockJWKSServer, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generate RSA key: %w", err)
	}

	keyID := "test-key-1"
	mux := http.NewServeMux()
	m := &MockJWKSServer{
		Issuer:     issuer,
		privateKey: privateKey,
		keyID:      keyID,
	}
	mux.HandleFunc("/jwks", m.handleJWKS)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for mock JWKS server: %w", err)
	}

	m.listener = listener
	m.server = &http.Server{Handler: mux}
	m.URL = fmt.Sprintf("http://%s", listener.Addr().String())
	m.JWKSURL = m.URL + "/jwks"

	go m.server.Serve(listener)
	return m, nil
}

// NewMockOIDCServer creates a MockJWKSServer with OIDC discovery without a
// testing.TB dependency. The caller must call Close() when done.
func NewMockOIDCServer(issuer, audience string) (*MockJWKSServer, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generate RSA key: %w", err)
	}

	keyID := "oidc-test-key-1"
	m := &MockJWKSServer{
		Issuer:     issuer,
		Audience:   audience,
		privateKey: privateKey,
		keyID:      keyID,
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for mock OIDC server: %w", err)
	}

	m.listener = listener
	baseURL := fmt.Sprintf("http://%s", listener.Addr().String())
	m.URL = baseURL
	m.JWKSURL = baseURL + "/jwks"

	if issuer == "" {
		m.Issuer = baseURL + "/"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/jwks", m.handleJWKS)
	mux.HandleFunc("/.well-known/openid-configuration", m.handleOIDCDiscovery)

	m.server = &http.Server{Handler: mux}
	go m.server.Serve(listener)
	return m, nil
}

// Close shuts down the HTTP server. Use when the server was created via
// NewMockJWKSServer or NewMockOIDCServer (without testing.TB cleanup).
func (m *MockJWKSServer) Close() error {
	if m.server != nil {
		return m.server.Close()
	}
	return nil
}

// SignJWT creates a signed JWT with the given subject, audience, and optional
// extra claims. The token is valid for 1 hour by default.
func (m *MockJWKSServer) SignJWT(subject, audience string, extraClaims map[string]any) (string, error) {
	return m.SignJWTWithExpiry(subject, audience, time.Hour, extraClaims)
}

// SignJWTWithExpiry creates a signed JWT with a custom expiry duration.
// Use a negative duration to create an already-expired token for testing.
func (m *MockJWKSServer) SignJWTWithExpiry(subject, audience string, expiry time.Duration, extraClaims map[string]any) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss": m.Issuer,
		"sub": subject,
		"aud": audience,
		"iat": now.Unix(),
		"exp": now.Add(expiry).Unix(),
	}

	for k, v := range extraClaims {
		claims[k] = v
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = m.keyID

	return token.SignedString(m.privateKey)
}

// SignExpiredJWT is a convenience for creating an already-expired token.
func (m *MockJWKSServer) SignExpiredJWT(subject, audience string) (string, error) {
	return m.SignJWTWithExpiry(subject, audience, -time.Hour, nil)
}

// SignJWTWithDifferentKey creates a JWT with a freshly-generated RSA key that
// is NOT served by this server's JWKS endpoint. Useful for testing that tokens
// signed by unknown keys are rejected.
func (m *MockJWKSServer) SignJWTWithDifferentKey(subject, audience string) (string, error) {
	wrongKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", fmt.Errorf("generate wrong key: %w", err)
	}

	now := time.Now()
	claims := jwt.MapClaims{
		"iss": m.Issuer,
		"sub": subject,
		"aud": audience,
		"iat": now.Unix(),
		"exp": now.Add(time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "unknown-key-id"

	return token.SignedString(wrongKey)
}
