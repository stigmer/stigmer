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

func TestFindResourceByLabelAndOrg(t *testing.T) {
	testStore := setupTestStore(t)
	defer testStore.Close()

	ctx := context.Background()
	kind := apiresourcekind.ApiResourceKind_agent

	const labelKey = "stigmer.ai/personal"
	const labelValue = "true"

	// Personal agent in org "acme".
	personalAcme := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:     "agent-personal-acme",
			Name:   "personal-acme",
			Slug:   "personal-acme",
			Org:    "acme",
			Labels: map[string]string{labelKey: labelValue},
		},
	}

	// Personal agent with no org (empty org).
	personalNoOrg := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:     "agent-personal-no-org",
			Name:   "personal-no-org",
			Slug:   "personal-no-org",
			Org:    "",
			Labels: map[string]string{labelKey: labelValue},
		},
	}

	// Non-personal agent in org "acme" (label absent).
	plainAcme := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-plain-acme",
			Name: "plain-acme",
			Slug: "plain-acme",
			Org:  "acme",
		},
	}

	require.NoError(t, testStore.SaveResource(ctx, kind, personalAcme.Metadata.Id, personalAcme))
	require.NoError(t, testStore.SaveResource(ctx, kind, personalNoOrg.Metadata.Id, personalNoOrg))
	require.NoError(t, testStore.SaveResource(ctx, kind, plainAcme.Metadata.Id, plainAcme))

	t.Run("finds resource by label and org", func(t *testing.T) {
		result, found, err := FindResourceByLabelAndOrg[*agentv1.Agent](ctx, testStore, kind, labelKey, labelValue, "acme")

		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, "agent-personal-acme", result.Metadata.Id)
	})

	t.Run("same label in a different org does not match (issue #193)", func(t *testing.T) {
		_, found, err := FindResourceByLabelAndOrg[*agentv1.Agent](ctx, testStore, kind, labelKey, labelValue, "globex")

		require.NoError(t, err)
		assert.False(t, found)
	})

	t.Run("right org but wrong label value does not match", func(t *testing.T) {
		_, found, err := FindResourceByLabelAndOrg[*agentv1.Agent](ctx, testStore, kind, labelKey, "false", "acme")

		require.NoError(t, err)
		assert.False(t, found)
	})

	t.Run("empty org matches only empty-org resources", func(t *testing.T) {
		result, found, err := FindResourceByLabelAndOrg[*agentv1.Agent](ctx, testStore, kind, labelKey, labelValue, "")

		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, "agent-personal-no-org", result.Metadata.Id,
			"empty org must be matched exactly, never as a wildcard over other orgs")
	})

	t.Run("empty store returns not found", func(t *testing.T) {
		emptyStore := setupTestStore(t)
		defer emptyStore.Close()

		_, found, err := FindResourceByLabelAndOrg[*agentv1.Agent](ctx, emptyStore, kind, labelKey, labelValue, "acme")

		require.NoError(t, err)
		assert.False(t, found)
	})
}
