package bootstrap

import (
	"context"
	"path/filepath"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
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

func TestBootstrapper_Run_Success(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)
	require.NoError(t, err)

	// Verify skill was pushed (seedpack has skill-creator)
	assert.Len(t, skillClient.PushCalls, 1)
	assert.Equal(t, "local", skillClient.PushCalls[0].GetOrg())
	assert.NotEmpty(t, skillClient.PushCalls[0].GetArtifact())
	assert.Equal(t, "system", skillClient.PushCalls[0].GetTag())

	// Verify agent was applied (seedpack has skill-creator-agent)
	assert.Len(t, agentClient.ApplyCalls, 1)
	assert.Equal(t, "skill-creator-agent", agentClient.ApplyCalls[0].GetMetadata().GetName())
	assert.Equal(t, "local", agentClient.ApplyCalls[0].GetMetadata().GetOrg())

	// Verify state was recorded
	status, err := store.GetBootstrapState(ctx, KeyBootstrapStatus)
	require.NoError(t, err)
	assert.Equal(t, StatusCompleted, status)

	version, err := store.GetBootstrapState(ctx, KeySeedpackVersion)
	require.NoError(t, err)
	assert.Equal(t, "1.2.0", version) // Should match seedpack manifest

	skillState, err := store.GetBootstrapState(ctx, KeySkillPrefix+"skill-creator")
	require.NoError(t, err)
	assert.Contains(t, skillState, KeyAppliedPrefix)

	agentState, err := store.GetBootstrapState(ctx, KeyAgentPrefix+"skill-creator-agent")
	require.NoError(t, err)
	assert.Contains(t, agentState, KeyAppliedPrefix)
}

func TestBootstrapper_Run_Idempotent(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient)

	ctx := context.Background()

	// Run bootstrap first time
	err = bootstrapper.Run(ctx)
	require.NoError(t, err)
	assert.Len(t, skillClient.PushCalls, 1)
	assert.Len(t, agentClient.ApplyCalls, 1)

	// Run bootstrap again - should skip because already completed
	skillClient.PushCalls = nil
	agentClient.ApplyCalls = nil

	err = bootstrapper.Run(ctx)
	require.NoError(t, err)

	// No new calls should be made
	assert.Len(t, skillClient.PushCalls, 0)
	assert.Len(t, agentClient.ApplyCalls, 0)
}

func TestBootstrapper_Run_SkipIfSameDigest(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")

	store, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	// Pre-set state to simulate previous successful apply with same digest
	// We need to get the actual digest from the seedpack
	err = store.SetBootstrapState(ctx, KeySeedpackVersion, "1.0.0") // Different version
	require.NoError(t, err)
	err = store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusPending) // Not completed
	require.NoError(t, err)

	skillClient := &MockSkillClient{}
	agentClient := &MockAgentClient{}

	bootstrapper := NewBootstrapper(store, skillClient, agentClient)

	// Run bootstrap - should run because version is different
	err = bootstrapper.Run(ctx)
	require.NoError(t, err)

	// Calls should be made because version changed
	assert.Len(t, skillClient.PushCalls, 1)
	assert.Len(t, agentClient.ApplyCalls, 1)
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

	bootstrapper := NewBootstrapper(store, skillClient, agentClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)

	// Should not return error (degraded mode)
	require.NoError(t, err)

	// Skill push should have been attempted
	assert.Len(t, skillClient.PushCalls, 1)

	// Agent should still be applied
	assert.Len(t, agentClient.ApplyCalls, 1)

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

	bootstrapper := NewBootstrapper(store, skillClient, agentClient)

	ctx := context.Background()
	err = bootstrapper.Run(ctx)

	// Should not return error (degraded mode)
	require.NoError(t, err)

	// Skill should have been pushed
	assert.Len(t, skillClient.PushCalls, 1)

	// Agent apply should have been attempted
	assert.Len(t, agentClient.ApplyCalls, 1)

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

	bootstrapper := NewBootstrapper(store, skillClient, agentClient)

	assert.NotNil(t, bootstrapper)
	assert.Equal(t, store, bootstrapper.store)
	assert.Equal(t, skillClient, bootstrapper.skillClient)
	assert.Equal(t, agentClient, bootstrapper.agentClient)
	assert.Equal(t, "local", bootstrapper.org)
}
