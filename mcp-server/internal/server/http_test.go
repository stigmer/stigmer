package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/auth"
)

func TestExtractBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"valid token", "Bearer sk-12345", "sk-12345"},
		{"missing header", "", ""},
		{"basic auth", "Basic dXNlcjpwYXNz", ""},
		{"bearer lowercase", "bearer sk-12345", ""},
		{"bearer with extra whitespace", "Bearer   sk-12345  ", "sk-12345"},
		{"bearer empty token", "Bearer ", ""},
		{"just bearer keyword", "Bearer", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.header != "" {
				r.Header.Set("Authorization", tt.header)
			}
			got := extractBearerToken(r)
			if got != tt.want {
				t.Errorf("extractBearerToken = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestHealthHandler(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health", nil)

	healthHandler(w, r)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	body := strings.TrimSpace(w.Body.String())
	if body != `{"status":"ok"}` {
		t.Errorf("body = %q, want %q", body, `{"status":"ok"}`)
	}
}

func TestAuthMiddleware_validToken(t *testing.T) {
	var called bool
	var gotKey string

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		key, err := auth.GetAPIKey(r.Context())
		if err != nil {
			t.Errorf("inner handler: GetAPIKey error: %v", err)
			return
		}
		gotKey = key
		w.WriteHeader(http.StatusOK)
	})

	handler := authMiddleware(inner)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	r.Header.Set("Authorization", "Bearer my-secret")

	handler.ServeHTTP(w, r)

	if !called {
		t.Fatal("inner handler was not called")
	}
	if gotKey != "my-secret" {
		t.Errorf("API key = %q, want %q", gotKey, "my-secret")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestAuthMiddleware_missingToken(t *testing.T) {
	var called bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := authMiddleware(inner)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)

	handler.ServeHTTP(w, r)

	if called {
		t.Fatal("inner handler should not be called when token is missing")
	}
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_malformedToken(t *testing.T) {
	var called bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := authMiddleware(inner)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	r.Header.Set("Authorization", "Basic dXNlcjpwYXNz")

	handler.ServeHTTP(w, r)

	if called {
		t.Fatal("inner handler should not be called for non-Bearer auth")
	}
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestStatusWriter_capturesCode(t *testing.T) {
	w := httptest.NewRecorder()
	sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}

	sw.WriteHeader(http.StatusNotFound)

	if sw.status != http.StatusNotFound {
		t.Errorf("status = %d, want %d", sw.status, http.StatusNotFound)
	}
	if w.Code != http.StatusNotFound {
		t.Errorf("underlying recorder status = %d, want %d", w.Code, http.StatusNotFound)
	}
}
