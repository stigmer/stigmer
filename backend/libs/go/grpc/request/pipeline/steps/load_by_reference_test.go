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
	platformAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         "platform-agent-id",
			Name:       "platform-agent",
			OwnerScope: apiresource.ApiResourceOwnerScope_platform,
		},
	}

	orgAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         "org-agent-id",
			Name:       "org-agent",
			Org:        "test-org",
			OwnerScope: apiresource.ApiResourceOwnerScope_organization,
		},
	}

	// Save to store
	ctx := context.Background()
	err := testStore.SaveResource(ctx, "agent", platformAgent.Metadata.Id, platformAgent)
	require.NoError(t, err)
	err = testStore.SaveResource(ctx, "agent", orgAgent.Metadata.Id, orgAgent)
	require.NoError(t, err)

	t.Run("loads platform-scoped resource by slug", func(t *testing.T) {
		// Create reference (no org = platform scope)
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "platform-agent",
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
		assert.Equal(t, "platform-agent-id", agent.Metadata.Id)
		assert.Equal(t, "platform-agent", agent.Metadata.Name)
	})

	t.Run("loads org-scoped resource by slug and org", func(t *testing.T) {
		// Create reference with org
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "org-agent",
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
		assert.Equal(t, "org-agent-id", agent.Metadata.Id)
		assert.Equal(t, "org-agent", agent.Metadata.Name)
		assert.Equal(t, "test-org", agent.Metadata.Org)
	})

	t.Run("returns error for non-existent slug", func(t *testing.T) {
		// Create reference with non-existent slug
		ref := &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: "non-existent-agent",
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
			Slug: "platform-agent",
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
