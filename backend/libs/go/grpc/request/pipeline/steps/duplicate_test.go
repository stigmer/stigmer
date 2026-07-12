package steps

import (
	"context"
	"fmt"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCheckDuplicateStep_NoDuplicate(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "test-agent",
			Name: "Test Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	// Execute (no existing resources, should succeed)
	err := step.Execute(ctx)

	if err != nil {
		t.Errorf("Expected success when no duplicate exists, got error: %v", err)
	}
}

func TestCheckDuplicateStep_DuplicateExists(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Save an existing agent
	existing := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-existing",
			Slug: "test-agent",
			Name: "Existing Agent",
			Org:  "default",
		},
		Kind:       "Agent",
		ApiVersion: "ai.stigmer.agentic.agent/v1",
	}
	store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, existing.Metadata.Id, existing)

	// Try to create another agent with same slug and org
	newAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "test-agent",
			Name: "New Agent",
			Org:  "default",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), newAgent)
	ctx.SetNewState(newAgent)

	// Execute (should fail with duplicate error)
	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected duplicate error, got success")
	}
}

// A duplicate slug must return a typed AlreadyExists status, not a plain error
// (which the pipeline would surface as Unknown). Complements
// TestCheckDuplicateStep_DuplicateExists, which only checks err!=nil.
func TestCheckDuplicateStep_DuplicateReturnsAlreadyExistsCode(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	existing := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-existing",
			Slug: "test-agent",
			Name: "Existing Agent",
			Org:  "default",
		},
		Kind:       "Agent",
		ApiVersion: "ai.stigmer.agentic.agent/v1",
	}
	store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, existing.Metadata.Id, existing)

	newAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "test-agent",
			Name: "New Agent",
			Org:  "default",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), newAgent)
	ctx.SetNewState(newAgent)

	err := step.Execute(ctx)

	if err == nil {
		t.Fatal("expected duplicate error")
	}
	if status.Code(err) != codes.AlreadyExists {
		t.Errorf("expected AlreadyExists, got %s", status.Code(err))
	}
}

func TestCheckDuplicateStep_EmptySlug(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "", // Empty slug
			Name: "Test Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for empty slug, got success")
	}
}

func TestCheckDuplicateStep_NilMetadata(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	agent := &agentv1.Agent{
		Metadata: nil,
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected error for nil metadata, got success")
	}
}

func TestCheckDuplicateStep_MultipleSlugs(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	// Save multiple agents with different slugs
	agents := []string{
		"agent-1",
		"agent-2",
		"agent-3",
	}

	for i, slug := range agents {
		agent := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   fmt.Sprintf("agent-%d", i),
				Slug: slug,
				Name: fmt.Sprintf("Agent %d", i),
			},
			Kind:       "Agent",
			ApiVersion: "ai.stigmer.agentic.agent/v1",
		}
		store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
	}

	// Try to create duplicate
	newAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Slug: "agent-1",
			Name: "New Agent",
		},
	}

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), newAgent)
	ctx.SetNewState(newAgent)

	err := step.Execute(ctx)

	if err == nil {
		t.Errorf("Expected duplicate error, got success")
	}
}

func TestCheckDuplicateStep_Name(t *testing.T) {
	store := setupTestStore(t)
	defer store.Close()

	step := NewCheckDuplicateStep[*agentv1.Agent](store)
	if step.Name() != "CheckDuplicate" {
		t.Errorf("Expected Name()=CheckDuplicate, got %q", step.Name())
	}
}

func TestCheckDuplicateStep_OrgScoping(t *testing.T) {
	testStore := setupTestStore(t)
	defer testStore.Close()

	ctx := context.Background()
	kind := apiresourcekind.ApiResourceKind_agent

	existing := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-local-id",
			Slug: "my-agent",
			Name: "My Agent",
			Org:  "local",
		},
	}

	err := testStore.SaveResource(ctx, kind, existing.Metadata.Id, existing)
	require.NoError(t, err)

	t.Run("same slug different org is allowed", func(t *testing.T) {
		input := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Slug: "my-agent",
				Name: "My Agent",
				Org:  "default",
			},
		}

		reqCtx := pipeline.NewRequestContext(contextWithKind(kind), input)
		reqCtx.SetNewState(input)

		step := NewCheckDuplicateStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		assert.NoError(t, err)
	})

	t.Run("same slug same org is duplicate", func(t *testing.T) {
		input := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Slug: "my-agent",
				Name: "My Agent",
				Org:  "local",
			},
		}

		reqCtx := pipeline.NewRequestContext(contextWithKind(kind), input)
		reqCtx.SetNewState(input)

		step := NewCheckDuplicateStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "already exists")
	})

	t.Run("error message includes org", func(t *testing.T) {
		input := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Slug: "my-agent",
				Name: "My Agent",
				Org:  "local",
			},
		}

		reqCtx := pipeline.NewRequestContext(contextWithKind(kind), input)
		reqCtx.SetNewState(input)

		step := NewCheckDuplicateStep[*agentv1.Agent](testStore)
		err := step.Execute(reqCtx)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "org 'local'")
		assert.Contains(t, err.Error(), "my-agent")
	})
}
