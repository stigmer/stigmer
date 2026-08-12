package harness

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/require"
)

// BuildTestMcpServer compiles the test MCP server binary and returns its path.
// The binary is built once per test run; subsequent calls reuse the cached path.
// Caller is responsible for calling this from TestMain or early in the suite.
func BuildTestMcpServer(outputDir string) (string, error) {
	_, thisFile, _, _ := runtime.Caller(0)
	serverSrc := filepath.Join(filepath.Dir(thisFile), "..", "testdata", "mcp-test-server")

	absOutputDir, err := filepath.Abs(outputDir)
	if err != nil {
		return "", fmt.Errorf("resolve output dir: %w", err)
	}

	binaryPath := filepath.Join(absOutputDir, "mcp-test-server")
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}

	cmd := exec.Command("go", "build", "-o", binaryPath, ".")
	cmd.Dir = serverSrc
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("build mcp-test-server: %w", err)
	}

	return binaryPath, nil
}

// CreateStdioMcpServer creates an McpServer resource pointing to the test
// stdio binary, passing any extra args (e.g. "--env-report", path) to the
// subprocess. No spec.env is declared, so the resource also models the
// zero-declaration shape the env-isolation guard exercises. The server is
// auto-deleted on test cleanup.
func CreateStdioMcpServer(t *testing.T, ctx context.Context, clients *Clients, binaryPath string, args ...string) *mcpserverv1.McpServer {
	t.Helper()

	name := "test-mcp-" + uuid.New().String()[:8]
	server := &mcpserverv1.McpServer{
		ApiVersion: TestAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  TestOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Integration test MCP server (stdio)",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: binaryPath,
					Args:    args,
				},
			},
		},
	}

	created, err := clients.McpServerCommand.Apply(ctx, server)
	require.NoError(t, err, "apply MCP server should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Logf("created MCP server: name=%s, id=%s, slug=%s",
		created.GetMetadata().GetName(),
		created.GetMetadata().GetId(),
		created.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{ResourceId: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up MCP server %s: %v", name, err)
		}
	})

	return created
}

// CreateHttpMcpServer creates an McpServer resource pointing to an HTTP+SSE
// endpoint. The server is auto-deleted on test cleanup.
func CreateHttpMcpServer(t *testing.T, ctx context.Context, clients *Clients, serverURL string) *mcpserverv1.McpServer {
	t.Helper()

	name := "test-mcp-http-" + uuid.New().String()[:8]
	server := &mcpserverv1.McpServer{
		ApiVersion: TestAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  TestOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Integration test MCP server (HTTP+SSE)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: serverURL,
				},
			},
		},
	}

	created, err := clients.McpServerCommand.Apply(ctx, server)
	require.NoError(t, err, "apply HTTP MCP server should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Logf("created HTTP MCP server: name=%s, id=%s, slug=%s",
		created.GetMetadata().GetName(),
		created.GetMetadata().GetId(),
		created.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{ResourceId: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up HTTP MCP server %s: %v", name, err)
		}
	})

	return created
}

// StigmerMcpLaunch is the resolved stdio command that starts the real
// mcp-server-stigmer for an integration test. The server is the TypeScript
// @stigmer/mcp-server; the Go module was retired (T03).
type StigmerMcpLaunch struct {
	Command string
	Args    []string
}

// ResolveStigmerMcpLaunch resolves the stdio launch for the TypeScript
// mcp-server-stigmer from the monorepo workspace: the workspace tsx binary
// running the package's source entry (mcp-server/src/cli/mcp-server-stigmer.ts).
// This mirrors tier 2 of the production CLI launcher (resolveMCPServerCommand)
// and `npm run start`, so the tests exercise the same code path that ships.
// The server connects to the Stigmer backend via gRPC and exposes the
// workflow-related MCP tools (get_task_kind_registry, validate_workflow_yaml, …).
func ResolveStigmerMcpLaunch() (StigmerMcpLaunch, error) {
	tsxBin, err := ResolveWorkspaceTsx()
	if err != nil {
		return StigmerMcpLaunch{}, err
	}

	entry := filepath.Join(MonorepoRoot(), "mcp-server", "src", "cli", "mcp-server-stigmer.ts")
	if _, err := os.Stat(entry); err != nil {
		return StigmerMcpLaunch{}, fmt.Errorf("mcp-server entry not found at %s: %w", entry, err)
	}

	return StigmerMcpLaunch{Command: tsxBin, Args: []string{entry}}, nil
}

// WaitForMcpServerTool polls until the MCP server's discovered_capabilities
// include the named tool. Used after Apply for HTTP servers where discovery
// may complete asynchronously, and after Connect to confirm tools are ready.
func WaitForMcpServerTool(t *testing.T, ctx context.Context, clients *Clients, serverID, toolName string, timeout time.Duration) *mcpserverv1.McpServer {
	t.Helper()

	deadline := time.Now().Add(timeout)
	interval := 500 * time.Millisecond

	for time.Now().Before(deadline) {
		server, err := clients.McpServerQuery.Get(ctx, &apiresource.ApiResourceId{Value: serverID})
		require.NoError(t, err, "get MCP server should succeed")

		for _, tool := range server.GetStatus().GetDiscoveredCapabilities().GetTools() {
			if tool.GetName() == toolName {
				t.Logf("MCP server %s has tool %q (%d tools discovered)",
					serverID, toolName, len(server.GetStatus().GetDiscoveredCapabilities().GetTools()))
				return server
			}
		}

		time.Sleep(interval)
	}

	server, err := clients.McpServerQuery.Get(ctx, &apiresource.ApiResourceId{Value: serverID})
	require.NoError(t, err)
	t.Fatalf("timed out after %v waiting for tool %q on MCP server %s (discovered %d tools)",
		timeout, toolName, serverID, len(server.GetStatus().GetDiscoveredCapabilities().GetTools()))
	return nil
}

// ConnectOption configures a ConnectInput before the connect RPC is called.
type ConnectOption func(*mcpserverv1.ConnectInput)

// WithConnectRuntimeEnv sets runtime environment variables on the connect
// request. When provided, the backend uses these values directly instead of
// resolving from the caller's personal environment.
func WithConnectRuntimeEnv(env map[string]*executionctxv1.ExecutionValue) ConnectOption {
	return func(input *mcpserverv1.ConnectInput) {
		input.RuntimeEnv = env
	}
}

// ConnectMcpServer runs the connect RPC to populate discovered_capabilities.
func ConnectMcpServer(t *testing.T, ctx context.Context, clients *Clients, serverID string, opts ...ConnectOption) *mcpserverv1.McpServer {
	t.Helper()

	input := &mcpserverv1.ConnectInput{
		McpServerId: serverID,
		Org:         TestOrg,
	}
	for _, opt := range opts {
		opt(input)
	}

	result, err := clients.McpServerCommand.Connect(ctx, input)
	require.NoError(t, err, "connect MCP server should succeed")

	t.Logf("connected MCP server: id=%s, tools=%d",
		serverID,
		len(result.GetStatus().GetDiscoveredCapabilities().GetTools()))

	return result
}
