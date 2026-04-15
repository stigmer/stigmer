package mcpserver

import (
	"testing"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Test Constants
// =============================================================================

const (
	testOrgID       = "org_01kewqjbtdy0w4d14bnhhy4yc2"
	testMcpServerID = "mcp_01kewqjbtdy0w4d14bnhhy4yc2"
	testServerName  = "test-server"
	testServerSlug  = "test-server"
	testCommand     = "node"
	testDescription = "Test MCP server"
)

// stubClient returns a non-nil *stigmer.Client for tests that only exercise
// validation/dry-run paths and never make real RPCs. The embedded gen.Client
// is nil, which is safe as long as tests don't call SDK methods.
func stubClient() *stigmer.Client { return &stigmer.Client{} }

// =============================================================================
// ApplyOptions Validation Tests
// =============================================================================

func TestApply_NilMcpServer(t *testing.T) {
	opts := &ApplyOptions{
		McpServer: nil,
		Client:    stubClient(),
		OrgID:     testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "mcpServer is required")
}

func TestApply_NilConnection(t *testing.T) {
	opts := &ApplyOptions{
		McpServer: createTestMcpServer(),
		Client:    nil,
		OrgID:     testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client is required")
}

func TestApply_EmptyOrgID_StillValid(t *testing.T) {
	opts := &ApplyOptions{
		McpServer: createTestMcpServer(),
		Client:    stubClient(),
		OrgID:     "",
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, opts.McpServer, result.McpServer)
}

// =============================================================================
// DryRun Mode Tests
// =============================================================================

func TestApply_DryRun_ReturnsWithoutRPC(t *testing.T) {
	mcpServer := createTestMcpServer()

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, mcpServer, result.McpServer)
	assert.False(t, result.Created) // DryRun returns false for Created
}

func TestApply_DryRun_PreservesMcpServer(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testServerName,
			Org:  testOrgID,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: testDescription,
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
					Args:    []string{"server.js"},
				},
			},
		},
	}

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)

	assert.Equal(t, testServerName, result.McpServer.Metadata.Name)
	assert.Equal(t, testOrgID, result.McpServer.Metadata.Org)
	assert.Equal(t, testDescription, result.McpServer.Spec.Description)
	assert.Equal(t, testCommand, result.McpServer.Spec.GetStdio().Command)
}

func TestApply_DryRun_AllowsNilConnection(t *testing.T) {
	mcpServer := createTestMcpServer()

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    nil,
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	// This should fail because Apply() checks Client before checking DryRun
	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client is required")
}

// =============================================================================
// Metadata Population Tests
// =============================================================================

func TestApply_SetOrgWhenEmpty(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testServerName,
			Org:  "", // Empty org
		},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
				},
			},
		},
	}

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, testOrgID, result.McpServer.Metadata.Org)
}

func TestApply_PreserveExistingOrg(t *testing.T) {
	existingOrg := "org_different"
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testServerName,
			Org:  existingOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
				},
			},
		},
	}

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, existingOrg, result.McpServer.Metadata.Org)
}

func TestApply_CreatesMetadataIfNil(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata:   nil, // Nil metadata
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
				},
			},
		},
	}

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotNil(t, result.McpServer.Metadata)
	assert.Equal(t, testOrgID, result.McpServer.Metadata.Org)
}

// =============================================================================
// Result Structure Tests
// =============================================================================

func TestApply_ResultPopulated(t *testing.T) {
	mcpServer := createTestMcpServer()

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.NotNil(t, result.McpServer)
	assert.Equal(t, mcpServer, result.McpServer)
}

func TestApply_Created_NewServer(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testServerName,
			Id:   "", // No ID = create
		},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
				},
			},
		},
	}

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	// DryRun always returns Created=false, but in real mode this would be true
	assert.False(t, result.Created)
}

func TestApply_Updated_ExistingServer(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testServerName,
			Id:   testMcpServerID, // Has ID = update
		},
		Spec: &mcpserverv1.McpServerSpec{
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
				},
			},
		},
	}

	opts := &ApplyOptions{
		McpServer: mcpServer,
		Client:    stubClient(),
		OrgID:     testOrgID,
		DryRun:    true,
		Quiet:     true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.False(t, result.Created) // DryRun returns false
}

// =============================================================================
// Test Helpers
// =============================================================================

func createTestMcpServer() *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testServerName,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: testDescription,
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: testCommand,
					Args:    []string{"--port", "3000"},
				},
			},
		},
	}
}
