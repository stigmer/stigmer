package sqlite

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourcelib "github.com/stigmer/stigmer/backend/libs/go/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Core Functionality Tests (ported from BadgerDB)
// =============================================================================

func TestStore_SaveAndGetResource(t *testing.T) {
	// Create temporary database
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	// Get kind name from enum for the agent Kind field
	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	// Create test agent
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
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

	// Save resource using kind string
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Get resource using kind string
	retrievedAgent := &agentv1.Agent{}
	err = s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, retrievedAgent)
	require.NoError(t, err)

	// Verify
	assert.Equal(t, agent.Metadata.Id, retrievedAgent.Metadata.Id)
	assert.Equal(t, agent.Metadata.Name, retrievedAgent.Metadata.Name)
	assert.Equal(t, agent.Spec.Description, retrievedAgent.Spec.Description)
}

func TestStore_DeleteResource(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	// Get kind name from enum for the agent Kind field
	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-delete-test",
			Name: "delete-test-agent",
		},
	}

	ctx := context.Background()

	// Save using kind string
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Delete using kind string
	err = s.DeleteResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id)
	require.NoError(t, err)

	// Verify deleted
	retrieved := &agentv1.Agent{}
	err = s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, retrieved)
	assert.Error(t, err)
	assert.True(t, errors.Is(err, store.ErrNotFound), "expected ErrNotFound, got: %v", err)
}

func TestStore_ListResources(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	// Get kind name from enum for the agent Kind field
	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create multiple agents
	for i := 0; i < 3; i++ {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       kindNameStr,
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agent-" + string(rune('0'+i)),
				Name: "agent-" + string(rune('0'+i)),
			},
		}
		err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// List all agents using the enum constant
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Len(t, results, 3)
}

func TestStore_DeleteResourcesByKind(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	// Get kind name from enum for the agent Kind field
	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create multiple agents
	for i := 0; i < 5; i++ {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       kindNameStr,
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agent-bulk-" + string(rune('0'+i)),
				Name: "bulk-agent-" + string(rune('0'+i)),
			},
		}
		err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// Delete all agents using the enum constant
	count, err := s.DeleteResourcesByKind(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Equal(t, int64(5), count)

	// Verify all deleted
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Empty(t, results)
}

func TestStore_GetResource_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	ctx := context.Background()

	agent := &agentv1.Agent{}
	err = s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, "non-existent-id", agent)
	assert.Error(t, err)
	assert.True(t, errors.Is(err, store.ErrNotFound), "expected ErrNotFound, got: %v", err)
}

// =============================================================================
// DeleteResourcesByIdPrefix Tests
// =============================================================================

func TestStore_DeleteResourcesByIdPrefix(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_skill)
	require.NoError(t, err)

	ctx := context.Background()

	// Create audit-like records with prefix pattern: "skill-123/<timestamp>"
	// This mimics the audit trail pattern in the system
	timestamps := []string{"1706123456", "1706123457", "1706123458"}
	for _, ts := range timestamps {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       kindNameStr,
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "skill-123/" + ts,
				Name: "audit-" + ts,
			},
		}
		err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_skill, agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// Create some other resources that shouldn't be deleted
	otherAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "skill-456/1706999999",
			Name: "other-audit",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_skill, otherAgent.Metadata.Id, otherAgent)
	require.NoError(t, err)

	// Delete by prefix "skill-123/"
	count, err := s.DeleteResourcesByIdPrefix(ctx, apiresourcekind.ApiResourceKind_skill, "skill-123/")
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)

	// Verify only the "skill-456" resource remains
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_skill)
	require.NoError(t, err)
	assert.Len(t, results, 1)
}

func TestStore_DeleteResourcesByIdPrefix_EmptyPrefix(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create some resources
	for i := 0; i < 3; i++ {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       kindNameStr,
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agent-" + string(rune('a'+i)),
				Name: "agent-" + string(rune('a'+i)),
			},
		}
		err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// Delete with empty prefix should match all (GLOB '*' matches everything)
	count, err := s.DeleteResourcesByIdPrefix(ctx, apiresourcekind.ApiResourceKind_agent, "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)

	// Verify all deleted
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Empty(t, results)
}

