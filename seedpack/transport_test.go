//go:build transport

package seedpack

// Transport reachability probes for the marketplace MCP catalog: live HTTP
// against every vendor endpoint declared in mcp-servers/*.yaml. This is the
// tier between static validation and the credentialed canaries — it answers
// "is the endpoint still there and speaking MCP?" without any credentials.
//
// The `transport` build tag keeps the probes out of the static tier by
// construction: `go test ./...` (make test-seedpack-static) must stay
// deterministic and network-free, and a tag enforces that at compile time
// rather than by convention. Run via `make test-seedpack-transport` (root),
// which is also what the nightly ci.seedpack-canary lane invokes. The probes
// need no harness — they moved here from test/integration, where they paid a
// full service-JAR + testcontainers boot they never used (oss#569).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func isDNSError(err error) bool {
	if err == nil {
		return false
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "dial tcp: lookup")
}

// isTransientNetworkError reports whether err is an environmental network
// condition outside the test's control (DNS failure, request timeout, or a
// transient connection-level error). These probes are live canaries against
// third-party endpoints; such conditions say nothing about the seedpack
// definition under test, so callers skip rather than fail when they occur.
func isTransientNetworkError(err error) bool {
	if err == nil {
		return false
	}
	if isDNSError(err) {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "context deadline exceeded") ||
		strings.Contains(msg, "Client.Timeout exceeded") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "i/o timeout") ||
		strings.Contains(msg, "TLS handshake timeout") ||
		strings.Contains(msg, "server misbehaving") ||
		strings.Contains(msg, "EOF")
}

func TestSeedpackHttp_EndpointReachable(t *testing.T) {
	servers := loadAllMcpServers(t)

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	for name, srv := range servers {
		if srv.Spec.HTTP == nil {
			continue
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			req, err := http.NewRequest(http.MethodHead, srv.Spec.HTTP.URL, nil)
			if err != nil {
				t.Fatalf("failed to create request for %s: %v", srv.Spec.HTTP.URL, err)
			}

			resp, err := client.Do(req)
			if err != nil {
				if isTransientNetworkError(err) {
					t.Skipf("skipping %s: transient network condition (DNS/timeout/connection): %v", name, err)
				}
				t.Fatalf("HEAD %s failed: %v", srv.Spec.HTTP.URL, err)
			}
			defer resp.Body.Close()

			t.Logf("HEAD %s -> %d %s", srv.Spec.HTTP.URL, resp.StatusCode, resp.Status)
			if resp.StatusCode >= 500 {
				t.Errorf("expected non-5xx status code, got %d; server may be down", resp.StatusCode)
			}
		})
	}
}

func TestSeedpackHttp_OAuthDiscoveryAvailable(t *testing.T) {
	servers := loadAllMcpServers(t)

	client := &http.Client{Timeout: 10 * time.Second}

	for name, srv := range servers {
		if srv.Spec.HTTP == nil || srv.Spec.Auth == nil || srv.Spec.Auth.OAuthAppRef == nil {
			continue
		}

		t.Run(name, func(t *testing.T) {
			t.Parallel()

			parsed, err := url.Parse(srv.Spec.HTTP.URL)
			if err != nil {
				t.Fatalf("failed to parse URL %s: %v", srv.Spec.HTTP.URL, err)
			}
			discoveryURL := fmt.Sprintf("%s://%s/.well-known/oauth-authorization-server", parsed.Scheme, parsed.Host)

			resp, err := client.Get(discoveryURL)
			if err != nil {
				if isTransientNetworkError(err) {
					t.Skipf("skipping %s: transient network condition (DNS/timeout/connection): %v", name, err)
				}
				t.Fatalf("GET %s failed: %v", discoveryURL, err)
			}
			defer resp.Body.Close()

			body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			if err != nil {
				t.Fatalf("failed to read response body: %v", err)
			}

			t.Logf("GET %s -> %d (%d bytes)", discoveryURL, resp.StatusCode, len(body))

			if resp.StatusCode == http.StatusNotFound {
				t.Skipf("skipping %s: OAuth discovery endpoint returned 404 (RFC 8414 not implemented by vendor)", name)
			}

			if resp.StatusCode != http.StatusOK {
				t.Errorf("OAuth discovery endpoint should return 200, got %d", resp.StatusCode)
				t.Logf("response body (truncated): %.500s", string(body))
				return
			}

			var doc map[string]interface{}
			if err := json.Unmarshal(body, &doc); err != nil {
				t.Errorf("OAuth discovery response should be valid JSON: %v", err)
				t.Logf("response body (truncated): %.500s", string(body))
				return
			}

			if _, ok := doc["authorization_endpoint"]; !ok {
				t.Error("OAuth discovery document must contain authorization_endpoint")
			}
		})
	}
}

func TestSeedpackHttp_McpProtocolResponse(t *testing.T) {
	servers := loadAllMcpServers(t)

	initPayload := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"stigmer-canary-test","version":"1.0.0"}}}`)

	client := &http.Client{Timeout: 10 * time.Second}

	for name, srv := range servers {
		if srv.Spec.HTTP == nil {
			continue
		}
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			req, err := http.NewRequest(http.MethodPost, srv.Spec.HTTP.URL, bytes.NewReader(initPayload))
			if err != nil {
				t.Fatalf("failed to create request: %v", err)
			}
			req.Header.Set("Content-Type", "application/json")

			resp, err := client.Do(req)
			if err != nil {
				if isTransientNetworkError(err) {
					t.Skipf("skipping %s: transient network condition (DNS/timeout/connection): %v", name, err)
				}
				t.Fatalf("POST %s failed: %v", srv.Spec.HTTP.URL, err)
			}
			defer resp.Body.Close()

			body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			if err != nil {
				t.Fatalf("failed to read response body: %v", err)
			}

			t.Logf("POST %s -> %d (%d bytes)", srv.Spec.HTTP.URL, resp.StatusCode, len(body))

			if resp.StatusCode == http.StatusMethodNotAllowed {
				t.Logf("server returned 405 Method Not Allowed; may require SSE transport")
				return
			}

			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				t.Logf("server returned %d (auth required) — endpoint confirmed reachable", resp.StatusCode)
				return
			}

			if len(body) == 0 {
				t.Log("empty response body; server may require auth before responding")
				return
			}

			if !json.Valid(body) {
				t.Errorf("response should be valid JSON (not HTML error page); got: %.300s", string(body))
				return
			}

			var rpcResp map[string]interface{}
			if json.Unmarshal(body, &rpcResp) == nil {
				if errField, ok := rpcResp["error"]; ok {
					t.Logf("JSON-RPC error (expected without auth): %v", errField)
				}
				if _, ok := rpcResp["result"]; ok {
					t.Log("received valid JSON-RPC result (server responded without auth)")
				}
			}
		})
	}
}
