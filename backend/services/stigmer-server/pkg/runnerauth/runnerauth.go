// Package runnerauth mints and verifies the execution-scoped runner tokens
// that gate the ExecutionContext decrypt lane on OSS (oss#535).
//
// # Why this exists
//
// Since oss#535, the EC read RPCs redact is_secret values for every caller —
// the same contract the cloud edition enforces (stigmer-cloud#152) — but the
// runner still needs the real values to serve executions. The cloud
// distinguishes the runner by the token_type claim of its platform-minted
// credential; OSS has no authentication at all, so this package supplies the
// minimal equivalent: GetRunnerScopedToken mints a short-lived token bound to
// one execution, and the EC getByExecutionId handler decrypts only for a
// token whose binding matches the requested ExecutionContext.
//
// # A lane discriminator, not a trust boundary
//
// Single-user OSS has no identity to verify: anyone who can reach the server
// can call the exchange and mint a token (the same way they could read the
// key file, or the store itself). What the token buys is NOT access control —
// it is the mechanism that lets the read contract converge with cloud
// (user-shaped reads are redacted, the runner's decrypt is deliberate and
// bound to the exact EC it serves) without breaking execution. The real
// security win of oss#535 is encryption at rest; this lane is what makes
// redaction-by-default possible on top of it.
//
// # Token shape
//
// Standard JWT (HS256) so the runner's claim inspector
// (backend/services/runner/src/client/token-claims.ts) can parse it like any
// other Stigmer-minted credential:
//
//	{"token_type": "execution_scoped", "execution_id": "<id>", "iat": ..., "exp": ...}
//
// The cloud vocabulary (sandbox / workflow_sandbox / connect_sandbox) encodes
// cloud's sandbox architecture — warm pools, session-scoped multi-turn
// sandboxes — which OSS does not have. Every OSS exchange arm names the id
// that IS the ExecutionContext's spec.execution_id (agent execution, workflow
// execution, connect request), so one honest token type with a direct
// execution_id binding replaces the three cloud types; the verifier is a
// string compare, with no parent-resource loads.
//
// The signing key rides the encryption-key convention (oss#405):
// STIGMER_RUNNER_TOKEN_KEY env var, else ~/.stigmer/runner-token.key,
// else auto-generated.
package runnerauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

const (
	// TokenTypeExecutionScoped is the token_type claim of every OSS-minted
	// runner token. Deliberately distinct from the cloud sandbox vocabulary:
	// borrowing "sandbox" while carrying different claims would mislead
	// anyone debugging across editions.
	TokenTypeExecutionScoped = "execution_scoped"

	// EnvKeyName configures the signing key (Base64-encoded 32 bytes),
	// mirroring STIGMER_ENCRYPTION_KEY.
	EnvKeyName = "STIGMER_RUNNER_TOKEN_KEY"

	// KeyFileName is the auto-generated key file under ~/.stigmer.
	KeyFileName = "runner-token.key"

	// DefaultTTL bounds a minted token's lifetime. Tokens are minted
	// immediately before each ExecutionContext read (or carried in a connect
	// workflow's dispatch payload), so the TTL only needs to cover one unit
	// of dispatched work including its Temporal retries. An hour is generous
	// without being an effectively-permanent credential in Temporal history.
	DefaultTTL = time.Hour
)

// ErrInvalidToken is returned by Verify for any token that does not carry a
// valid, unexpired, execution-scoped binding. Callers fail closed to
// redaction on it; the reason is deliberately not distinguished (a forged
// signature and an expired token get the same answer).
var ErrInvalidToken = errors.New("invalid runner token")

// ErrMintingDisabled is returned by Mint when the service has no signing key
// (keyless deployments, effectively test-only — NewServiceFromEnv
// auto-generates). The exchange RPC maps it to the presence-based
// "not minted" response the runner already handles.
var ErrMintingDisabled = errors.New("runner token minting is disabled - no signing key configured")

