package root

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

func TestNewMCPServerCommand_metadata(t *testing.T) {
	cmd := NewMCPServerCommand()

	if cmd.Use != "mcp-server" {
		t.Errorf("Use = %q, want %q", cmd.Use, "mcp-server")
	}
	if cmd.Short == "" {
		t.Error("Short description must not be empty")
	}
	if cmd.Long == "" {
		t.Error("Long description must not be empty")
	}
	if cmd.RunE == nil {
		t.Error("RunE must be set")
	}
}

func TestNewMCPServerCommand_flags(t *testing.T) {
	cmd := NewMCPServerCommand()

	flags := []string{
		"transport",
		"port",
		"server-address",
		"api-key",
		"log-format",
		"log-level",
	}

	for _, name := range flags {
		if cmd.Flags().Lookup(name) == nil {
			t.Errorf("expected flag %q to be registered", name)
		}
	}
}

func TestBridgeFlagsToEnv(t *testing.T) {
	clearMCPEnv(t)

	cmd := NewMCPServerCommand()
	if err := cmd.Flags().Set("transport", "http"); err != nil {
		t.Fatalf("setting transport flag: %v", err)
	}
	if err := cmd.Flags().Set("port", "3000"); err != nil {
		t.Fatalf("setting port flag: %v", err)
	}
	if err := cmd.Flags().Set("server-address", "api.example.com:443"); err != nil {
		t.Fatalf("setting server-address flag: %v", err)
	}
	if err := cmd.Flags().Set("api-key", "new-key"); err != nil {
		t.Fatalf("setting api-key flag: %v", err)
	}
	if err := cmd.Flags().Set("log-format", "json"); err != nil {
		t.Fatalf("setting log-format flag: %v", err)
	}
	if err := cmd.Flags().Set("log-level", "debug"); err != nil {
		t.Fatalf("setting log-level flag: %v", err)
	}

	bridgeFlagsToEnv(cmd)

	assertEnv(t, "STIGMER_MCP_TRANSPORT", "http")
	assertEnv(t, "STIGMER_MCP_HTTP_PORT", "3000")
	assertEnv(t, "STIGMER_SERVER_ADDRESS", "api.example.com:443")
	assertEnv(t, "STIGMER_API_KEY", "new-key")
	assertEnv(t, "STIGMER_MCP_LOG_FORMAT", "json")
	assertEnv(t, "STIGMER_MCP_LOG_LEVEL", "debug")
}

func TestBridgeFlagsToEnv_noFlagsDoesNotOverwrite(t *testing.T) {
	t.Setenv("STIGMER_MCP_TRANSPORT", "original")

	cmd := NewMCPServerCommand()
	bridgeFlagsToEnv(cmd)

	assertEnv(t, "STIGMER_MCP_TRANSPORT", "original")
}

// clearMCPEnv neutralizes the env vars that applyCLIConfigEnv checks so that
// the developer's shell cannot leak into test assertions.
func clearMCPEnv(t *testing.T) {
	t.Helper()
	t.Setenv("STIGMER_SERVER_ADDRESS", "")
	t.Setenv("STIGMER_API_KEY", "")
	t.Setenv("STIGMER_MCP_TRANSPORT", "")
	t.Setenv("STIGMER_MCP_HTTP_PORT", "")
	t.Setenv("STIGMER_MCP_LOG_FORMAT", "")
	t.Setenv("STIGMER_MCP_LOG_LEVEL", "")
}

func TestApplyCLIConfigEnv_localBackend(t *testing.T) {
	clearMCPEnv(t)

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "localhost:7234")
	assertEnv(t, "STIGMER_API_KEY", "")
}

func TestApplyCLIConfigEnv_cloudBackend(t *testing.T) {
	clearMCPEnv(t)

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "sk-cloud-token",
			},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "api.stigmer.ai:443")
	assertEnv(t, "STIGMER_API_KEY", "sk-cloud-token")
}

func TestApplyCLIConfigEnv_envVarsTakePrecedence(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:9090")
	t.Setenv("STIGMER_API_KEY", "env-key")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "api.stigmer.ai:443",
				Token:    "sk-cloud-token",
			},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "custom:9090")
	assertEnv(t, "STIGMER_API_KEY", "env-key")
}

func TestApplyCLIConfigEnv_cloudNilCloudConfig(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "original:9090")
	t.Setenv("STIGMER_API_KEY", "original")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeCloud,
			Cloud: nil,
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "original:9090")
	assertEnv(t, "STIGMER_API_KEY", "original")
}

func TestApplyCLIConfigEnv_cloudEmptyEndpointAndToken(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "original:9090")
	t.Setenv("STIGMER_API_KEY", "")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: config.BackendTypeCloud,
			Cloud: &config.CloudBackendConfig{
				Endpoint: "",
				Token:    "",
			},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "original:9090")
	assertEnv(t, "STIGMER_API_KEY", "")
}

