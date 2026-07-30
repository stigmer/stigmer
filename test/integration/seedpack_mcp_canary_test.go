//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func runtimeEnvFromString(key, value string) map[string]*executionctxv1.ExecutionValue {
	return map[string]*executionctxv1.ExecutionValue{
		key: {Value: value, IsSecret: true},
	}
}

// Canary tests validate real-world MCP server connections using actual credentials.
// Gated behind STIGMER_MCP_CANARY=true to avoid running in offline CI.
// Credentials are read from environment variables (injected by CI from Planton secrets).
//
// Transport note: the stdio canary below exercises the LOCAL-runner stdio
// connect path — a supported capability for user-defined servers. The
// seedpack catalog itself is HTTP-only (stdio is local-runner-only and
// refused on cloud-hosted runners).

func canaryEnabled() bool {
	return os.Getenv("STIGMER_MCP_CANARY") == "true"
}

func skipIfCanaryDisabled(t *testing.T) {
	t.Helper()
	if !canaryEnabled() {
		t.Skip("canary tests disabled (set STIGMER_MCP_CANARY=true to enable)")
	}
}

func requireEnvVar(t *testing.T, name string) string {
	t.Helper()
	val := os.Getenv(name)
	if val == "" {
		t.Skipf("canary credential %s not set", name)
	}
	return val
}

func applyCanaryServer(t *testing.T, ctx context.Context, clients *harness.Clients, serverYAML *mcpserverv1.McpServer) *mcpserverv1.McpServer {
	t.Helper()

	created, err := clients.McpServerCommand.Apply(ctx, serverYAML)
	require.NoError(t, err, "apply canary MCP server")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
	})

	return created
}

func TestCanary_NoAuth_Fetch_Connects(t *testing.T) {
	skipIfCanaryDisabled(t)

	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-fetch",
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Canary test: fetch server (no auth)",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "uvx",
					Args:    []string{"mcp-server-fetch"},
				},
			},
		},
	}

	created := applyCanaryServer(t, ctx, clients, server)
	connected := harness.ConnectMcpServer(t, ctx, clients, created.GetMetadata().GetId())

	tools := connected.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools, "fetch server should discover at least one tool")
	t.Logf("fetch server discovered %d tools", len(tools))
}

func TestCanary_ApiKey_Tavily(t *testing.T) {
	skipIfCanaryDisabled(t)
	apiKey := requireEnvVar(t, "TAVILY_API_KEY")

	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-tavily",
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Canary test: Tavily search (API key)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: "https://mcp.tavily.com/mcp",
					Headers: map[string]string{
						"Authorization": "Bearer ${TAVILY_API_KEY}",
					},
				},
			},
		},
	}

	created := applyCanaryServer(t, ctx, clients, server)

	// Connect with runtime_env providing the API key
	_ = apiKey
	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: created.GetMetadata().GetId(),
		Org:         "test-org",
		RuntimeEnv:  runtimeEnvFromString("TAVILY_API_KEY", apiKey),
	})
	require.NoError(t, err, "tavily connect should succeed")

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.GreaterOrEqual(t, len(tools), 3, "tavily should have at least 3 tools")
	t.Logf("tavily discovered %d tools", len(tools))
}

func TestCanary_ApiKey_Stripe(t *testing.T) {
	skipIfCanaryDisabled(t)
	token := requireEnvVar(t, "STRIPE_ACCESS_TOKEN")

	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-stripe",
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Canary test: Stripe payments (API key)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: "https://mcp.stripe.com/",
					Headers: map[string]string{
						"Authorization": "Bearer ${STRIPE_ACCESS_TOKEN}",
					},
				},
			},
		},
	}

	created := applyCanaryServer(t, ctx, clients, server)

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: created.GetMetadata().GetId(),
		Org:         "test-org",
		RuntimeEnv:  runtimeEnvFromString("STRIPE_ACCESS_TOKEN", token),
	})
	require.NoError(t, err, "stripe connect should succeed")

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools, "stripe should discover tools")
	t.Logf("stripe discovered %d tools", len(tools))
}

func TestCanary_ApiKey_Linear(t *testing.T) {
	skipIfCanaryDisabled(t)
	token := requireEnvVar(t, "LINEAR_ACCESS_TOKEN")

	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-linear",
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Canary test: Linear issue tracking (API key)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: "https://mcp.linear.app/mcp",
					Headers: map[string]string{
						"Authorization": "Bearer ${LINEAR_ACCESS_TOKEN}",
					},
				},
			},
		},
	}

	created := applyCanaryServer(t, ctx, clients, server)

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: created.GetMetadata().GetId(),
		Org:         "test-org",
		RuntimeEnv:  runtimeEnvFromString("LINEAR_ACCESS_TOKEN", token),
	})
	require.NoError(t, err, "linear connect should succeed")

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools, "linear should discover tools")
	t.Logf("linear discovered %d tools", len(tools))
}

func TestCanary_Token_GitHub(t *testing.T) {
	skipIfCanaryDisabled(t)
	token := requireEnvVar(t, "GITHUB_MCP_TOKEN")

	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-github",
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Canary test: GitHub (pre-acquired OAuth token)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: "https://api.githubcopilot.com/mcp/",
					Headers: map[string]string{
						"Authorization": "Bearer ${GITHUB_ACCESS_TOKEN}",
					},
				},
			},
		},
	}

	created := applyCanaryServer(t, ctx, clients, server)

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: created.GetMetadata().GetId(),
		Org:         "test-org",
		RuntimeEnv:  runtimeEnvFromString("GITHUB_ACCESS_TOKEN", token),
	})
	require.NoError(t, err, "github connect should succeed")

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools, "github should discover tools")
	t.Logf("github discovered %d tools", len(tools))
}

func TestCanary_ApiKey_GoogleMaps(t *testing.T) {
	skipIfCanaryDisabled(t)
	apiKey := requireEnvVar(t, "GOOGLE_MAPS_API_KEY")

	ctx := context.Background()
	clients := harness.NewClients(grpcConn)

	server := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "canary-google-maps",
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Canary test: Google Maps (custom header API key)",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url: "https://mcp.googleapis.com/v1alpha/maps:streamGenerateContent",
					Headers: map[string]string{
						"X-Goog-Api-Key": "${GOOGLE_MAPS_API_KEY}",
					},
				},
			},
		},
	}

	created := applyCanaryServer(t, ctx, clients, server)

	result, err := clients.McpServerCommand.Connect(ctx, &mcpserverv1.ConnectInput{
		McpServerId: created.GetMetadata().GetId(),
		Org:         "test-org",
		RuntimeEnv:  runtimeEnvFromString("GOOGLE_MAPS_API_KEY", apiKey),
	})
	require.NoError(t, err, "google-maps connect should succeed")

	tools := result.GetStatus().GetDiscoveredCapabilities().GetTools()
	assert.NotEmpty(t, tools, "google-maps should discover tools")
	t.Logf("google-maps discovered %d tools", len(tools))
}