func TestStore_DeleteResourcesByIdPrefix_NoMatches(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create a resource
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-xyz",
			Name: "test-agent",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Delete with prefix that doesn't match
	count, err := s.DeleteResourcesByIdPrefix(ctx, apiresourcekind.ApiResourceKind_agent, "workflow-")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)

	// Verify original resource still exists
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Len(t, results, 1)
}

// =============================================================================
// Upsert (Save Over Existing) Tests
// =============================================================================

func TestStore_SaveResource_Upsert(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create initial agent
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-upsert-test",
			Name: "original-name",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Original description",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Update the agent (same ID, different data)
	agent.Metadata.Name = "updated-name"
	agent.Spec.Description = "Updated description"
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Verify the update took effect
	retrieved := &agentv1.Agent{}
	err = s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, retrieved)
	require.NoError(t, err)
	assert.Equal(t, "updated-name", retrieved.Metadata.Name)
	assert.Equal(t, "Updated description", retrieved.Spec.Description)

	// Verify only one resource exists
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Len(t, results, 1)
}

// =============================================================================
// Concurrent Access Tests
// =============================================================================

func TestStore_ConcurrentReads(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create a resource to read
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-concurrent-read",
			Name: "concurrent-test",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Run concurrent reads
	const numReaders = 50
	var wg sync.WaitGroup
	errs := make(chan error, numReaders)

	for i := 0; i < numReaders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			retrieved := &agentv1.Agent{}
			if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, retrieved); err != nil {
				errs <- err
				return
			}
			if retrieved.Metadata.Name != "concurrent-test" {
				errs <- errors.New("unexpected name value")
			}
		}()
	}

	wg.Wait()
	close(errs)

	// Verify no errors
	for err := range errs {
		t.Errorf("concurrent read error: %v", err)
	}
}

func TestStore_ConcurrentWrites(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Run concurrent writes
	const numWriters = 50
	var wg sync.WaitGroup
	errs := make(chan error, numWriters)

	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			agent := &agentv1.Agent{
				ApiVersion: "agentic.stigmer.ai/v1",
				Kind:       kindNameStr,
				Metadata: &apiresource.ApiResourceMetadata{
					Id:   "agent-concurrent-write-" + string(rune('A'+idx%26)) + string(rune('0'+idx/26)),
					Name: "concurrent-" + string(rune('A'+idx%26)),
				},
			}
			if err := s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent); err != nil {
				errs <- err
			}
		}(i)
	}

	wg.Wait()
	close(errs)

	// Verify no errors
	for err := range errs {
		t.Errorf("concurrent write error: %v", err)
	}

	// Verify all resources were written
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Len(t, results, numWriters)
}

func TestStore_ConcurrentReadWrite(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create initial resource
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-rw-test",
			Name: "initial",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	require.NoError(t, err)

	// Run concurrent reads and writes
	const numOps = 100
	var wg sync.WaitGroup
	errs := make(chan error, numOps)

	for i := 0; i < numOps; i++ {
		wg.Add(1)
		if i%2 == 0 {
			// Reader
			go func() {
				defer wg.Done()
				retrieved := &agentv1.Agent{}
				if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, "agent-rw-test", retrieved); err != nil {
					errs <- err
				}
			}()
		} else {
			// Writer
			go func(idx int) {
				defer wg.Done()
				writeAgent := &agentv1.Agent{
					ApiVersion: "agentic.stigmer.ai/v1",
					Kind:       kindNameStr,
					Metadata: &apiresource.ApiResourceMetadata{
						Id:   "agent-rw-test",
						Name: "updated-" + string(rune('0'+idx%10)),
					},
				}
				if err := s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, writeAgent.Metadata.Id, writeAgent); err != nil {
					errs <- err
				}
			}(i)
		}
	}

	wg.Wait()
	close(errs)

	// Verify no errors
	for err := range errs {
		t.Errorf("concurrent read/write error: %v", err)
	}
}

