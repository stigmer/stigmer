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
// IdentityProvider federation without an external IdP.
type MockJWKSServer struct {
	URL        string
	JWKSURL    string
	Issuer     string
	privateKey *rsa.PrivateKey
	keyID      string
	server     *http.Server
	listener   net.Listener
}

// StartMockJWKSServer creates an in-process HTTP server that serves a JWKS
// endpoint at /jwks. The server is stopped on test cleanup.
func StartMockJWKSServer(t *testing.T, issuer string) *MockJWKSServer {
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

	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		jwks := map[string]any{
			"keys": []map[string]any{
				{
					"kty": "RSA",
					"use": "sig",
					"kid": keyID,
					"alg": "RS256",
					"n":   base64.RawURLEncoding.EncodeToString(privateKey.N.Bytes()),
					"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privateKey.E)).Bytes()),
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	})

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
