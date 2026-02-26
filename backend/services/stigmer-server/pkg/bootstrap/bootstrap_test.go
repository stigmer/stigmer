package bootstrap

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockSkillClient implements SkillClient for testing.
type MockSkillClient struct {
	PushCalls   []*skillv1.PushSkillRequest
	PushError   error
	PushResult  *skillv1.Skill
	PushResults []*skillv1.Skill
	callIndex   int
}

func (m *MockSkillClient) Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	m.PushCalls = append(m.PushCalls, req)
	if m.PushError != nil {
		return nil, m.PushError
	}
	if len(m.PushResults) > m.callIndex {
		result := m.PushResults[m.callIndex]
		m.callIndex++
		return result, nil
	}
	if m.PushResult != nil {
		return m.PushResult, nil
	}
	// Return a default success result
	return &skillv1.Skill{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "skill-" + req.GetOrg() + "-test",
			Name: "test-skill",
		},
		Status: &skillv1.SkillStatus{
			VersionHash: "sha256:test123",
		},
	}, nil
}

// MockAgentClient implements AgentClient for testing.
type MockAgentClient struct {
	ApplyCalls   []*agentv1.Agent
	ApplyError   error
	ApplyResult  *agentv1.Agent
	ApplyResults []*agentv1.Agent
	callIndex    int
}

func (m *MockAgentClient) Apply(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.ApplyCalls = append(m.ApplyCalls, agent)
	if m.ApplyError != nil {
		return nil, m.ApplyError
	}
	if len(m.ApplyResults) > m.callIndex {
		result := m.ApplyResults[m.callIndex]
		m.callIndex++
		return result, nil
	}
	if m.ApplyResult != nil {
		return m.ApplyResult, nil
	}
	// Return a default success result
	return &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-" + agent.GetMetadata().GetName(),
			Name: agent.GetMetadata().GetName(),
		},
	}, nil
}

// MockMcpServerClient implements McpServerClient for testing.
type MockMcpServerClient struct {
	ApplyCalls   []*mcpserverv1.McpServer
	ApplyError   error
	ApplyResult  *mcpserverv1.McpServer
	ApplyResults []*mcpserverv1.McpServer
	callIndex    int
}

func (m *MockMcpServerClient) Apply(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.ApplyCalls = append(m.ApplyCalls, mcpServer)
	if m.ApplyError != nil {
		return nil, m.ApplyError
	}
	if len(m.ApplyResults) > m.callIndex {
		result := m.ApplyResults[m.callIndex]
		m.callIndex++
		return result, nil
	}
	if m.ApplyResult != nil {
		return m.ApplyResult, nil
	}
	return &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "mcpserver-" + mcpServer.GetMetadata().GetName(),
			Name: mcpServer.GetMetadata().GetName(),
		},
	}, nil
}