// =============================================================================
// List Resources Empty Results Tests
// =============================================================================

func TestStore_ListResources_Empty(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	ctx := context.Background()

	// List resources of a kind that has no entries
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow)
	require.NoError(t, err)
	assert.NotNil(t, results, "should return empty slice, not nil")
	assert.Len(t, results, 0)
}

// =============================================================================
// Delete Non-Existent Resource Tests
// =============================================================================

func TestStore_DeleteResource_NonExistent(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	ctx := context.Background()

	// Delete a resource that doesn't exist should not error
	err = s.DeleteResource(ctx, apiresourcekind.ApiResourceKind_agent, "non-existent-id")
	require.NoError(t, err)
}

// =============================================================================
// Store Close Tests
// =============================================================================

func TestStore_Close_DoubleClose(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)

	// First close should succeed
	err = s.Close()
	require.NoError(t, err)

	// Second close should also succeed (idempotent)
	err = s.Close()
	require.NoError(t, err)
}

func TestStore_OperationsAfterClose(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)

	err = s.Close()
	require.NoError(t, err)

	ctx := context.Background()

	// All operations should fail after close
	kindNameStr, _ := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Id: "test"},
		Kind:     kindNameStr,
	}

	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, "test", agent)
	assert.Error(t, err)

	err = s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, "test", agent)
	assert.Error(t, err)

	_, err = s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	assert.Error(t, err)

	err = s.DeleteResource(ctx, apiresourcekind.ApiResourceKind_agent, "test")
	assert.Error(t, err)

	_, err = s.DeleteResourcesByKind(ctx, apiresourcekind.ApiResourceKind_agent)
	assert.Error(t, err)

	_, err = s.DeleteResourcesByIdPrefix(ctx, apiresourcekind.ApiResourceKind_agent, "test")
	assert.Error(t, err)
}

// =============================================================================
// Database Path Tests
// =============================================================================

func TestStore_Path(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "subdir", "nested", "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	// Verify path is correct
	assert.Equal(t, dbPath, s.Path())
}

func TestStore_NewStore_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "deeply", "nested", "directory", "test.sqlite")

	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	// Verify database was created
	ctx := context.Background()
	kindNameStr, _ := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Id: "test"},
		Kind:     kindNameStr,
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, "test", agent)
	require.NoError(t, err)
}

// =============================================================================
// Large Dataset Performance Tests
// =============================================================================

func TestStore_LargeDataset(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping large dataset test in short mode")
	}

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Insert 1000 resources
	const numResources = 1000
	for i := 0; i < numResources; i++ {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       kindNameStr,
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "agent-large-" + string(rune('A'+i/100)) + string(rune('0'+i%100/10)) + string(rune('0'+i%10)),
				Name: "large-dataset-agent",
			},
			Spec: &agentv1.AgentSpec{
				Description: "Large dataset test agent with some additional data to increase size",
			},
		}
		err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
		require.NoError(t, err)
	}

	// List all resources
	results, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Len(t, results, numResources)

	// Delete all by kind
	count, err := s.DeleteResourcesByKind(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Equal(t, int64(numResources), count)

	// Verify deletion
	results, err = s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)
	assert.Len(t, results, 0)
}

// =============================================================================
// Special Characters in IDs Tests
// =============================================================================

func TestStore_SpecialCharactersInID(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Test various special characters in IDs
	specialIDs := []string{
		"agent-with-dashes",
		"agent_with_underscores",
		"agent.with.dots",
		"agent:with:colons",
		"agent/with/slashes",
		"agent@with@at",
		"agent+with+plus",
	}

	for _, id := range specialIDs {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       kindNameStr,
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   id,
				Name: "special-char-agent",
			},
		}

		// Save
		err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, id, agent)
		require.NoError(t, err, "failed to save agent with ID: %s", id)

		// Get
		retrieved := &agentv1.Agent{}
		err = s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, id, retrieved)
		require.NoError(t, err, "failed to get agent with ID: %s", id)
		assert.Equal(t, id, retrieved.Metadata.Id)

		// Delete
		err = s.DeleteResource(ctx, apiresourcekind.ApiResourceKind_agent, id)
		require.NoError(t, err, "failed to delete agent with ID: %s", id)
	}
}

