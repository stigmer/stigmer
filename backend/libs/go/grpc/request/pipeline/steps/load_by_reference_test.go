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

func TestLoadByReferenceStep(t *testing.T) {
	// Setup test store (uses shared test helper)
	testStore := setupTestStore(t)
	defer testStore.Close()

	// Create test agents
	agentOne := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-one-id",
			Name: "agent-one",
			Slug: "agent-one",
			Org:  "stigmer", // All resources belong to an org
		},
	}

	agentTwo := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-two-id",
			Name: "agent-two",
			Slug: "agent-two",
			Org:  "test-org",
		},
	}

	// Save to store
	ctx := context.Background()
	err := testStore.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agentOne.Metadata.Id, agentOne)
	require.NoError(t, err)
	err = testStore.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agentTwo.Metadata.Id, agentTwo)
	require.NoError(t, err)

	t.Run("loads resource by org and slug", func(t *testing.T) {
		// Create reference with org/slug
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "agent-one",
			Org:  "stigmer",
		}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), ref)

		// Create and execute step
		step := NewLoadByReferenceStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify
		assert.NoError(t, err)

		// Check that target was loaded into context
		loaded := reqCtx.Get(TargetResourceKey)
		require.NotNil(t, loaded)

		agent, ok := loaded.(*agentv1.Agent)
		require.True(t, ok)
		assert.Equal(t, "agent-one-id", agent.Metadata.Id)
		assert.Equal(t, "agent-one", agent.Metadata.Name)
		assert.Equal(t, "stigmer", agent.Metadata.Org)
	})

	t.Run("loads resource from different org", func(t *testing.T) {
		// Create reference with org
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "agent-two",
			Org:  "test-org",
		}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), ref)

		// Create and execute step
		step := NewLoadByReferenceStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify
		assert.NoError(t, err)

		// Check that target was loaded into context
		loaded := reqCtx.Get(TargetResourceKey)
		require.NotNil(t, loaded)

		agent, ok := loaded.(*agentv1.Agent)
		require.True(t, ok)
		assert.Equal(t, "agent-two-id", agent.Metadata.Id)
		assert.Equal(t, "agent-two", agent.Metadata.Name)
		assert.Equal(t, "test-org", agent.Metadata.Org)
	})

	t.Run("returns error for non-existent slug", func(t *testing.T) {
		// Create reference with non-existent slug
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "non-existent-agent",
			Org:  "test-org",
		}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), ref)

		// Create and execute step
		step := NewLoadByReferenceStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify error
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("returns error for empty slug", func(t *testing.T) {
		// Create reference with empty slug
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "",
			Org:  "test-org",
		}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), ref)

		// Create and execute step
		step := NewLoadByReferenceStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify error
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "slug is required")
	})

	t.Run("returns error for kind mismatch", func(t *testing.T) {
		// Create reference with wrong kind
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_workflow, // Wrong kind!
			Slug: "agent-one",
			Org:  "stigmer",
		}

		// Create request context
		reqCtx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), ref)

		// Create and execute step
		step := NewLoadByReferenceStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		// Verify error
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "kind mismatch")
	})

	t.Run("step name is correct", func(t *testing.T) {
		step := NewLoadByReferenceStep[*agentv1.Agent](testStore)
		assert.Equal(t, "LoadByReference", step.Name())
	})
}
