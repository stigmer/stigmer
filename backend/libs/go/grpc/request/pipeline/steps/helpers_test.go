package steps

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFindResourceBySlug(t *testing.T) {
	testStore := setupTestStore(t)
	defer testStore.Close()

	ctx := context.Background()
	kind := apiresourcekind.ApiResourceKind_agent

	localAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-local-id",
			Name: "my-agent",
			Slug: "my-agent",
			Org:  "local",
		},
	}

	defaultAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-default-id",
			Name: "my-agent",
			Slug: "my-agent",
			Org:  "default",
		},
	}

	otherAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-other-id",
			Name: "other-agent",
			Slug: "other-agent",
			Org:  "default",
		},
	}

	err := testStore.SaveResource(ctx, kind, localAgent.Metadata.Id, localAgent)
	require.NoError(t, err)
	err = testStore.SaveResource(ctx, kind, defaultAgent.Metadata.Id, defaultAgent)
	require.NoError(t, err)
	err = testStore.SaveResource(ctx, kind, otherAgent.Metadata.Id, otherAgent)
	require.NoError(t, err)

	t.Run("finds resource by slug and org", func(t *testing.T) {
		result, found, err := FindResourceBySlug[*agentv1.Agent](ctx, testStore, kind, "my-agent", "default")

		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, "agent-default-id", result.Metadata.Id)
		assert.Equal(t, "default", result.Metadata.Org)
	})

	t.Run("does not find resource in different org", func(t *testing.T) {
		_, found, err := FindResourceBySlug[*agentv1.Agent](ctx, testStore, kind, "my-agent", "nonexistent-org")

		require.NoError(t, err)
		assert.False(t, found)
	})

	t.Run("same slug in multiple orgs returns correct one", func(t *testing.T) {
		resultLocal, found, err := FindResourceBySlug[*agentv1.Agent](ctx, testStore, kind, "my-agent", "local")
		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, "agent-local-id", resultLocal.Metadata.Id)
		assert.Equal(t, "local", resultLocal.Metadata.Org)

		resultDefault, found, err := FindResourceBySlug[*agentv1.Agent](ctx, testStore, kind, "my-agent", "default")
		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, "agent-default-id", resultDefault.Metadata.Id)
		assert.Equal(t, "default", resultDefault.Metadata.Org)
	})

	t.Run("empty org parameter matches any org", func(t *testing.T) {
		result, found, err := FindResourceBySlug[*agentv1.Agent](ctx, testStore, kind, "my-agent", "")

		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, "my-agent", result.Metadata.Slug)
	})

	t.Run("no matching slug returns not found", func(t *testing.T) {
		_, found, err := FindResourceBySlug[*agentv1.Agent](ctx, testStore, kind, "does-not-exist", "default")

		require.NoError(t, err)
		assert.False(t, found)
	})

	t.Run("empty store returns not found", func(t *testing.T) {
		emptyStore := setupTestStore(t)
		defer emptyStore.Close()

		_, found, err := FindResourceBySlug[*agentv1.Agent](ctx, emptyStore, kind, "my-agent", "default")

		require.NoError(t, err)
		assert.False(t, found)
	})
}
