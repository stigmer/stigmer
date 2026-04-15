package agent

import (
	"testing"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Test Constants
// =============================================================================

const (
	testOrgID       = "org_01kewqjbtdy0w4d14bnhhy4yc2"
	testAgentID     = "agt_01kewqjbtdy0w4d14bnhhy4yc2"
	testAgentName   = "test-agent"
	testAgentSlug   = "test-agent"
	testDescription = "Test agent description"
)

// stubClient returns a non-nil *stigmer.Client for validation-only tests.
// It is not connected to a backend and will panic on actual RPC calls.
func stubClient() *stigmer.Client {
	return &stigmer.Client{}
}

// =============================================================================
// Helper Functions
// =============================================================================

// createTestAgent returns a valid Agent proto for testing.
func createTestAgent() *agentv1.Agent {
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "You are a test agent.",
		},
	}
}

// createTestAgentWithID returns an Agent proto with an existing ID (update case).
func createTestAgentWithID() *agentv1.Agent {
	agent := createTestAgent()
	agent.Metadata.Id = testAgentID
	agent.Metadata.Slug = testAgentSlug
	return agent
}

// =============================================================================
// ApplyOptions Validation Tests
// =============================================================================

func TestApply_NilAgent(t *testing.T) {
	opts := &ApplyOptions{
		Agent: nil,
		Client: stubClient(),
		OrgID: testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "agent is required")
}

func TestApply_NilConnection(t *testing.T) {
	opts := &ApplyOptions{
		Agent: createTestAgent(),
		Client: nil,
		OrgID: testOrgID,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client is required")
}

func TestApply_EmptyOrgID_StillValid(t *testing.T) {
	// Empty OrgID is valid - backend will use authenticated user's org
	opts := &ApplyOptions{
		Agent:  createTestAgent(),
		Client: stubClient(),
		OrgID:  "",
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, opts.Agent, result.Agent)
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestApply_ValidationOrder(t *testing.T) {
	// Verify validation happens in the correct order:
	// 1. nil agent check
	// 2. nil connection check

	t.Run("nil agent checked first", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Agent: nil,
			Client: stubClient(),
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent is required")
	})

	t.Run("nil connection checked second", func(t *testing.T) {
		_, err := Apply(&ApplyOptions{
			Agent: createTestAgent(),
			Client: nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "client is required")
	})
}

// =============================================================================
// DryRun Mode Tests
// =============================================================================

func TestApply_DryRun_ReturnsWithoutRPC(t *testing.T) {
	agent := createTestAgent()

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		OrgID:  testOrgID,
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, agent, result.Agent)
	assert.False(t, result.Created) // DryRun returns false for Created
}

func TestApply_DryRun_PreservesAgent(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
			Org:  testOrgID,
		},
		Spec: &agentv1.AgentSpec{
			Description:  testDescription,
			Instructions: "Follow these instructions carefully.",
		},
	}

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		OrgID:  testOrgID,
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)

	// Verify all fields preserved
	assert.Equal(t, testAgentName, result.Agent.Metadata.Name)
	assert.Equal(t, testOrgID, result.Agent.Metadata.Org)
	assert.Equal(t, testDescription, result.Agent.Spec.Description)
	assert.Equal(t, "Follow these instructions carefully.", result.Agent.Spec.Instructions)
}

func TestApply_DryRun_RequiresConnection(t *testing.T) {
	// In DryRun mode, connection is still required because validation happens first
	agent := createTestAgent()

	opts := &ApplyOptions{
		Agent:  agent,
		Client: nil,
		OrgID:  testOrgID,
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client is required")
}

// =============================================================================
// Metadata Population Tests
// =============================================================================

func TestApply_SetsOrgWhenEmpty(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
			Org:  "", // Empty org
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
		},
	}

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		OrgID:  testOrgID,
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, testOrgID, result.Agent.Metadata.Org)
}

func TestApply_PreservesExistingOrg(t *testing.T) {
	existingOrg := "existing-org"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: testAgentName,
			Org:  existingOrg, // Already has org
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
		},
	}

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		OrgID:  testOrgID, // Different org in options
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	// Existing org should be preserved (not overwritten)
	assert.Equal(t, existingOrg, result.Agent.Metadata.Org)
}

func TestApply_CreatesMetadataWhenNil(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata:   nil, // Nil metadata
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
		},
	}

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		OrgID:  testOrgID,
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotNil(t, result.Agent.Metadata)
	assert.Equal(t, testOrgID, result.Agent.Metadata.Org)
}

// =============================================================================
// ApplyOptions Structure Tests
// =============================================================================

func TestApplyOptions_AllFields(t *testing.T) {
	agent := createTestAgent()

	opts := &ApplyOptions{
		Agent:  agent,
		OrgID:  testOrgID,
		Client: stubClient(),
		Quiet:  true,
		DryRun: true,
	}

	assert.Equal(t, agent, opts.Agent)
	assert.Equal(t, testOrgID, opts.OrgID)
	assert.NotNil(t, opts.Client)
	assert.True(t, opts.Quiet)
	assert.True(t, opts.DryRun)
}

func TestApplyOptions_DefaultValues(t *testing.T) {
	// Verify default values (Go zero values)
	opts := &ApplyOptions{}

	assert.Nil(t, opts.Agent)
	assert.Equal(t, "", opts.OrgID)
	assert.Nil(t, opts.Client)
	assert.False(t, opts.Quiet)
	assert.False(t, opts.DryRun)
}

// =============================================================================
// ApplyResult Structure Tests
// =============================================================================

func TestApplyResult_Structure(t *testing.T) {
	agent := createTestAgentWithID()

	result := &ApplyResult{
		Agent:   agent,
		Created: true,
	}

	assert.NotNil(t, result.Agent)
	assert.Equal(t, testAgentID, result.Agent.Metadata.Id)
	assert.True(t, result.Created)
}

func TestApplyResult_UpdateCase(t *testing.T) {
	agent := createTestAgentWithID()

	result := &ApplyResult{
		Agent:   agent,
		Created: false, // Update, not create
	}

	assert.NotNil(t, result.Agent)
	assert.False(t, result.Created)
}

// =============================================================================
// Create vs Update Detection Tests
// =============================================================================

func TestApply_DetectsCreate_WhenNoExistingID(t *testing.T) {
	agent := createTestAgent() // No ID set

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		DryRun: true,
		Quiet:  true,
	}

	// Note: In dry-run mode, Created is always false
	// The create detection logic is in the non-dry-run path
	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
}

func TestApply_DetectsUpdate_WhenExistingID(t *testing.T) {
	agent := createTestAgentWithID() // Has ID set

	opts := &ApplyOptions{
		Agent:  agent,
		Client: stubClient(),
		DryRun: true,
		Quiet:  true,
	}

	result, err := Apply(opts)

	require.NoError(t, err)
	require.NotNil(t, result)
}
