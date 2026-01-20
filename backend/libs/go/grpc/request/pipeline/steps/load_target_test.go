package steps

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadTargetStep(t *testing.T) {
	// Setup test store (uses shared test helper)
	testStore := setupTestStore(t)
	defer testStore.Close()

	// Create a test agent
	testAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "test-agent-id",
			Name: "test-agent",
		},
	}

	// Save to store
	ctx := context.Background()
	err := testStore.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, testAgent.Metadata.Id, testAgent)
	require.NoError(t, err)

	t.Run("loads existing resource successfully", func(t *testing.T) {
		// Create input
		input := &agentv1.AgentId{Value: "test-agent-id"}

		// Create request context (use shared test helper)
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

		// Create and execute step
		step := NewLoadTargetStep[*agentv1.AgentId, *agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify
		assert.NoError(t, err)
		
		// Check that target was loaded into context
		loaded := reqCtx.Get(TargetResourceKey)
		require.NotNil(t, loaded)
		
		agent, ok := loaded.(*agentv1.Agent)
		require.True(t, ok)
		assert.Equal(t, "test-agent-id", agent.Metadata.Id)
		assert.Equal(t, "test-agent", agent.Metadata.Name)
	})

	t.Run("returns error for non-existent resource", func(t *testing.T) {
		// Create input with non-existent ID
		input := &agentv1.AgentId{Value: "non-existent-id"}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

		// Create and execute step
		step := NewLoadTargetStep[*agentv1.AgentId, *agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify error
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("returns error for empty ID", func(t *testing.T) {
		// Create input with empty ID
		input := &agentv1.AgentId{Value: ""}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), input)

		// Create and execute step
		step := NewLoadTargetStep[*agentv1.AgentId, *agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify error
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "resource id is required")
	})

	t.Run("step name is correct", func(t *testing.T) {
		step := NewLoadTargetStep[*agentv1.AgentId, *agentv1.Agent](testStore)
		assert.Equal(t, "LoadTarget", step.Name())
	})
}