// =============================================================================
// Audit Operations Tests
// =============================================================================

func TestStore_SaveAudit(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// First create the parent resource
	resourceId := "agent-audit-test-123"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   resourceId,
			Name: "test-agent",
		},
		Spec: &agentv1.AgentSpec{
			Description: "Original version",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent)
	require.NoError(t, err)

	// Save audit record with hash and tag
	versionHash := "abc123def456abc123def456abc123def456abc123def456abc123def456abcd"
	tag := "v1.0.0"
	err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, versionHash, tag)
	require.NoError(t, err)

	// Verify audit record can be retrieved by hash
	retrieved := &agentv1.Agent{}
	err = s.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, versionHash, retrieved)
	require.NoError(t, err)
	assert.Equal(t, agent.Metadata.Id, retrieved.Metadata.Id)
	assert.Equal(t, agent.Spec.Description, retrieved.Spec.Description)
}

func TestStore_GetAuditByHash(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create parent resource
	resourceId := "agent-hash-test"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   resourceId,
			Name: "hash-test-agent",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent)
	require.NoError(t, err)

	// Save multiple audit records with different hashes
	hash1 := "1111111111111111111111111111111111111111111111111111111111111111"
	hash2 := "2222222222222222222222222222222222222222222222222222222222222222"

	agent.Spec = &agentv1.AgentSpec{Description: "Version 1"}
	err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, hash1, "v1")
	require.NoError(t, err)

	agent.Spec = &agentv1.AgentSpec{Description: "Version 2"}
	err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, hash2, "v2")
	require.NoError(t, err)

	// Retrieve by hash1
	retrieved := &agentv1.Agent{}
	err = s.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, hash1, retrieved)
	require.NoError(t, err)
	assert.Equal(t, "Version 1", retrieved.Spec.Description)

	// Retrieve by hash2
	err = s.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, hash2, retrieved)
	require.NoError(t, err)
	assert.Equal(t, "Version 2", retrieved.Spec.Description)

	// Non-existent hash should return ErrAuditNotFound
	nonExistentHash := "9999999999999999999999999999999999999999999999999999999999999999"
	err = s.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, nonExistentHash, retrieved)
	assert.Error(t, err)
	assert.True(t, errors.Is(err, store.ErrAuditNotFound), "expected ErrAuditNotFound, got: %v", err)
}

func TestStore_GetAuditByTag(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create parent resource
	resourceId := "agent-tag-test"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   resourceId,
			Name: "tag-test-agent",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent)
	require.NoError(t, err)

	// Save multiple audit records with the same tag (simulating re-tagging)
	// The most recent should be returned
	tag := "latest"

	agent.Spec = &agentv1.AgentSpec{Description: "First version with latest tag"}
	err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, "hash1", tag)
	require.NoError(t, err)

	agent.Spec = &agentv1.AgentSpec{Description: "Second version with latest tag"}
	err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, "hash2", tag)
	require.NoError(t, err)

	// Retrieve by tag - should return the most recent (second version)
	retrieved := &agentv1.Agent{}
	err = s.GetAuditByTag(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, tag, retrieved)
	require.NoError(t, err)
	assert.Equal(t, "Second version with latest tag", retrieved.Spec.Description)

	// Non-existent tag should return ErrAuditNotFound
	err = s.GetAuditByTag(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, "non-existent-tag", retrieved)
	assert.Error(t, err)
	assert.True(t, errors.Is(err, store.ErrAuditNotFound), "expected ErrAuditNotFound, got: %v", err)
}

