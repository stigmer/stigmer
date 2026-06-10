//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	mcpConnectTestOrg        = "test-org"
	mcpConnectTestAPIVersion = "agentic.stigmer.ai/v1"
)

// applyMcpServer creates an MCP server via Apply and registers cleanup.
func applyMcpServer(t *testing.T, ctx context.Context, clients *harness.Clients, server *mcpserverv1.McpServer) *mcpserverv1.McpServer {
	t.Helper()

	created, err := clients.McpServerCommand.Apply(ctx, server)
	require.NoError(t, err, "apply MCP server should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
	})

	return created
}

// TestMcpConnect_OrgPassedCorrectly verifies that calling Connect with a
// populated org field succeeds without a validation error.
// Regression: GitHub issue #140 — org was not forwarded, causing
// "org must be at least 1 character" from protovalidate.
func TestMcpConnect_OrgPassedCorrectly(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	name := "org-test-" + uuid.New().String()[:8]
	server := applyMcpServer(t, ctx, clients, &mcpserverv1.McpServer{
		ApiVersion: mcpConnectTestAPIVersion,
		Kind:       "McpServer",
		Metadata:   &apiresource.ApiResourceMetadata{Name: name, Org: mcpConnectTestOrg},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Connect org regression test",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{Command: mcpTestServerBinary},
			},
		},
	})

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: server.GetMetadata().GetId(),
		Org:         mcpConnectTestOrg,
	})

	require.NoError(t, err, "connect with org populated must not return validation error")
	assert.NotNil(t, result.GetStatus().GetDiscoveredCapabilities(),
		"discovered_capabilities should be populated after connect")
}

// TestMcpConnect_PlaceholderResolution_HttpHeaders verifies that ${VAR}
// placeholders in HTTP headers are resolved from runtime_env.
// Regression: GitHub issue #150 — placeholders were passed through literally.
func TestMcpConnect_PlaceholderResolution_HttpHeaders(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	httpServer := harness.StartHTTPMcpServer(t)

	name := "header-placeholder-" + uuid.New().String()[:8]
	server := applyMcpServer(t, ctx, clients, &mcpserverv1.McpServer{
		ApiVersion: mcpConnectTestAPIVersion,
		Kind:       "McpServer",
		Metadata:   &apiresource.ApiResourceMetadata{Name: name, Org: mcpConnectTestOrg},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Placeholder resolution test (HTTP headers)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: httpServer.URL,
					Headers: map[string]string{
						"Authorization": "Bearer ${TOKEN}",
					},
				},
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"TOKEN": {Description: "API token for auth"},
			},
		},
	})

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: server.GetMetadata().GetId(),
		Org:         mcpConnectTestOrg,
		RuntimeEnv: map[string]*executionctxv1.ExecutionValue{
			"TOKEN": {Value: "test-secret-token-12345"},
		},
	})

	require.NoError(t, err, "connect with TOKEN in runtime_env should succeed")
	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools, "tools should be discovered after placeholder resolution")
}

// TestMcpConnect_PlaceholderResolution_StdioArgs verifies that ${VAR}
// placeholders in stdio args are resolved from runtime_env before the
// subprocess is spawned.
// Regression: GitHub issue #141 — args placeholders were not expanded.
func TestMcpConnect_PlaceholderResolution_StdioArgs(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	name := "args-placeholder-" + uuid.New().String()[:8]
	server := applyMcpServer(t, ctx, clients, &mcpserverv1.McpServer{
		ApiVersion: mcpConnectTestAPIVersion,
		Kind:       "McpServer",
		Metadata:   &apiresource.ApiResourceMetadata{Name: name, Org: mcpConnectTestOrg},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Placeholder resolution test (stdio args)",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: mcpTestServerBinary,
					Args:    []string{"${VAR}"},
				},
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"VAR": {Description: "test argument variable"},
			},
		},
	})

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: server.GetMetadata().GetId(),
		Org:         mcpConnectTestOrg,
		RuntimeEnv: map[string]*executionctxv1.ExecutionValue{
			"VAR": {Value: "resolved-value"},
		},
	})

	require.NoError(t, err, "connect with VAR in runtime_env should succeed")
	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools,
		"tools should be discovered — proves subprocess received expanded args")
}

// TestMcpConnect_MissingEnvVar_ClearError verifies that calling Connect
// without a required environment variable produces an error message that
// names the missing variable.
func TestMcpConnect_MissingEnvVar_ClearError(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	httpServer := harness.StartHTTPMcpServer(t)

	name := "missing-env-" + uuid.New().String()[:8]
	server := applyMcpServer(t, ctx, clients, &mcpserverv1.McpServer{
		ApiVersion: mcpConnectTestAPIVersion,
		Kind:       "McpServer",
		Metadata:   &apiresource.ApiResourceMetadata{Name: name, Org: mcpConnectTestOrg},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Missing env var error test",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: httpServer.URL,
					Headers: map[string]string{
						"Authorization": "Bearer ${REQUIRED_TOKEN}",
					},
				},
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				"REQUIRED_TOKEN": {Description: "required token"},
			},
		},
	})

	_, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: server.GetMetadata().GetId(),
		Org:         mcpConnectTestOrg,
		// Intentionally omit RuntimeEnv to trigger the missing-variable error.
	})

	require.Error(t, err, "connect without required env var should fail")
	assert.True(t, strings.Contains(err.Error(), "REQUIRED_TOKEN"),
		"error message should name the missing variable; got: %s", err.Error())
}

// TestMcpConnect_StdioServer_ToolsDiscovered applies a stdio MCP test
// server, connects it, and verifies that tools appear in status.
func TestMcpConnect_StdioServer_ToolsDiscovered(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)
	if mcpTestServerBinary == "" {
		t.Skip("test MCP server binary not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	server := harness.CreateStdioMcpServer(t, ctx, clients, mcpTestServerBinary)
	result := harness.ConnectMcpServer(t, ctx, clients, server.GetMetadata().GetId())

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	require.NotEmpty(t, tools, "stdio server should expose at least one tool")

	toolNames := make([]string, len(tools))
	for i, tool := range tools {
		toolNames[i] = tool.GetName()
	}
	t.Logf("discovered %d tools: %v", len(tools), toolNames)

	assert.Contains(t, toolNames, "echo", "test server should expose the echo tool")
}

// TestMcpConnect_HttpServer_ToolsDiscovered starts an in-process HTTP MCP
// server, applies it, connects, and verifies that tools appear in status.
func TestMcpConnect_HttpServer_ToolsDiscovered(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	harness.RequireNativePrereqs(t, testHarness)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	httpServer := harness.StartHTTPMcpServer(t)
	server := harness.CreateHttpMcpServer(t, ctx, clients, httpServer.URL)
	result := harness.ConnectMcpServer(t, ctx, clients, server.GetMetadata().GetId())

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	require.NotEmpty(t, tools, "HTTP server should expose at least one tool")

	toolNames := make([]string, len(tools))
	for i, tool := range tools {
		toolNames[i] = tool.GetName()
	}
	t.Logf("discovered %d tools: %v", len(tools), toolNames)

	assert.Contains(t, toolNames, "echo", "test server should expose the echo tool")
	assert.Contains(t, toolNames, "add", "test server should expose the add tool")
}