func TestApplyCLIConfigEnv_localEnvVarTakesPrecedence(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "custom:7234")
	t.Setenv("STIGMER_API_KEY", "")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type:  config.BackendTypeLocal,
			Local: &config.LocalBackendConfig{},
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "custom:7234")
}

func TestApplyCLIConfigEnv_unknownBackendType(t *testing.T) {
	t.Setenv("STIGMER_SERVER_ADDRESS", "original:9090")
	t.Setenv("STIGMER_API_KEY", "original")

	cliCfg := &config.Config{
		Backend: config.BackendConfig{
			Type: "unknown",
		},
	}

	applyCLIConfigEnv(cliCfg)

	assertEnv(t, "STIGMER_SERVER_ADDRESS", "original:9090")
	assertEnv(t, "STIGMER_API_KEY", "original")
}

func TestBuildMCPServerArgs_withTransport(t *testing.T) {
	cmd := NewMCPServerCommand()
	if err := cmd.Flags().Set("transport", "http"); err != nil {
		t.Fatal(err)
	}

	args := buildMCPServerArgs(cmd)
	if len(args) != 1 || args[0] != "http" {
		t.Errorf("args = %v, want [http]", args)
	}
}

func TestBuildMCPServerArgs_noTransport(t *testing.T) {
	cmd := NewMCPServerCommand()

	args := buildMCPServerArgs(cmd)
	if len(args) != 0 {
		t.Errorf("args = %v, want []", args)
	}
}

// TestResolveMCPServerCommand_envOverride asserts tier 1 (STIGMER_MCP_SERVER_CMD)
// wins and the transport args are appended.
func TestResolveMCPServerCommand_envOverride(t *testing.T) {
	t.Setenv("STIGMER_MCP_SERVER_CMD", "my-launcher --flag")

	cmd, err := resolveMCPServerCommand([]string{"http"})
	if err != nil {
		t.Fatalf("resolveMCPServerCommand: %v", err)
	}

	want := []string{"my-launcher", "--flag", "http"}
	if len(cmd.Args) != len(want) {
		t.Fatalf("Args = %v, want %v", cmd.Args, want)
	}
	for i := range want {
		if cmd.Args[i] != want[i] {
			t.Errorf("Args[%d] = %q, want %q", i, cmd.Args[i], want[i])
		}
	}
}

// TestResolveMCPServerCommand_nodeMissing asserts tier 3 surfaces a clear
// Node.js requirement error when no workspace and no npx are available.
func TestResolveMCPServerCommand_nodeMissing(t *testing.T) {
	t.Setenv("STIGMER_MCP_SERVER_CMD", "")
	// Move CWD out of the monorepo so tier 2 (workspace tsx) cannot match.
	t.Chdir(t.TempDir())
	// Empty PATH so tier 3's npx lookup fails deterministically.
	t.Setenv("PATH", "")

	_, err := resolveMCPServerCommand(nil)
	if err == nil {
		t.Fatal("expected an error when Node.js/npx is unavailable")
	}
	if !strings.Contains(err.Error(), "Node.js") {
		t.Errorf("error %q should mention the Node.js requirement", err.Error())
	}
}

// TestTryWorkspaceMCPServer asserts tier 2 resolves to the workspace tsx and
// MCP server source entry when both are present.
func TestTryWorkspaceMCPServer(t *testing.T) {
	root := t.TempDir()
	tsxBin := filepath.Join(root, "node_modules", ".bin", "tsx")
	entry := filepath.Join(root, "mcp-server", "src", "cli", "mcp-server-stigmer.ts")
	writeStubFile(t, tsxBin)
	writeStubFile(t, entry)

	cmd, ok := tryWorkspaceMCPServer(root, []string{"http"})
	if !ok {
		t.Fatal("tryWorkspaceMCPServer returned ok=false with both files present")
	}
	want := []string{tsxBin, entry, "http"}
	if len(cmd.Args) != len(want) {
		t.Fatalf("Args = %v, want %v", cmd.Args, want)
	}
	for i := range want {
		if cmd.Args[i] != want[i] {
			t.Errorf("Args[%d] = %q, want %q", i, cmd.Args[i], want[i])
		}
	}
}

func TestTryWorkspaceMCPServer_missing(t *testing.T) {
	if _, ok := tryWorkspaceMCPServer(t.TempDir(), nil); ok {
		t.Error("tryWorkspaceMCPServer should return ok=false when files are absent")
	}
}

// TestMcpServerPackageSpec_devFallback asserts unversioned dev builds resolve to
// the @dev dist-tag (the production version branch is exercised at release time
// via ldflags).
func TestMcpServerPackageSpec_devFallback(t *testing.T) {
	if got := mcpServerPackageSpec(); got != "@stigmer/mcp-server@dev" {
		t.Errorf("mcpServerPackageSpec() = %q, want @stigmer/mcp-server@dev", got)
	}
}

func writeStubFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("stub"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func assertEnv(t *testing.T, key, want string) {
	t.Helper()
	if got := os.Getenv(key); got != want {
		t.Errorf("%s = %q, want %q", key, got, want)
	}
}
