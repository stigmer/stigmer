package harness

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// MockJWKSServer serves a JWKS endpoint and signs JWTs for testing
// IdentityProvider federation without an external IdP. When started via
// StartMockOIDCServer / NewMockOIDCServer it also plays the platform identity
// tenant: OpenID Connect discovery (so Spring Security's
// JwtDecoders.fromOidcIssuerLocation() bootstraps against a local HTTP server
// instead of a real Auth0 tenant), the client_credentials token endpoint the
// service's MachineAccountJwtProvider calls, and the bearer-checked /userinfo
// the service's provisionMyAccount reads a first-login profile from.
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

	m.server = &http.Server{Handler: m.oidcMux()}

	go m.server.Serve(listener)

	t.Cleanup(func() {
		m.server.Close()
	})

	t.Logf("mock OIDC server started: discovery=%s/.well-known/openid-configuration, jwks=%s, issuer=%s",
		m.URL, m.JWKSURL, m.Issuer)
	return m
}

// oidcMux is the platform-tenant route table, shared by both OIDC
// constructors so the two boot paths (testing.TB and TestMain) cannot drift.
func (m *MockJWKSServer) oidcMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/jwks", m.handleJWKS)
	mux.HandleFunc("/.well-known/openid-configuration", m.handleOIDCDiscovery)
	mux.HandleFunc("/oauth/token", m.handleOAuthToken)
	mux.HandleFunc("/userinfo", m.handleUserInfo)
	return mux
}

// IdentityTenantMaterial is the private half of the tenant: what a test
// process needs to mint tokens this server's JWKS verifies, exactly as the
// tenant itself would. Hand it only to the process that owns the run.
type IdentityTenantMaterial struct {
	// Issuer is the `iss` claim and the discovery document's issuer.
	Issuer string
	// KeyID is the `kid` the JWKS publishes for the signing key.
	KeyID string
	// PrivateKeyPEM is the RSA signing key as a PKCS#8 PEM — the format the
	// conformance suite's direct-login mint consumes (node:crypto createSign).
	PrivateKeyPEM string
}

// Material exports the tenant's signing material. Test-only by construction:
// the key is generated per server and dies with the process.
func (m *MockJWKSServer) Material() (IdentityTenantMaterial, error) {
	der, err := x509.MarshalPKCS8PrivateKey(m.privateKey)
	if err != nil {
		return IdentityTenantMaterial{}, fmt.Errorf("marshal tenant signing key: %w", err)
	}
	return IdentityTenantMaterial{
		Issuer:        m.Issuer,
		KeyID:         m.keyID,
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
	}, nil
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

// handleOAuthToken implements the OAuth 2.0 client_credentials grant for the
// mock OIDC server. The Java service's MachineAccountJwtProvider calls this
// endpoint to obtain a machine-account JWT for internal service-to-service calls.
//
// The handler reads client_id from the JSON POST body (matching the real Auth0
// client_credentials flow) and constructs the JWT subject as "{client_id}@clients".
// This ensures the mock JWT subject aligns with the machine account the service's
// BootstrapIdentitySeeder creates at startup (spec.idpId = "{AUTH0_CLIENT_ID}@clients").
func (m *MockJWKSServer) handleOAuthToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		ClientID string `json:"client_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ClientID == "" {
		body.ClientID = "test-client-id"
	}

	audience := m.Audience
	if audience == "" {
		audience = "https://api.stigmer.test"
	}

	sub := body.ClientID + "@clients"
	token, err := m.SignJWT(sub, audience, map[string]any{
		"gty":   "client-credentials",
		"scope": "machine-account",
	})
	if err != nil {
		http.Error(w, "failed to sign token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp := map[string]any{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   3600,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleUserInfo is the OIDC UserInfo endpoint the Java service's
// provisionMyAccount reads a first-login profile from (its URL is derived from
// security.authentication.idp-url, i.e. this server). The bearer must be a
// token THIS tenant signed — a stranger's token or none answers 401, the way
// Auth0 does — and the profile is a deterministic function of `sub`, so a
// test that mints a subject knows the email the account will carry. The field
// set is exactly what the service's UserInfoClient parses.
func (m *MockJWKSServer) handleUserInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	authz := r.Header.Get("Authorization")
	if !strings.HasPrefix(authz, "Bearer ") {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_request"`)
		http.Error(w, "missing bearer", http.StatusUnauthorized)
		return
	}
	sub, err := m.subjectOfOwnToken(strings.TrimPrefix(authz, "Bearer "))
	if err != nil {
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
		http.Error(w, "invalid token: "+err.Error(), http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(userInfoProfile(sub))
}

// subjectOfOwnToken verifies a compact JWS against this server's key and
// issuer and returns its subject. Audience is deliberately not checked:
// /userinfo is called with the same access token the API received, whose
// audience is the API's, not this endpoint's.
func (m *MockJWKSServer) subjectOfOwnToken(token string) (string, error) {
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodRS256.Alg() {
			return nil, fmt.Errorf("unexpected alg %q", t.Method.Alg())
		}
		return &m.privateKey.PublicKey, nil
	}, jwt.WithIssuer(m.Issuer))
	if err != nil {
		return "", err
	}
	sub, err := parsed.Claims.GetSubject()
	if err != nil || sub == "" {
		return "", fmt.Errorf("token carries no subject")
	}
	return sub, nil
}

// userInfoProfile derives the profile for a subject. The email's local part is
// the subject with every non-mailbox character folded to '-', so
// "auth0|abc" becomes "auth0-abc@<domain>" — legible in a failing test and
// unique per subject.
func userInfoProfile(sub string) map[string]string {
	local := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			return r
		default:
			return '-'
		}
	}, sub)
	return map[string]string{
		"sub":         sub,
		"email":       local + "@" + mockTenantEmailDomain,
		"name":        "Tenant " + sub,
		"given_name":  "Tenant",
		"family_name": sub,
		"picture":     "",
	}
}

// mockTenantEmailDomain is the mailbox domain /userinfo profiles carry; a
// reserved test TLD so no seeded account can ever collide with a real one.
const mockTenantEmailDomain = "tenant.stigmer.test"

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

	m.server = &http.Server{Handler: m.oidcMux()}
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
