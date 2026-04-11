package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// PKCEPair holds a PKCE code verifier and its corresponding S256 challenge.
type PKCEPair struct {
	CodeVerifier  string
	CodeChallenge string
}

// GeneratePKCE creates a cryptographically random PKCE pair using the S256 method.
//
// The code verifier is a 32-byte random value encoded as base64url (no padding).
// The code challenge is the SHA-256 hash of the verifier, also base64url-encoded.
// This follows RFC 7636 and OAuth 2.1 requirements.
func GeneratePKCE() (*PKCEPair, error) {
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		return nil, err
	}

	verifier := base64.RawURLEncoding.EncodeToString(verifierBytes)

	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])

	return &PKCEPair{
		CodeVerifier:  verifier,
		CodeChallenge: challenge,
	}, nil
}