func TestStore_ListAuditHistory(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create parent resource
	resourceId := "agent-history-test"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   resourceId,
			Name: "history-test-agent",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent)
	require.NoError(t, err)

	// Save 5 audit records
	for i := 0; i < 5; i++ {
		agent.Spec = &agentv1.AgentSpec{Description: "Version " + string(rune('0'+i))}
		hash := string(rune('0'+i)) + "111111111111111111111111111111111111111111111111111111111111111"
		err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, hash, "v"+string(rune('0'+i)))
		require.NoError(t, err)
	}

	// List audit history
	history, err := s.ListAuditHistory(ctx, apiresourcekind.ApiResourceKind_agent, resourceId)
	require.NoError(t, err)
	assert.Len(t, history, 5)

	// Empty history for non-existent resource
	history, err = s.ListAuditHistory(ctx, apiresourcekind.ApiResourceKind_agent, "non-existent-resource")
	require.NoError(t, err)
	assert.NotNil(t, history, "should return empty slice, not nil")
	assert.Len(t, history, 0)
}

func TestStore_DeleteAuditByResourceId(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	require.NoError(t, err)

	ctx := context.Background()

	// Create parent resource
	resourceId := "agent-delete-audit-test"
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   resourceId,
			Name: "delete-audit-test-agent",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent)
	require.NoError(t, err)

	// Create another resource to ensure we only delete the right audits
	otherResourceId := "agent-other-resource"
	otherAgent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   otherResourceId,
			Name: "other-agent",
		},
	}
	err = s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, otherResourceId, otherAgent)
	require.NoError(t, err)

	// Save audit records for both resources
	for i := 0; i < 3; i++ {
		agent.Spec = &agentv1.AgentSpec{Description: "Version " + string(rune('0'+i))}
		hash := string(rune('0'+i)) + "111111111111111111111111111111111111111111111111111111111111111"
		err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, resourceId, agent, hash, "v"+string(rune('0'+i)))
		require.NoError(t, err)
	}

	for i := 0; i < 2; i++ {
		otherAgent.Spec = &agentv1.AgentSpec{Description: "Other Version " + string(rune('0'+i))}
		hash := "other" + string(rune('0'+i)) + "1111111111111111111111111111111111111111111111111111111111"
		err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, otherResourceId, otherAgent, hash, "v"+string(rune('0'+i)))
		require.NoError(t, err)
	}

	// Delete audit records for first resource only
	count, err := s.DeleteAuditByResourceId(ctx, apiresourcekind.ApiResourceKind_agent, resourceId)
	require.NoError(t, err)
	assert.Equal(t, int64(3), count)

	// Verify first resource's audits are deleted
	history, err := s.ListAuditHistory(ctx, apiresourcekind.ApiResourceKind_agent, resourceId)
	require.NoError(t, err)
	assert.Len(t, history, 0)

	// Verify other resource's audits are still there
	history, err = s.ListAuditHistory(ctx, apiresourcekind.ApiResourceKind_agent, otherResourceId)
	require.NoError(t, err)
	assert.Len(t, history, 2)
}

func TestStore_AuditOperationsAfterClose(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)

	err = s.Close()
	require.NoError(t, err)

	ctx := context.Background()

	kindNameStr, _ := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent)
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Id: "test"},
		Kind:     kindNameStr,
	}

	// All audit operations should fail after close
	err = s.SaveAudit(ctx, apiresourcekind.ApiResourceKind_agent, "test", agent, "hash", "tag")
	assert.Error(t, err)

	err = s.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_agent, "test", "hash", agent)
	assert.Error(t, err)

	err = s.GetAuditByTag(ctx, apiresourcekind.ApiResourceKind_agent, "test", "tag", agent)
	assert.Error(t, err)

	_, err = s.ListAuditHistory(ctx, apiresourcekind.ApiResourceKind_agent, "test")
	assert.Error(t, err)

	_, err = s.DeleteAuditByResourceId(ctx, apiresourcekind.ApiResourceKind_agent, "test")
	assert.Error(t, err)
}
