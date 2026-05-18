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
			OAuthAppRef *struct{} `yaml:"oauth_app_ref"`
		} `yaml:"auth"`
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
		if name == "credential-manifest" {
			continue
		}

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
				if isDNSError(err) {
					t.Skipf("skipping %s: DNS resolution failed (may be region-specific): %v", name, err)
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
		if srv.Spec.HTTP == nil || srv.Spec.Auth == nil || srv.Spec.Auth.OAuthAppRef != nil {
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
				if isDNSError(err) {
					t.Skipf("skipping %s: DNS resolution failed: %v", name, err)
				}
				t.Fatalf("GET %s failed: %v", discoveryURL, err)
			}
			defer resp.Body.Close()

			body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			if err != nil {
				t.Fatalf("failed to read response body: %v", err)
			}

			t.Logf("GET %s -> %d (%d bytes)", discoveryURL, resp.StatusCode, len(body))

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
				if isDNSError(err) {
					t.Skipf("skipping %s: DNS resolution failed: %v", name, err)
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

func TestSeedpackStdio_ServerLaunches(t *testing.T) {
	servers := loadSeedpackMcpServers(t)

	initPayload := []byte("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"stigmer-canary-test\",\"version\":\"1.0.0\"}}}\n")

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

			binPath, err := exec.LookPath(cmd)
			if err != nil {
				t.Skipf("skipping %s: %s not found in PATH: %v", name, cmd, err)
			}
			t.Logf("using %s at %s", cmd, binPath)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			proc := exec.CommandContext(ctx, cmd, srv.Spec.Stdio.Args...)
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
				t.Fatalf("failed to start %s %v: %v", cmd, srv.Spec.Stdio.Args, err)
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

			deadline := time.After(15 * time.Second)
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
