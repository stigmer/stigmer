package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The registry proxies (/v1/proxy/task-kind-registry, /v1/proxy/model-registry)
// are public static JSON consumed cross-origin by the web console. The
// gRPC-Web wrapper's allow-all CORS policy does not cover them — they route
// around it — so they must carry their own headers or every browser fetch is
// blocked and the console's task palette and model pickers never load
// (oss#571).
func TestRegistryCORS_GetCarriesAllowOrigin(t *testing.T) {
	wrapped := registryCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/proxy/task-kind-registry", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("GET should carry Access-Control-Allow-Origin '*'; got %q", got)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("GET should pass through to the handler; got status %d", rec.Code)
	}
	if body := rec.Body.String(); body != `{"ok":true}` {
		t.Fatalf("GET should return the handler's body; got %q", body)
	}
}

func TestRegistryCORS_PreflightShortCircuits(t *testing.T) {
	handlerCalled := false
	wrapped := registryCORS(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		handlerCalled = true
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1/proxy/model-registry", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)

	if handlerCalled {
		t.Fatal("OPTIONS preflight must not reach the wrapped handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight should answer 204; got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("preflight should carry Access-Control-Allow-Origin '*'; got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatal("preflight should advertise allowed methods")
	}
}
