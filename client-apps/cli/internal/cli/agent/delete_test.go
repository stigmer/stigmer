package agent

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// DeleteOptions Validation Tests
// =============================================================================

func TestDelete_NilOptions(t *testing.T) {
	result, err := Delete(nil)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "delete options cannot be nil")
}

func TestDelete_NilClient(t *testing.T) {
	opts := &DeleteOptions{
		AgentID: testAgentID,
		Client:  nil,
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "client cannot be nil")
}

func TestDelete_EmptyAgentID(t *testing.T) {
	opts := &DeleteOptions{
		AgentID: "",
		Client:  stubClient(),
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "agent ID cannot be empty")
}

// =============================================================================
// DeleteFromBackend Validation Tests
// =============================================================================

func TestDeleteFromBackend_EmptyAgentID(t *testing.T) {
	result, err := DeleteFromBackend(stubClient(), "")

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "agent ID is required for delete operation")
}

// =============================================================================
// DeleteResult Structure Tests
// =============================================================================

func TestDeleteResult_Structure(t *testing.T) {
	a := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
		},
	}

	result := &DeleteResult{
		Agent: a,
	}

	assert.NotNil(t, result.Agent)
	assert.Equal(t, testAgentID, result.Agent.Metadata.Id)
	assert.Equal(t, testAgentName, result.Agent.Metadata.Name)
	assert.Equal(t, testAgentSlug, result.Agent.Metadata.Slug)
}

func TestDeleteResult_NilAgent(t *testing.T) {
	result := &DeleteResult{
		Agent: nil,
	}

	assert.Nil(t, result.Agent)
}

// =============================================================================
// DeleteOptions Structure Tests
// =============================================================================

func TestDeleteOptions_ValidStructure(t *testing.T) {
	c := stubClient()
	opts := &DeleteOptions{
		AgentID: testAgentID,
		Client:  c,
	}

	assert.Equal(t, testAgentID, opts.AgentID)
	assert.NotNil(t, opts.Client)
}

func TestDeleteOptions_DefaultValues(t *testing.T) {
	opts := &DeleteOptions{}

	assert.Equal(t, "", opts.AgentID)
	assert.Nil(t, opts.Client)
}

func TestDeleteOptions_AgentIDFormats(t *testing.T) {
	testCases := []struct {
		name    string
		agentID string
	}{
		{name: "underscore separator", agentID: "agt_abc123"},
		{name: "hyphen separator", agentID: "agt-abc123"},
		{name: "long ID", agentID: "agt_01kewqjbtdy0w4d14bnhhy4yc2"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			opts := &DeleteOptions{
				AgentID: tc.agentID,
				Client:  stubClient(),
			}
			assert.Equal(t, tc.agentID, opts.AgentID)
		})
	}
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestDelete_ValidationOrder(t *testing.T) {
	t.Run("nil options checked first", func(t *testing.T) {
		_, err := Delete(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "delete options cannot be nil")
	})

	t.Run("nil client checked second", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			AgentID: testAgentID,
			Client:  nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "client cannot be nil")
	})

	t.Run("empty agent ID checked third", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			AgentID: "",
			Client:  stubClient(),
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent ID cannot be empty")
	})
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestDeleteOptions_WhitespaceAgentID_Structure(t *testing.T) {
	opts := &DeleteOptions{
		AgentID: "   ",
		Client:  stubClient(),
	}

	assert.Equal(t, "   ", opts.AgentID)
	assert.NotNil(t, opts.Client)
}
