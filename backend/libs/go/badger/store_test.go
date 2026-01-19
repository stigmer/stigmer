package badger

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

func TestStore_SaveAndGetResource(t *testing.T) {
	// Create temporary database
	tmpDir := t.TempDir()
	store, err := NewStore(tmpDir)
	require.NoError(t, err)
	defer store.Close()

	// Create test agent
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-test-123",
			Name: "test-agent",
			Org:  "org-123",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Test agent",
		},
	}

	ctx := context.Background()

	// Save resource
	err = store.SaveResource(ctx, "Agent", agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Get resource
	retrievedAgent := &agentv1.Agent{}
	err = store.GetResource(ctx, agent.Metadata.Id, retrievedAgent)
	require.NoError(t, err)

	// Verify
	assert.Equal(t, agent.Metadata.Id, retrievedAgent.Metadata.Id)
	assert.Equal(t, agent.Metadata.Name, retrievedAgent.Metadata.Name)
	assert.Equal(t, agent.Spec.Description, retrievedAgent.Spec.Description)
}

func TestStore_DeleteResource(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := NewStore(tmpDir)
	require.NoError(t, err)
	defer store.Close()

	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-delete-test",
			Name: "delete-test-agent",
		},
	}

	ctx := context.Background()

	// Save
	err = store.SaveResource(ctx, "Agent", agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Delete
	err = store.DeleteResource(ctx, agent.Metadata.Id)
	require.NoError(t, err)

	// Verify deleted
	retrieved := &agentv1.Agent{}
	err = store.GetResource(ctx, agent.Metadata.Id, retrieved)
	assert.Error(t, err)
}

func TestStore_ListResources(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := NewStore(tmpDir)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	// Create multiple agents
	for i := 0; i < 3; i++ {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agent-" + string(rune('0'+i)),
				Name: "agent-" + string(rune('0'+i)),
			},
		}
		err = store.SaveResource(ctx, "Agent", agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// List all agents
	results, err := store.ListResources(ctx, "Agent")
	require.NoError(t, err)
	assert.Len(t, results, 3)
}

func TestStore_DeleteResourcesByKind(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := NewStore(tmpDir)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	// Create multiple agents
	for i := 0; i < 5; i++ {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agent-bulk-" + string(rune('0'+i)),
				Name: "bulk-agent-" + string(rune('0'+i)),
			},
		}
		err = store.SaveResource(ctx, "Agent", agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// Delete all agents
	count, err := store.DeleteResourcesByKind(ctx, "Agent")
	require.NoError(t, err)
	assert.Equal(t, int64(5), count)

	// Verify all deleted
	results, err := store.ListResources(ctx, "Agent")
	require.NoError(t, err)
	assert.Empty(t, results)
}

func TestStore_GetResource_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := NewStore(tmpDir)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	agent := &agentv1.Agent{}
	err = store.GetResource(ctx, "non-existent-id", agent)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestMain(m *testing.M) {
	// Run tests
	code := m.Run()
	os.Exit(code)
}
