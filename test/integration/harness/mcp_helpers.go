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

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// BuildTestMcpServer compiles the test MCP server binary and returns its path.
// The binary is built once per test run; subsequent calls reuse the cached path.
// Caller is responsible for calling this from TestMain or early in the suite.
func BuildTestMcpServer(outputDir string) (string, error) {
	_, thisFile, _, _ := runtime.Caller(0)
	serverSrc := filepath.Join(filepath.Dir(thisFile), "..", "testdata", "mcp-test-server")

	binaryPath := filepath.Join(outputDir, "mcp-test-server")
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
// stdio binary. The server is auto-deleted on test cleanup.
func CreateStdioMcpServer(t *testing.T, ctx context.Context, clients *Clients, binaryPath string) *mcpserverv1.McpServer {
	t.Helper()

	name := "test-mcp-" + uuid.New().String()[:8]
	server := &mcpserverv1.McpServer{
		ApiVersion: testAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  testOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Integration test MCP server (stdio)",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: binaryPath,
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
		ApiVersion: testAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  testOrg,
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

// ConnectMcpServer runs the connect RPC to populate discovered_capabilities.
func ConnectMcpServer(t *testing.T, ctx context.Context, clients *Clients, serverID string) *mcpserverv1.McpServer {
	t.Helper()

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: serverID,
		Org:         testOrg,
	})
	require.NoError(t, err, "connect MCP server should succeed")

	t.Logf("connected MCP server: id=%s, tools=%d",
		serverID,
		len(result.GetStatus().GetDiscoveredCapabilities().GetTools()))

	return result
}
