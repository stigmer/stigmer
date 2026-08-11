package oauth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// AuthorizeRejection describes a definite refusal from an authorization
// endpoint, observed before any browser was involved.
type AuthorizeRejection struct {
	// StatusCode is the HTTP status the authorization endpoint returned.
	StatusCode int
	// VendorDetail is the provider's own explanation, extracted from an
	// RFC 6749-shaped JSON error body (error_description, falling back to
	// error). Empty when the body is HTML or otherwise unparseable.
	VendorDetail string
	// BodySnippet is a truncated copy of the raw response body, for logs.
	BodySnippet string
}

// Redirects are deliberately not followed: a healthy authorization endpoint
// answers a fresh GET with either a login/consent page (2xx) or a redirect
// into the vendor's login flow (3xx), and the first response alone is enough
// to classify. The timeout is small because this probe sits on the
// user-facing initiate path, after discovery and DCR round trips.
var preflightHTTPClient = &http.Client{
	Timeout: 4 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// PreflightAuthorize probes an authorization URL server-side and reports
// whether the provider will refuse it before ever showing a login page.
//
// Some providers (e.g. Canva) accept Dynamic Client Registration for any
// redirect URI but enforce a redirect-host allowlist at the authorization
// endpoint. The rejection then surfaces only inside the OAuth popup, on a
// vendor error page that never redirects back — so the connect flow never
// learns it failed (stigmer/stigmer#235). This probe moves that discovery
// to initiate time, where it can fail fast with an honest error.
//
// Classification is deliberately narrow — blocked means HTTP 400, nothing
// else. RFC 6749 §4.1.2.1 requires an invalid-redirect rejection to be shown
// at the authorization server without redirecting, which providers implement
// as a 400. Everything else fails open (nil, possibly with a diagnostic
// error): bot-protection layers answer server-side GETs with 403/503 while
// real browsers pass, and treating those as blocked would turn healthy
// providers into false dead ends. A fail-open miss merely preserves today's
// behavior; a false positive would break a working connect flow.
//
// The probe is side-effect-free: state and PKCE parameters are opaque to the
// authorization server at this point, and nothing is consumed until the
// callback leg, which the probe never reaches.
func PreflightAuthorize(ctx context.Context, authorizationURL string) (*AuthorizeRejection, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, authorizationURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := preflightHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		return nil, nil
	}

	// Bounded read: error pages are small; anything longer is noise.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	return &AuthorizeRejection{
		StatusCode:   resp.StatusCode,
		VendorDetail: extractVendorDetail(body),
		BodySnippet:  truncateBody(body),
	}, nil
}

// extractVendorDetail pulls the provider's own words from an RFC 6749-shaped
// JSON error body. HTML error pages (Canva's case) yield "" — scraping
// prose out of markup is not worth the fragility.
func extractVendorDetail(body []byte) string {
	var parsed struct {
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ""
	}
	if parsed.ErrorDescription != "" {
		return parsed.ErrorDescription
	}
	return parsed.Error
}
