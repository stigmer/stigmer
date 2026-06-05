package harness

import (
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// StigmerJWTSigningKeyBase64 is the same RSA PKCS#8 key passed to the Java
// service as STIGMER_JWT_SIGNING_KEY (see buildServiceEnv). Keeping it here
// (rather than extracting from service.go) avoids a circular dependency and
// makes the contract explicit: the test harness mints JWTs that the Java
// service's StigmerJwtVerifier can validate.
const StigmerJWTSigningKeyBase64 = "MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDB/JFw1MvV4YF/VrnuT0nqnCjD5SUqMVT9r7lMjGrl1Zqz01dDwN3FcgBjAqtnTG5ij56Qp4WP5G5trIopwHNCSNyYvBPrOSfv9JrXP0mg1hACdra3mlY5MwyhLvdnUyyj1L7U9RveDr9u/WGfBneyHhrfz3b900ezFp492YGIjHJwCXrKJ9CBAFKVv35DNp3xhXXB1/gGUYlR8nShLx/TuJEZNEgtPPPte706Md1lNC3WMzyAbk3MSaQ6MKSC3b7eiD9Ug2c7wwsxd+niwupefef3IMKSUMfTcqIZg/11ENc94EhNd4VMa5GsXK6QbrJ5J1Hk96zNfG6f44+1K3QLAgMBAAECggEATB/HG1YGX3pNDSGFeUVYJl79iFJF0VbmmV76AlYgJO079lF7LzViUfc4u6HyjWjq8HaXrQBwY1UrGJLa7SN+l4ZsOuujjW0yhPGiSdGmHR2jzrOzZD2GlI+55w69O6jiHbCA6qT9OJjk+rMoOfWZxyYVObr6YQUmX9sCYhcWw/RZvTtSI24Zuz3+vsujbZKs+5c+D7YH2xSmFuSScStg0KUnGfIEwna96/Ckw2XuW1LDhxWIW+BEQ85lpQoQDKAbEQIG9j8gc+5EBdPT/t59Sv7pVR4sM6FdHf5/+BHQEjClaa9UjZ6H6vHZpfPq5XLi+9JnMcZJnpV8EkyAVvhXgQKBgQD12RBJxzejHO5Sj8kuNXSgGcrDe/5iR1X/LoaaiM2vbA4DfxEGsrh9Pv8NOy9K45G96ZFwyLtwO/htGXMh7Fyx1ci8A7vEOZHNyw962BPaO1HRr6ntVj+W8xobQpYrNjLaFR7J1jp0NiRrils4qF4UqIzPTuVnsGdtTfmbiailIQKBgQDJ/0MY2vXHpX3SvnzeyKKmhcPMQ3XE9RF3gkHuiydEcoQ7eD4lEJId52tCwlzWsxNO9TOwWYGw1EcCBLFGjsc16iNkkxLIi4MfdQWmnlu5vaNfuGiV3mIhX81ZPnlRHuhD+DE3dquaFLAFBwOzpfOqY8qO96WTuPjyq29965lHqwKBgGeeMzVFV/fRq8j0fVCSizMna8R0sETv2BkTnPvpCPgUzNtAZQazsPpo4MrM1SP1QmoO1ZP5prapMA2bmmED5BW4C0DjOfJ8aS2Zlk6qX8OtGNEN/srffTG8CJbQu8Y+s7QjDrT3K+/rGfKRf90jaXO/jomZsSrAuPbi1H9vx7rBAoGABaDJG84t/uwLf22zSPnKHl2nwO84Ps6dN/k3IRBbfbq7GHUXNi0qBQ9Hm8qSj6DZrt+CGy3DQUwI1nOPBOpBfq0RY2H9qfzJIH1ANQ5AfAJepPIcZ+CUV121+QCWnL4BtrMZm/QAgACHjvxNDBpZmavCHw2jXWRP+2LvblC8KpUCgYAt7EV7aSCMDoeQ8MU99Ps3xmPJRA6L6hLftephSVtufQff5UsestdF61SJ6QJ3GSytMqXisIuHEghsPcXfg6TqKxbxvkPRlIlQJa9A2JQ/1Dp4OPv1JtaqcO8H8kTVfIPnHP6y7UFNjBPSWtqvnBhoEgt0WUer2O16mWlefo5MLg=="

// StigmerPreviousJWTSigningKeyBase64 is a second, independent RSA PKCS#8 key
// used to exercise the key-rotation overlap. When the Java service is started
// with this as STIGMER_JWT_SIGNING_KEY_PREVIOUS, tokens signed with it must
// still verify (rotation overlap), while the primary key keeps minting.
const StigmerPreviousJWTSigningKeyBase64 = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCm9ICZqgiOhg5b30fjlxrMnTIZ1akXLyQw2spCkeRVsyKv6d4U8v+Ud20s58kov3kCUZbj++CJe8uKkEUC2x1MAq1zlsZF0/OpVFhfIcQ6eSY3mTriHo64KcDTt+uCJ2mAcJmGG7pWD6A/2KFtaNYRrGBdGvDtmwb3eTS3Oj1xtE8+qqSAivbwe/JKjCXnNE6CCggwIWlZ7Cb+wrn6JfimNg3da5r+hOkrl3wnsx/S9GuRo6rGRpR3yFH7HJwfFD7PZVQvnddSlu2P31a7ME1S7s4nmc3BwsfUeLUgOFWt2esIsjfhepI3/nXBnpZQu3aDgnAHetcfbEeRXMRzNYVrAgMBAAECggEAQEFj6UA2sNvJVPSXT3GNf+iUKrs/q8uZ6y+ZnotVzOH33KpurbNkSDi6jQjcM9GVeh36q9356g/6I2cpGFNKcEGrjgweXSuY4Le0l1CAnFyaJ9XSgspt9VUkgJeNjXcrtKIhhCrRyWOUMl5mqpwpn32vTMYcqeX7hW1hq48/rK2vgs7JfQyjIxQroRyKy2sxswMq7n6UiZhqnzcGDi3pMXNkqDX0hdn0KRNXkU3AfOcqDhcQKdVD7kSs4AoHy7L1ywEu03XxgLPNBCSFKiecj3nWn4YgQcxrX/Z2F3XUNYN0/V1h0LlI6kZe8HLqQ5xNl6aVj9zYKCbzfqJ6ZTnE8QKBgQDoeFxYyhD5sXUJwWrjmn++cLvyTPud0uH0MUVkuW43eFfhLfea9SCiTBOnNB+ImDuQotgXFO4IUnEces4qlzphFgyH4xh5/QRGSyfsrxnU5ooUOIK7Iz5Lo9WYyVU7WU83ctt/QnGULzcib5AZ7Xrih0nMUvT2r5Ow1nHpbfm3UwKBgQC32o0OmsHOEwk8S92x50/wk6ft3Hln8GwWfUrGmZjV5pUL6rB5LsRxY5CITmk4BU8ZIuQoBzyJjWWhQs/PbRbhNKSQxqGr/G/qJNJG2ieYbxbUARZyGJQK4KFs4ujzyguqaXi+1OW3aJti4amxx1nG8jjkG/EgPIoWFGfQwyiuiQKBgA+h4FvcIq4Xv84LIpvxjLuKqyjNAnKHdshL8+WlDoNOZWJwC+FwsGQZh4zL1X8C9aZxPOS4dJU8rfyDSY/VoYhbyjXtEH1LhVkQvruMvsjxQ8G+VxQsd4jwmHFwwHmANPJ+l8ID/s0/K472P5Nuw7+t50mFHpHkFqNimEBhM9SfAoGBAKlcf0Ir10oRCRntPRzL2zzfl/sqdQAFXlxdMIvAJCUu0q/2kngfV8CoGhUmPhDn+xRJqukguWhww2UI2cvXTxNH3iyrfXSkBygmoTm5bm4iL2I+WkHiWEWo5asbX8JrpdFmdV89WRtaFoHBJQPqgs4chcHD55xtiDqMs5GApbIZAoGARD44hglJWbo/D9TvDmKiHBQFziO7GUvSbmDphYCGUk5Lgco6S8mnB9KydStzDKrLiZIwUBfftSPZj/9vElZWqwNcVe+U2x5vsxdUM5xyElIwaHLM4jOxRIs2tgunTu1w5qt3w3cpoLXAGZN9JClcHBlmXoUEtmAqpYXSZpHXLYI="

// StigmerJWTAudience is the environment audience the harness configures on the
// Java service (STIGMER_JWT_AUDIENCE) and stamps on minted tokens. It models the
// production behavior where every Stigmer token is bound to its environment's API
// base URL so a token minted by another environment is rejected on its claims.
const StigmerJWTAudience = "https://api.stigmer.test"

// MintRunnerToken creates a Stigmer-signed JWT for the unified runner,
// matching what SandboxTokenService does in production. The Java service's
// StigmerJwtVerifier validates this token and resolves the caller identity
// from the `sub` claim — establishing the correct FGA authorization chain.
//
// It omits the audience claim, exercising the lenient verification path
// (no-aud tokens are accepted) that keeps pre-change tokens working during
// the audience rollout.
func MintRunnerToken() (string, error) {
	return MintStigmerToken(StigmerJWTSigningKeyBase64, "stigmer-signing-key-1", testIdentityAccountID)
}

// MintStigmerToken signs a sandbox-style Stigmer JWT (iss="stigmer") with the
// supplied Base64 PKCS#8 private key and kid, using sub as the caller identity.
// It is the building block for MintRunnerToken and for tests that exercise
// key-rotation overlap or signature-mismatch scenarios. No audience is set.
func MintStigmerToken(keyBase64, kid, sub string) (string, error) {
	return MintStigmerTokenWithAudience(keyBase64, kid, sub, "")
}

// MintStigmerTokenWithAudience is MintStigmerToken with an explicit audience
// (aud) claim. An empty audience omits the claim entirely. Tests use this to
// drive the audience-binding paths: a matching aud verifies, while an aud naming
// another environment is rejected as a misrouted (foreign) token.
func MintStigmerTokenWithAudience(keyBase64, kid, sub, audience string) (string, error) {
	keyBytes, err := base64.StdEncoding.DecodeString(keyBase64)
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
		"sub":   sub,
		"iat":   now.Unix(),
		"exp":   now.Add(4 * time.Hour).Unix(),
		"org":   TestOrg,
		"email": "test@integration.stigmer.ai",
		"name":  "Integration Test Runner",
	}
	if audience != "" {
		claims["aud"] = audience
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid

	signed, err := token.SignedString(privateKey)
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}

	return signed, nil
}
