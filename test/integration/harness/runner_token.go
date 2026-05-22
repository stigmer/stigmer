package harness

import (
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// stigmerJWTSigningKeyBase64 is the same RSA PKCS#8 key passed to the Java
// service as STIGMER_JWT_SIGNING_KEY. Keeping it here (rather than extracting
// from service.go) avoids a circular dependency and makes the contract explicit:
// the test harness mints JWTs that the Java service's StigmerJwtVerifier can validate.
const stigmerJWTSigningKeyBase64 = "MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDB/JFw1MvV4YF/VrnuT0nqnCjD5SUqMVT9r7lMjGrl1Zqz01dDwN3FcgBjAqtnTG5ij56Qp4WP5G5trIopwHNCSNyYvBPrOSfv9JrXP0mg1hACdra3mlY5MwyhLvdnUyyj1L7U9RveDr9u/WGfBneyHhrfz3b900ezFp492YGIjHJwCXrKJ9CBAFKVv35DNp3xhXXB1/gGUYlR8nShLx/TuJEZNEgtPPPte706Md1lNC3WMzyAbk3MSaQ6MKSC3b7eiD9Ug2c7wwsxd+niwupefef3IMKSUMfTcqIZg/11ENc94EhNd4VMa5GsXK6QbrJ5J1Hk96zNfG6f44+1K3QLAgMBAAECggEATB/HG1YGX3pNDSGFeUVYJl79iFJF0VbmmV76AlYgJO079lF7LzViUfc4u6HyjWjq8HaXrQBwY1UrGJLa7SN+l4ZsOuujjW0yhPGiSdGmHR2jzrOzZD2GlI+55w69O6jiHbCA6qT9OJjk+rMoOfWZxyYVObr6YQUmX9sCYhcWw/RZvTtSI24Zuz3+vsujbZKs+5c+D7YH2xSmFuSScStg0KUnGfIEwna96/Ckw2XuW1LDhxWIW+BEQ85lpQoQDKAbEQIG9j8gc+5EBdPT/t59Sv7pVR4sM6FdHf5/+BHQEjClaa9UjZ6H6vHZpfPq5XLi+9JnMcZJnpV8EkyAVvhXgQKBgQD12RBJxzejHO5Sj8kuNXSgGcrDe/5iR1X/LoaaiM2vbA4DfxEGsrh9Pv8NOy9K45G96ZFwyLtwO/htGXMh7Fyx1ci8A7vEOZHNyw962BPaO1HRr6ntVj+W8xobQpYrNjLaFR7J1jp0NiRrils4qF4UqIzPTuVnsGdtTfmbiailIQKBgQDJ/0MY2vXHpX3SvnzeyKKmhcPMQ3XE9RF3gkHuiydEcoQ7eD4lEJId52tCwlzWsxNO9TOwWYGw1EcCBLFGjsc16iNkkxLIi4MfdQWmnlu5vaNfuGiV3mIhX81ZPnlRHuhD+DE3dquaFLAFBwOzpfOqY8qO96WTuPjyq29965lHqwKBgGeeMzVFV/fRq8j0fVCSizMna8R0sETv2BkTnPvpCPgUzNtAZQazsPpo4MrM1SP1QmoO1ZP5prapMA2bmmED5BW4C0DjOfJ8aS2Zlk6qX8OtGNEN/srffTG8CJbQu8Y+s7QjDrT3K+/rGfKRf90jaXO/jomZsSrAuPbi1H9vx7rBAoGABaDJG84t/uwLf22zSPnKHl2nwO84Ps6dN/k3IRBbfbq7GHUXNi0qBQ9Hm8qSj6DZrt+CGy3DQUwI1nOPBOpBfq0RY2H9qfzJIH1ANQ5AfAJepPIcZ+CUV121+QCWnL4BtrMZm/QAgACHjvxNDBpZmavCHw2jXWRP+2LvblC8KpUCgYAt7EV7aSCMDoeQ8MU99Ps3xmPJRA6L6hLftephSVtufQff5UsestdF61SJ6QJ3GSytMqXisIuHEghsPcXfg6TqKxbxvkPRlIlQJa9A2JQ/1Dp4OPv1JtaqcO8H8kTVfIPnHP6y7UFNjBPSWtqvnBhoEgt0WUer2O16mWlefo5MLg=="

// MintRunnerToken creates a Stigmer-signed JWT for the unified runner,
// matching what SandboxTokenService does in production. The Java service's
// StigmerJwtVerifier validates this token and resolves the caller identity
// from the `sub` claim — establishing the correct FGA authorization chain.
func MintRunnerToken() (string, error) {
	keyBytes, err := base64.StdEncoding.DecodeString(stigmerJWTSigningKeyBase64)
	if err != nil {
		return "", fmt.Errorf("decode signing key: %w", err)
	}

	privateKey, err := x509.ParsePKCS8PrivateKey(keyBytes)
	if err != nil {
		return "", fmt.Errorf("parse PKCS8 private key: %w", err)
	}

	now := time.Now()
	claims := jwt.MapClaims{
		"iss":   "stigmer",
		"sub":   testIdentityAccountID,
		"iat":   now.Unix(),
		"exp":   now.Add(4 * time.Hour).Unix(),
		"org":   testOrg,
		"email": "test@integration.stigmer.ai",
		"name":  "Integration Test Runner",
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "stigmer-signing-key-1"

	signed, err := token.SignedString(privateKey)
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}

	return signed, nil
}