// Service mints and verifies execution-scoped runner tokens with a single
// HMAC-SHA256 key. Stateless and safe for concurrent use.
type Service struct {
	key []byte
}

// NewService creates a Service with the given signing key. A nil/empty key
// yields a disabled service: Mint fails with ErrMintingDisabled and Verify
// rejects everything (fail closed — without a key no token can be genuine).
func NewService(key []byte) *Service {
	return &Service{key: key}
}

// NewServiceFromEnv creates a Service with the key resolved via the shared
// convention (env var, key file, auto-generate). Errors only on unusable
// explicit configuration, matching encryption.NewSecretServiceFromEnv.
func NewServiceFromEnv() (*Service, error) {
	key, err := encryption.GetOrCreateNamedKey(EnvKeyName, KeyFileName)
	if err != nil {
		return nil, fmt.Errorf("failed to load runner token key: %w", err)
	}
	return NewService(key), nil
}

// IsEnabled reports whether the service holds a signing key.
func (s *Service) IsEnabled() bool {
	return len(s.key) > 0
}

// tokenClaims is the JWT payload. Field names are wire contract: the
// runner's token-claims.ts reads token_type by name, and the EC resolve
// step binds on execution_id.
type tokenClaims struct {
	TokenType   string `json:"token_type"`
	ExecutionID string `json:"execution_id"`
	IssuedAt    int64  `json:"iat"`
	ExpiresAt   int64  `json:"exp"`
}

// jwtHeader is constant: HS256 is the only algorithm this package ever
// produces or accepts (alg confusion is refused in Verify).
var jwtHeader = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

// Mint issues a token bound to executionID, valid for ttl (DefaultTTL when
// ttl <= 0). Returns the token and its lifetime in whole seconds — the shape
// GetRunnerScopedTokenOutput wants.
func (s *Service) Mint(executionID string, ttl time.Duration) (string, int64, error) {
	if !s.IsEnabled() {
		return "", 0, ErrMintingDisabled
	}
	if executionID == "" {
		return "", 0, errors.New("execution id is required to mint a runner token")
	}
	if ttl <= 0 {
		ttl = DefaultTTL
	}

	now := time.Now()
	payload, err := json.Marshal(tokenClaims{
		TokenType:   TokenTypeExecutionScoped,
		ExecutionID: executionID,
		IssuedAt:    now.Unix(),
		ExpiresAt:   now.Add(ttl).Unix(),
	})
	if err != nil {
		return "", 0, fmt.Errorf("failed to marshal runner token claims: %w", err)
	}

	signingInput := jwtHeader + "." + base64.RawURLEncoding.EncodeToString(payload)
	token := signingInput + "." + s.sign(signingInput)
	return token, int64(ttl / time.Second), nil
}

// Verify checks signature, algorithm, expiry, and token type, and returns
// the execution id the token is bound to. Any failure is ErrInvalidToken:
// the caller's only correct reaction is to fall closed to redaction, so a
// finer-grained error would just invite branching on it.
func (s *Service) Verify(token string) (string, error) {
	if !s.IsEnabled() {
		return "", ErrInvalidToken
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", ErrInvalidToken
	}

	// Pin the exact header this package mints. Comparing the encoded form
	// refuses alg-confusion inputs without parsing attacker-controlled JSON.
	if parts[0] != jwtHeader {
		return "", ErrInvalidToken
	}

	signingInput := parts[0] + "." + parts[1]
	expected := s.sign(signingInput)
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return "", ErrInvalidToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", ErrInvalidToken
	}
	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", ErrInvalidToken
	}

	if claims.TokenType != TokenTypeExecutionScoped ||
		claims.ExecutionID == "" ||
		time.Now().Unix() >= claims.ExpiresAt {
		return "", ErrInvalidToken
	}

	return claims.ExecutionID, nil
}

// sign computes the base64url-encoded HMAC-SHA256 of signingInput.
func (s *Service) sign(signingInput string) string {
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(signingInput))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