func TestBootstrapper_Run_Success(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}
	mcpServerClient := &MockMcpServerClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)
	require.NoError(t, err)

	// Verify skills were pushed (seedpack has agent-creator, mcp-server-creator, skill-creator)
	assert.Len(t, skillClient.PushCalls, 3)
	for _, call := range skillClient.PushCalls {
		assert.Equal(t, "local", call.GetOrg())
		assert.NotEmpty(t, call.GetArtifact())
		assert.Equal(t, "system", call.GetTag())
	}

	// Verify agents were applied (seedpack has agent-creator and skill-creator, sorted alphabetically)
	assert.Len(t, agentClient.ApplyCalls, 2)
	assert.Equal(t, "agent-creator", agentClient.ApplyCalls[0].GetMetadata().GetName())
	assert.Equal(t, "local", agentClient.ApplyCalls[0].GetMetadata().GetOrg())
	assert.Equal(t, "skill-creator", agentClient.ApplyCalls[1].GetMetadata().GetName())
	assert.Equal(t, "local", agentClient.ApplyCalls[1].GetMetadata().GetOrg())

	// Verify MCP server was applied (seedpack has stigmer-mcp-server)
	assert.Len(t, mcpServerClient.ApplyCalls, 1)
	assert.Equal(t, "stigmer-mcp-server", mcpServerClient.ApplyCalls[0].GetMetadata().GetName())
	assert.Equal(t, "local", mcpServerClient.ApplyCalls[0].GetMetadata().GetOrg())

	// Verify state was recorded
	status, err := store.GetBootstrapState(ctx, KeyBootstrapStatus)
	require.NoError(t, err)
	assert.Equal(t, StatusCompleted, status)

	contentHash, err := store.GetBootstrapState(ctx, KeySeedpackContentHash)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(contentHash, "sha256:"), "content hash should start with sha256:")

	skillState, err := store.GetBootstrapState(ctx, KeySkillPrefix+"skill-creator")
	require.NoError(t, err)
	assert.Contains(t, skillState, KeyAppliedPrefix)

	agentCreatorState, err := store.GetBootstrapState(ctx, KeyAgentPrefix+"agent-creator")
	require.NoError(t, err)
	assert.Contains(t, agentCreatorState, KeyAppliedPrefix)

	skillCreatorAgentState, err := store.GetBootstrapState(ctx, KeyAgentPrefix+"skill-creator")
	require.NoError(t, err)
	assert.Contains(t, skillCreatorAgentState, KeyAppliedPrefix)

	mcpServerState, err := store.GetBootstrapState(ctx, KeyMcpServerPrefix+"stigmer-mcp-server")
	require.NoError(t, err)
	assert.Contains(t, mcpServerState, KeyAppliedPrefix)
}

func TestBootstrapper_Run_Idempotent(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}
	mcpServerClient := &MockMcpServerClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	ctx := context.Background()

	// Run bootstrap first time
	err = bootstrapper.Run(ctx)
	require.NoError(t, err)
	assert.Len(t, skillClient.PushCalls, 3)
	assert.Len(t, agentClient.ApplyCalls, 2)
	assert.Len(t, mcpServerClient.ApplyCalls, 1)

	// Run bootstrap again - should skip because already completed
	skillClient.PushCalls = nil
	agentClient.ApplyCalls = nil
	mcpServerClient.ApplyCalls = nil

	err = bootstrapper.Run(ctx)
	require.NoError(t, err)

	// No new calls should be made
	assert.Len(t, skillClient.PushCalls, 0)
	assert.Len(t, agentClient.ApplyCalls, 0)
	assert.Len(t, mcpServerClient.ApplyCalls, 0)
}

func TestBootstrapper_Run_SkipIfSameDigest(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	// Pre-set state with a different content hash to force re-bootstrap
	err = store.SetBootstrapState(ctx, KeySeedpackContentHash, "sha256:old_hash")
	require.NoError(t, err)
	err = store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusPending) // Not completed
	require.NoError(t, err)

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}
	mcpServerClient := &MockMcpServerClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	// Run bootstrap - should run because content hash is different
	err = bootstrapper.Run(ctx)
	require.NoError(t, err)

	// Calls should be made because content hash changed
	assert.Len(t, skillClient.PushCalls, 3)
	assert.Len(t, agentClient.ApplyCalls, 2)
	assert.Len(t, mcpServerClient.ApplyCalls, 1)
}

func TestBootstrapper_Run_DegradedMode_SkillError(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{
		PushError: assert.AnError, // Simulate error
	}
	agentClient := &MockAgentClient{}
	mcpServerClient := &MockMcpServerClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)

	// Should not return error (degraded mode)
	require.NoError(t, err)

	// Skill push should have been attempted (3 skills, all fail)
	assert.Len(t, skillClient.PushCalls, 3)

	// Agent and MCP server should still be applied
	assert.Len(t, agentClient.ApplyCalls, 2)
	assert.Len(t, mcpServerClient.ApplyCalls, 1)

	// Status should be failed
	status, err := store.GetBootstrapState(ctx, KeyBootstrapStatus)
	require.NoError(t, err)
	assert.Equal(t, StatusFailed, status)
}

