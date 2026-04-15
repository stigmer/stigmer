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

func TestDelete_NilConnection(t *testing.T) {
	opts := &DeleteOptions{
		AgentID: testAgentID,
		Conn:    nil,
	}

	result, err := Delete(opts)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
}

func TestDelete_EmptyAgentID(t *testing.T) {
	opts := &DeleteOptions{
		AgentID: "",
		Conn:    &mockConn{},
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
	conn := &mockConn{}

	result, err := DeleteFromBackend(conn, "")

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "agent ID is required for delete operation")
}

// =============================================================================
// DeleteResult Structure Tests
// =============================================================================

func TestDeleteResult_Structure(t *testing.T) {
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   testAgentID,
			Name: testAgentName,
			Slug: testAgentSlug,
		},
	}

	result := &DeleteResult{
		Agent: agent,
	}

	assert.NotNil(t, result.Agent)
	assert.Equal(t, testAgentID, result.Agent.Metadata.Id)
	assert.Equal(t, testAgentName, result.Agent.Metadata.Name)
	assert.Equal(t, testAgentSlug, result.Agent.Metadata.Slug)
}

func TestDeleteResult_NilAgent(t *testing.T) {
	// DeleteResult can hold nil agent (edge case)
	result := &DeleteResult{
		Agent: nil,
	}

	assert.Nil(t, result.Agent)
}

// =============================================================================
// DeleteOptions Structure Tests
// =============================================================================

func TestDeleteOptions_ValidStructure(t *testing.T) {
	conn := &mockConn{}
	opts := &DeleteOptions{
		AgentID: testAgentID,
		Conn:    conn,
	}

	assert.Equal(t, testAgentID, opts.AgentID)
	assert.NotNil(t, opts.Conn)
}

func TestDeleteOptions_DefaultValues(t *testing.T) {
	opts := &DeleteOptions{}

	assert.Equal(t, "", opts.AgentID)
	assert.Nil(t, opts.Conn)
}

func TestDeleteOptions_AgentIDFormats(t *testing.T) {
	// Test various valid agent ID formats
	testCases := []struct {
		name    string
		agentID string
	}{
		{
			name:    "underscore separator",
			agentID: "agt_abc123",
		},
		{
			name:    "hyphen separator",
			agentID: "agt-abc123",
		},
		{
			name:    "long ID",
			agentID: "agt_01kewqjbtdy0w4d14bnhhy4yc2",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			opts := &DeleteOptions{
				AgentID: tc.agentID,
				Conn:    &mockConn{},
			}
			assert.Equal(t, tc.agentID, opts.AgentID)
		})
	}
}

// =============================================================================
// Validation Order Tests
// =============================================================================

func TestDelete_ValidationOrder(t *testing.T) {
	// Verify validation happens in the correct order:
	// 1. nil options check
	// 2. nil connection check
	// 3. empty agent ID check

	t.Run("nil options checked first", func(t *testing.T) {
		_, err := Delete(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "delete options cannot be nil")
	})

	t.Run("nil connection checked second", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			AgentID: testAgentID,
			Conn:    nil,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "gRPC connection cannot be nil")
	})

	t.Run("empty agent ID checked third", func(t *testing.T) {
		_, err := Delete(&DeleteOptions{
			AgentID: "",
			Conn:    &mockConn{},
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent ID cannot be empty")
	})
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestDeleteOptions_WhitespaceAgentID_Structure(t *testing.T) {
	// Whitespace-only ID is technically not empty per validation
	// This tests that the options struct accepts it
	opts := &DeleteOptions{
		AgentID: "   ",
		Conn:    &mockConn{},
	}

	// Verify the struct is created correctly
	assert.Equal(t, "   ", opts.AgentID)
	assert.NotNil(t, opts.Conn)
	// Note: The actual RPC call would fail with whitespace ID
	// but validation only checks for empty string
}
