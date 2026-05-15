package harness

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
)

// MockHTTPServer wraps httptest.Server with typed route configuration.
type MockHTTPServer struct {
	Server *httptest.Server
}

// MockRoute defines a single mock endpoint's behavior.
type MockRoute struct {
	Method     string
	Path       string
	StatusCode int
	Response   any
}

// NewMockHTTPServer creates an unstarted mock HTTP server with the given routes.
// Routes are matched by method + path. Unmatched requests return 404.
func NewMockHTTPServer(routes []MockRoute) *MockHTTPServer {
	lookup := make(map[string]MockRoute, len(routes))
	for _, r := range routes {
		lookup[r.Method+" "+r.Path] = r
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		route, ok := lookup[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(route.StatusCode)
		if route.Response != nil {
			json.NewEncoder(w).Encode(route.Response)
		}
	})

	return &MockHTTPServer{
		Server: httptest.NewServer(mux),
	}
}

// URL returns the base URL of the running test server.
func (m *MockHTTPServer) URL() string {
	return m.Server.URL
}

// Close shuts down the mock server.
func (m *MockHTTPServer) Close() {
	m.Server.Close()
}