func TestBootstrapper_Run_DegradedMode_AgentError(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{
		ApplyError: assert.AnError, // Simulate error
	}
	mcpServerClient := &MockMcpServerClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)

	// Should not return error (degraded mode)
	require.NoError(t, err)

	// Skills should have been pushed
	assert.Len(t, skillClient.PushCalls, 3)

	// Agent apply should have been attempted
	assert.Len(t, agentClient.ApplyCalls, 2)

	// MCP server should still be applied
	assert.Len(t, mcpServerClient.ApplyCalls, 1)

	// Status should be failed
	status, err := store.GetBootstrapState(ctx, KeyBootstrapStatus)
	require.NoError(t, err)
	assert.Equal(t, StatusFailed, status)
}

func TestBootstrapper_Run_DegradedMode_McpServerError(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}
	mcpServerClient := &MockMcpServerClient{
		ApplyError: assert.AnError,
	}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)

	// Should not return error (degraded mode)
	require.NoError(t, err)

	// Skills and agents should have succeeded
	assert.Len(t, skillClient.PushCalls, 3)
	assert.Len(t, agentClient.ApplyCalls, 2)

	// MCP server apply should have been attempted
	assert.Len(t, mcpServerClient.ApplyCalls, 1)

	// Status should be failed
	status, err := store.GetBootstrapState(ctx, KeyBootstrapStatus)
	require.NoError(t, err)
	assert.Equal(t, StatusFailed, status)
}

func TestCalculateAgentHash(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "A test agent",
			Instructions: "Do test things",
		},
	}

	hash1 := calculateAgentHash(agent)
	assert.NotEmpty(t, hash1)
	assert.True(t, len(hash1) > 0)
	assert.Contains(t, hash1, "sha256:")

	// Same content should produce same hash
	hash2 := calculateAgentHash(agent)
	assert.Equal(t, hash1, hash2)

	// Different content should produce different hash
	agent.Spec.Description = "Changed description"
	hash3 := calculateAgentHash(agent)
	assert.NotEqual(t, hash1, hash3)
}

func TestNewBootstrapper(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}
	mcpServerClient := &MockMcpServerClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient, mcpServerClient)

	assert.NotNil(t, bootstrapper)
	assert.Equal(t, store, bootstrapper.store)
	assert.Equal(t, skillClient, bootstrapper.skillClient)
	assert.Equal(t, agentClient, bootstrapper.agentClient)
	assert.Equal(t, mcpServerClient, bootstrapper.mcpServerClient)
	assert.Equal(t, "local", bootstrapper.org)
}

func TestCalculateMcpServerHash(t *testing.T) {
	mcpServer := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-mcp-server",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "A test MCP server",
			Tags:        []string{"test", "system"},
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "stigmer",
					Args:    []string{"mcp-server"},
				},
			},
		},
	}

	hash1 := calculateMcpServerHash(mcpServer)
	assert.NotEmpty(t, hash1)
	assert.Contains(t, hash1, "sha256:")

	// Same content should produce same hash
	hash2 := calculateMcpServerHash(mcpServer)
	assert.Equal(t, hash1, hash2)

	// Different command should produce different hash
	mcpServer.Spec.ServerType = &mcpserverv1.McpServerSpec_Stdio{
		Stdio: &mcpserverv1.StdioServerConfig{
			Command: "stigmer-v2",
			Args:    []string{"mcp-server"},
		},
	}
	hash3 := calculateMcpServerHash(mcpServer)
	assert.NotEqual(t, hash1, hash3)

	// Different description should produce different hash
	mcpServer.Spec.ServerType = &mcpserverv1.McpServerSpec_Stdio{
		Stdio: &mcpserverv1.StdioServerConfig{
			Command: "stigmer",
			Args:    []string{"mcp-server"},
		},
	}
	mcpServer.Spec.Description = "Changed description"
	hash4 := calculateMcpServerHash(mcpServer)
	assert.NotEqual(t, hash1, hash4)
}
