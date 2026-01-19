package sqlite

import (
	"context"
	"os"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/proto"
)

func TestStoreLifecycle(t *testing.T) {
	// Create temporary database
	tmpDB := "/tmp/test-stigmer.db"
	defer os.Remove(tmpDB)

	// Initialize store
	store, err := NewStore(tmpDB)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()

	// Create test agent
	agent := &agentv1.Agent{
		ApiResourceMetadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-test-001",
			Name: "Test Agent",
			OrgId: "org-test",
		},
		Spec: &agentv1.AgentSpec{
			Description: "A test agent",
			Model:       "gpt-4",
		},
	}

	// Test SaveResource
	err = store.SaveResource(ctx, "Agent", agent.ApiResourceMetadata.Id, agent)
	if err != nil {
		t.Fatalf("failed to save resource: %v", err)
	}

	// Test GetResource
	retrieved := &agentv1.Agent{}
	err = store.GetResource(ctx, agent.ApiResourceMetadata.Id, retrieved)
	if err != nil {
		t.Fatalf("failed to get resource: %v", err)
	}

	if retrieved.ApiResourceMetadata.Name != agent.ApiResourceMetadata.Name {
		t.Errorf("expected name %s, got %s", agent.ApiResourceMetadata.Name, retrieved.ApiResourceMetadata.Name)
	}

	// Test ListResources
	resources, err := store.ListResources(ctx, "Agent")
	if err != nil {
		t.Fatalf("failed to list resources: %v", err)
	}

	if len(resources) != 1 {
		t.Errorf("expected 1 resource, got %d", len(resources))
	}

	// Test UpdateResource (upsert)
	agent.Spec.Description = "Updated description"
	err = store.SaveResource(ctx, "Agent", agent.ApiResourceMetadata.Id, agent)
	if err != nil {
		t.Fatalf("failed to update resource: %v", err)
	}

	updated := &agentv1.Agent{}
	err = store.GetResource(ctx, agent.ApiResourceMetadata.Id, updated)
	if err != nil {
		t.Fatalf("failed to get updated resource: %v", err)
	}

	if updated.Spec.Description != "Updated description" {
		t.Errorf("expected description 'Updated description', got '%s'", updated.Spec.Description)
	}

	// Verify only one record exists (upsert worked)
	resources, err = store.ListResources(ctx, "Agent")
	if err != nil {
		t.Fatalf("failed to list resources after update: %v", err)
	}

	if len(resources) != 1 {
		t.Errorf("expected 1 resource after update, got %d", len(resources))
	}

	// Test DeleteResource
	err = store.DeleteResource(ctx, agent.ApiResourceMetadata.Id)
	if err != nil {
		t.Fatalf("failed to delete resource: %v", err)
	}

	// Verify deletion
	err = store.GetResource(ctx, agent.ApiResourceMetadata.Id, retrieved)
	if err == nil {
		t.Error("expected error when getting deleted resource")
	}
}

func TestListResourcesByOrg(t *testing.T) {
	tmpDB := "/tmp/test-stigmer-org.db"
	defer os.Remove(tmpDB)

	store, err := NewStore(tmpDB)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()

	// Create agents for different orgs
	agent1 := &agentv1.Agent{
		ApiResourceMetadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-001",
			Name: "Agent 1",
			OrgId: "org-1",
		},
	}

	agent2 := &agentv1.Agent{
		ApiResourceMetadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-002",
			Name: "Agent 2",
			OrgId: "org-1",
		},
	}

	agent3 := &agentv1.Agent{
		ApiResourceMetadata: &apiresource.ApiResourceMetadata{
			Id:   "agent-003",
			Name: "Agent 3",
			OrgId: "org-2",
		},
	}

	// Save all agents
	for _, agent := range []*agentv1.Agent{agent1, agent2, agent3} {
		err = store.SaveResource(ctx, "Agent", agent.ApiResourceMetadata.Id, agent)
		if err != nil {
			t.Fatalf("failed to save agent: %v", err)
		}
	}

	// List agents for org-1
	resources, err := store.ListResourcesByOrg(ctx, "Agent", "org-1")
	if err != nil {
		t.Fatalf("failed to list resources by org: %v", err)
	}

	if len(resources) != 2 {
		t.Errorf("expected 2 resources for org-1, got %d", len(resources))
	}

	// List agents for org-2
	resources, err = store.ListResourcesByOrg(ctx, "Agent", "org-2")
	if err != nil {
		t.Fatalf("failed to list resources by org: %v", err)
	}

	if len(resources) != 1 {
		t.Errorf("expected 1 resource for org-2, got %d", len(resources))
	}
}

func TestDeleteResourcesByKind(t *testing.T) {
	tmpDB := "/tmp/test-stigmer-delete.db"
	defer os.Remove(tmpDB)

	store, err := NewStore(tmpDB)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()

	// Create multiple agents
	for i := 1; i <= 3; i++ {
		agent := &agentv1.Agent{
			ApiResourceMetadata: &apiresource.ApiResourceMetadata{
				Id:   proto.String("agent-" + string(rune('0'+i))),
				Name: proto.String("Agent " + string(rune('0'+i))),
			},
		}
		err = store.SaveResource(ctx, "Agent", agent.ApiResourceMetadata.Id, agent)
		if err != nil {
			t.Fatalf("failed to save agent: %v", err)
		}
	}

	// Delete all agents
	count, err := store.DeleteResourcesByKind(ctx, "Agent")
	if err != nil {
		t.Fatalf("failed to delete resources by kind: %v", err)
	}

	if count != 3 {
		t.Errorf("expected to delete 3 resources, deleted %d", count)
	}

	// Verify deletion
	resources, err := store.ListResources(ctx, "Agent")
	if err != nil {
		t.Fatalf("failed to list resources: %v", err)
	}

	if len(resources) != 0 {
		t.Errorf("expected 0 resources after deletion, got %d", len(resources))
	}
}
