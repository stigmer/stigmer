package oauth

// Classification pins for the authorize pre-flight probe (oss#235).
//
// The load-bearing invariant is the fail-open arm: 403/5xx/redirects must
// NOT classify as blocked, because bot-protection layers answer server-side
// GETs with exactly those while real browsers pass. A regression here turns
// healthy providers into false dead ends — strictly worse than the popup
// dead end the probe exists to prevent.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func probeStatus(t *testing.T, statusCode int, contentType, body string) (*AuthorizeRejection, error) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return PreflightAuthorize(context.Background(), srv.URL+"/authorize?client_id=x")
}

func TestPreflightAuthorize_400WithJSONDetail(t *testing.T) {
	rejection, err := probeStatus(t, http.StatusBadRequest, "application/json",
		`{"error":"invalid_request","error_description":"Redirect host not allowed"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rejection == nil {
		t.Fatal("expected a rejection for HTTP 400")
	}
	if rejection.StatusCode != http.StatusBadRequest {
		t.Errorf("StatusCode = %d, want 400", rejection.StatusCode)
	}
	if rejection.VendorDetail != "Redirect host not allowed" {
		t.Errorf("VendorDetail = %q, want error_description", rejection.VendorDetail)
	}
}

func TestPreflightAuthorize_400JSONFallsBackToErrorCode(t *testing.T) {
	rejection, err := probeStatus(t, http.StatusBadRequest, "application/json",
		`{"error":"invalid_request"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rejection == nil {
		t.Fatal("expected a rejection for HTTP 400")
	}
	if rejection.VendorDetail != "invalid_request" {
		t.Errorf("VendorDetail = %q, want error code fallback", rejection.VendorDetail)
	}
}

func TestPreflightAuthorize_400WithHTMLBody(t *testing.T) {
	// Canva's shape: an HTML error page. No detail extraction — the snippet
	// is for logs only.
	rejection, err := probeStatus(t, http.StatusBadRequest, "text/html",
		`<html><body>Invalid redirect URI. It must be from an allowed host.</body></html>`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rejection == nil {
		t.Fatal("expected a rejection for HTTP 400")
	}
	if rejection.VendorDetail != "" {
		t.Errorf("VendorDetail = %q, want empty for HTML body", rejection.VendorDetail)
	}
	if !strings.Contains(rejection.BodySnippet, "Invalid redirect URI") {
		t.Errorf("BodySnippet = %q, want the raw body for logging", rejection.BodySnippet)
	}
}

func TestPreflightAuthorize_FailsOpenOnNon400(t *testing.T) {
	// 403/503 are bot-protection signatures; 200 is a login page; all must
	// fall open.
	for _, statusCode := range []int{
		http.StatusOK,
		http.StatusUnauthorized,
		http.StatusForbidden,
		http.StatusNotFound,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusServiceUnavailable,
	} {
		rejection, err := probeStatus(t, statusCode, "text/html", "irrelevant")
		if err != nil {
			t.Errorf("HTTP %d: unexpected error: %v", statusCode, err)
		}
		if rejection != nil {
			t.Errorf("HTTP %d classified as blocked; only 400 may block", statusCode)
		}
	}
}

func TestPreflightAuthorize_DoesNotFollowRedirects(t *testing.T) {
	// A healthy authorize endpoint 302s into the vendor's login flow. The
	// probe must classify on the first response and never chase it — the
	// redirect target could be slow, external, or (in tests) nonexistent.
	redirectTargetHits := 0
	mux := http.NewServeMux()
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		redirectTargetHits++
	})
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/login", http.StatusFound)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	rejection, err := PreflightAuthorize(context.Background(), srv.URL+"/authorize")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rejection != nil {
		t.Fatal("302 classified as blocked; redirects mean healthy")
	}
	if redirectTargetHits != 0 {
		t.Errorf("probe followed the redirect (%d hits); it must classify on the first response", redirectTargetHits)
	}
}

func TestPreflightAuthorize_NetworkErrorIsDiagnosticOnly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // guarantee a connection refusal

	rejection, err := PreflightAuthorize(context.Background(), srv.URL+"/authorize")
	if rejection != nil {
		t.Fatal("network error classified as blocked; it must fall open")
	}
	if err == nil {
		t.Error("expected a diagnostic error for the caller's debug log")
	}
}
