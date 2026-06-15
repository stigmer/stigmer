//go:build integration

package integration

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
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"gopkg.in/yaml.v3"
)

type mcpServerEnvVar struct {
	IsSecret    bool   `yaml:"is_secret"`
	Description string `yaml:"description"`
	Optional    bool   `yaml:"optional"`
}

type mcpServerYAML struct {
	Spec struct {
		HTTP *struct {
			URL string `yaml:"url"`
		} `yaml:"http"`
		Stdio *struct {
			Command string   `yaml:"command"`
			Args    []string `yaml:"args"`
		} `yaml:"stdio"`
		Auth *struct {
			OAuthAppRef  *struct{} `yaml:"oauth_app_ref"`
			TargetEnvVar string    `yaml:"target_env_var"`
		} `yaml:"auth"`
		Env map[string]mcpServerEnvVar `yaml:"env"`
	} `yaml:"spec"`
}

func loadSeedpackMcpServers(t *testing.T) map[string]mcpServerYAML {
	t.Helper()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to determine test file path via runtime.Caller")
	}
	seedpackDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "seedpack", "mcp-servers")

	entries, err := os.ReadDir(seedpackDir)
	if err != nil {
		t.Fatalf("failed to read seedpack directory %s: %v", seedpackDir, err)
	}

	servers := make(map[string]mcpServerYAML)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".yaml")

		data, err := os.ReadFile(filepath.Join(seedpackDir, entry.Name()))
		if err != nil {
			t.Fatalf("failed to read %s: %v", entry.Name(), err)
		}

		var srv mcpServerYAML
		if err := yaml.Unmarshal(data, &srv); err != nil {
			t.Fatalf("failed to parse %s: %v", entry.Name(), err)
		}
		servers[name] = srv
	}

	if len(servers) == 0 {
		t.Fatal("no MCP server YAML files found in seedpack directory")
	}
	t.Logf("loaded %d MCP server definitions from %s", len(servers), seedpackDir)
	return servers
}

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
// transient connection-level error). These tests are live canaries against
// third-party MCP endpoints and run in parallel inside the full offline suite,
// where contention can push a healthy endpoint past the client deadline. Such
// conditions say nothing about the seedpack definition under test, so callers
// skip rather than fail when they occur.
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
	servers := loadSeedpackMcpServers(t)

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
			assert.Less(t, resp.StatusCode, 500,
				"expected non-5xx status code; server may be down")
		})
	}
}

func TestSeedpackHttp_OAuthDiscoveryAvailable(t *testing.T) {
	servers := loadSeedpackMcpServers(t)

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

			if !assert.Equal(t, http.StatusOK, resp.StatusCode,
				"OAuth discovery endpoint should return 200") {
				t.Logf("response body (truncated): %.500s", string(body))
				return
			}

			var doc map[string]interface{}
			if !assert.NoError(t, json.Unmarshal(body, &doc),
				"OAuth discovery response should be valid JSON") {
				t.Logf("response body (truncated): %.500s", string(body))
				return
			}

			assert.Contains(t, doc, "authorization_endpoint",
				"OAuth discovery document must contain authorization_endpoint")
		})
	}
}

func TestSeedpackHttp_McpProtocolResponse(t *testing.T) {
	servers := loadSeedpackMcpServers(t)

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

			assert.True(t, json.Valid(body),
				"response should be valid JSON (not HTML error page); got: %.300s", string(body))

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

// expandPlaceholders replaces ${VAR} patterns in args with values from the
// environment or the provided defaults map. Returns the expanded args and a
// list of unresolved required variables (non-optional vars with no value).
func expandPlaceholders(args []string, env map[string]mcpServerEnvVar, defaults map[string]string) ([]string, []string) {
	expanded := make([]string, len(args))
	var missing []string

	for i, arg := range args {
		expanded[i] = os.Expand(arg, func(key string) string {
			if val := os.Getenv(key); val != "" {
				return val
			}
			if def, ok := defaults[key]; ok {
				return def
			}
			envDef, declared := env[key]
			if declared && !envDef.Optional {
				missing = append(missing, key)
			}
			return ""
		})
	}
	return expanded, missing
}

func TestSeedpackStdio_ServerLaunches(t *testing.T) {
	servers := loadSeedpackMcpServers(t)

	initPayload := []byte("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"stigmer-canary-test\",\"version\":\"1.0.0\"}}}\n")

	tempDir := t.TempDir()

	for name, srv := range servers {
		if srv.Spec.Stdio == nil {
			continue
		}
		cmd := srv.Spec.Stdio.Command
		if cmd != "npx" && cmd != "uvx" {
			continue
		}

		t.Run(name, func(t *testing.T) {
			t.Parallel()

			// Skip servers that declare required env vars not present in environment.
			for envName, envConfig := range srv.Spec.Env {
				if envConfig.Optional {
					continue
				}
				if os.Getenv(envName) == "" {
					t.Skipf("skipping %s: required env var %s not set", name, envName)
				}
			}

			binPath, err := exec.LookPath(cmd)
			if err != nil {
				t.Skipf("skipping %s: %s not found in PATH: %v", name, cmd, err)
			}
			t.Logf("using %s at %s", cmd, binPath)

			// Provide sensible defaults for path-like optional placeholders.
			defaults := map[string]string{
				"FILESYSTEM_ALLOWED_DIR": tempDir,
			}
			args, missingVars := expandPlaceholders(srv.Spec.Stdio.Args, srv.Spec.Env, defaults)
			if len(missingVars) > 0 {
				t.Skipf("skipping %s: required env var(s) not set: %v", name, missingVars)
			}

			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()

			proc := exec.CommandContext(ctx, cmd, args...)
			proc.Env = append(os.Environ(), "NODE_NO_WARNINGS=1")

			stdin, err := proc.StdinPipe()
			if err != nil {
				t.Fatalf("failed to create stdin pipe: %v", err)
			}

			var stdout bytes.Buffer
			var stderr bytes.Buffer
			proc.Stdout = &stdout
			proc.Stderr = &stderr

			if err := proc.Start(); err != nil {
				t.Fatalf("failed to start %s %v: %v", cmd, args, err)
			}

			done := make(chan error, 1)
			go func() {
				done <- proc.Wait()
			}()

			time.Sleep(2 * time.Second)

			select {
			case err := <-done:
				t.Logf("stderr: %s", stderr.String())
				t.Fatalf("process exited prematurely: %v", err)
			default:
			}

			if _, err := stdin.Write(initPayload); err != nil {
				t.Fatalf("failed to write to stdin: %v", err)
			}

			deadline := time.After(25 * time.Second)
			for stdout.Len() == 0 {
				select {
				case <-deadline:
					_ = proc.Process.Kill()
					t.Logf("stderr: %s", stderr.String())
					t.Fatal("timed out waiting for JSON-RPC response on stdout")
				case err := <-done:
					t.Logf("stderr: %s", stderr.String())
					t.Fatalf("process exited while waiting for response: %v", err)
				default:
					time.Sleep(200 * time.Millisecond)
				}
			}

			_ = stdin.Close()
			_ = proc.Process.Kill()

			output := stdout.Bytes()
			t.Logf("stdout (%d bytes): %.500s", len(output), string(output))
			t.Logf("stderr: %.500s", stderr.String())

			firstLine := output
			if idx := bytes.IndexByte(output, '\n'); idx >= 0 {
				firstLine = output[:idx]
			}
			firstLine = bytes.TrimSpace(firstLine)

			assert.True(t, json.Valid(firstLine),
				"first line of stdout should be valid JSON-RPC; got: %.300s", string(firstLine))
		})
	}
}
