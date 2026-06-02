package agent

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// contextWithAgentKind creates a context with the agent resource kind injected
// This simulates what the apiresource interceptor does in production
func contextWithAgentKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_agent)
}

func TestAgentController_Create(t *testing.T) {
	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil) // nil agentInstanceClient for tests

	t.Run("successful creation", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Test Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "A test agent",
				Instructions: "You are a helpful test agent that assists with testing.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify pipeline set defaults
		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug == "" {
			t.Error("Expected slug to be set")
		}

		if created.Metadata.Slug != "test-agent" {
			t.Errorf("Expected slug 'test-agent', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "Agent" {
			t.Errorf("Expected kind 'Agent', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}
	})

	t.Run("duplicate detection", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Duplicate Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are a duplicate test agent.",
			},
		}

		// Create first time should succeed
		_, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("First create failed: %v", err)
		}

		// Create second time should fail (duplicate slug)
		_, err = controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected duplicate creation to fail")
		}
	})

	t.Run("missing metadata", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
		}

		_, err := controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("missing name", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata:   &apiresource.ApiResourceMetadata{},
		}

		_, err := controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})
}

func TestAgentController_Update(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil) // nil agentInstanceClient for tests

	t.Run("successful update", func(t *testing.T) {
		// Create an agent first
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Original Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Original description",
				Instructions: "You are a helpful agent for update testing.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the agent
		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithAgentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}
	})

	t.Run("update non-existent agent", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "non-existent-id",
				Name: "Non-existent Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are a non-existent agent.",
			},
		}

		_, err := controller.Update(contextWithAgentKind(), agent)
		if err == nil {
			t.Error("Expected error for updating non-existent agent")
		}
	})
}

func TestAgentController_Delete(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil) // nil agentInstanceClient for tests

	t.Run("successful deletion", func(t *testing.T) {
		// Create an agent first
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Agent to Delete",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are an agent that will be deleted.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the agent
		deleted, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted agent ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify agent is deleted
		_, err = controller.Get(contextWithAgentKind(), &agentv1.AgentId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted agent")
		}
	})

	t.Run("delete non-existent agent", func(t *testing.T) {
		_, err := controller.Delete(contextWithAgentKind(), &agentv1.AgentId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent agent")
		}
	})
}

func TestAgentController_MergeMcpServerEnvSpecs(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	controller := NewAgentController(store, nil)

	t.Run("merges env from referenced MCP server", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_1",
				Name: "Test MCP Server",
				Slug: "test-mcp-server",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "An MCP server for testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"API_KEY": {
						Description: "API key for the MCP server",
						IsSecret:    true,
					},
					"API_URL": {
						Description: "Base URL for the API",
						IsSecret:    false,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_1", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Agent With MCP",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent that uses an MCP server",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "test-mcp-server",
						},
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if envDecls == nil {
			t.Fatal("Expected env to be populated, got nil")
		}
		if len(envDecls) != 2 {
			t.Fatalf("Expected 2 env vars, got %d", len(envDecls))
		}
		if apiKey, ok := envDecls["API_KEY"]; !ok {
			t.Error("Expected API_KEY in env")
		} else {
			if !apiKey.IsSecret {
				t.Error("Expected API_KEY.is_secret to be true")
			}
		}
		if apiUrl, ok := envDecls["API_URL"]; !ok {
			t.Error("Expected API_URL in env")
		} else {
			if apiUrl.IsSecret {
				t.Error("Expected API_URL.is_secret to be false")
			}
		}
	})

	t.Run("agent-declared env vars take precedence", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_2",
				Name: "Precedence MCP Server",
				Slug: "precedence-mcp",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "MCP server for precedence testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"SHARED_VAR": {
						Description: "MCP description",
						IsSecret:    false,
					},
					"MCP_ONLY_VAR": {
						Description: "Only from MCP",
						IsSecret:    true,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_2", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Precedence Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent testing precedence",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "precedence-mcp",
						},
					},
				},
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"SHARED_VAR": {
						Description: "Agent description wins",
						IsSecret:    true,
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if len(envDecls) != 2 {
			t.Fatalf("Expected 2 env vars, got %d", len(envDecls))
		}

		sharedVar := envDecls["SHARED_VAR"]
		if sharedVar.Description != "Agent description wins" {
			t.Errorf("Expected agent description to win, got %q", sharedVar.Description)
		}
		if !sharedVar.IsSecret {
			t.Error("Expected agent's is_secret=true to be preserved")
		}

		if _, ok := envDecls["MCP_ONLY_VAR"]; !ok {
			t.Error("Expected MCP_ONLY_VAR to be merged from MCP server")
		}
	})

	t.Run("no MCP usages is a no-op", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "No MCP Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent without MCP servers",
				Instructions: "You are a helpful agent.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if len(envDecls) != 0 {
			t.Errorf("Expected empty env, got %d entries", len(envDecls))
		}
	})

	t.Run("missing MCP server is rejected", func(t *testing.T) {
		// The ValidateReferences pipeline step (which runs before
		// MergeMcpServerEnvSpecs) strictly rejects references to MCP servers
		// that do not exist, so Create fails with FAILED_PRECONDITION.
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Missing MCP Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent referencing non-existent MCP server",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "does-not-exist",
						},
					},
				},
			},
		}

		_, err := controller.Create(contextWithAgentKind(), agent)
		if err == nil {
			t.Fatal("Create should fail when referencing a non-existent MCP server")
		}
		if !strings.Contains(err.Error(), "does-not-exist") {
			t.Errorf("expected error to mention the missing MCP server slug, got: %v", err)
		}
	})

	t.Run("multiple MCP servers with overlapping env vars", func(t *testing.T) {
		mcpServerA := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_a",
				Name: "MCP Server A",
				Slug: "mcp-server-a",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "First MCP server",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"COMMON_KEY": {
						Description: "From server A",
						IsSecret:    true,
					},
					"A_ONLY": {
						Description: "Only in A",
						IsSecret:    false,
					},
				},
			},
		}
		mcpServerB := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_b",
				Name: "MCP Server B",
				Slug: "mcp-server-b",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Second MCP server",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"COMMON_KEY": {
						Description: "From server B",
						IsSecret:    false,
					},
					"B_ONLY": {
						Description: "Only in B",
						IsSecret:    true,
					},
				},
			},
		}

		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_a", mcpServerA); err != nil {
			t.Fatalf("failed to save MCP server A: %v", err)
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_b", mcpServerB); err != nil {
			t.Fatalf("failed to save MCP server B: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Multi MCP Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent with multiple MCP servers",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "mcp-server-a",
						},
					},
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "mcp-server-b",
						},
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if len(envDecls) != 3 {
			t.Fatalf("Expected 3 env vars (COMMON_KEY, A_ONLY, B_ONLY), got %d", len(envDecls))
		}

		if _, ok := envDecls["A_ONLY"]; !ok {
			t.Error("Expected A_ONLY from MCP server A")
		}
		if _, ok := envDecls["B_ONLY"]; !ok {
			t.Error("Expected B_ONLY from MCP server B")
		}
		if _, ok := envDecls["COMMON_KEY"]; !ok {
			t.Error("Expected COMMON_KEY (first-encountered wins)")
		}
	})

	t.Run("merges env when mcp_server_ref omits org", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_no-org-ref",
				Name: "No Org Ref MCP",
				Slug: "no-org-ref-mcp",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "MCP server for org fallback testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"FALLBACK_KEY": {
						Description: "Resolved via agent org fallback",
						IsSecret:    true,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_no-org-ref", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Org Fallback Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent with mcp_server_ref that omits org",
				Instructions: "You are a helpful agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: "no-org-ref-mcp",
						},
					},
				},
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		envDecls := created.GetSpec().GetEnv()
		if envDecls == nil {
			t.Fatal("Expected env to be populated via org fallback, got nil")
		}
		if len(envDecls) != 1 {
			t.Fatalf("Expected 1 env var, got %d", len(envDecls))
		}
		if fallbackKey, ok := envDecls["FALLBACK_KEY"]; !ok {
			t.Error("Expected FALLBACK_KEY in env")
		} else {
			if !fallbackKey.IsSecret {
				t.Error("Expected FALLBACK_KEY.is_secret to be true")
			}
		}
	})

	t.Run("update also merges MCP env declarations", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_update",
				Name: "Update MCP Server",
				Slug: "update-mcp",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "MCP server for update testing",
				Env: map[string]*environmentv1.EnvVarDeclaration{
					"UPDATE_KEY": {
						Description: "Key added during update",
						IsSecret:    true,
					},
				},
			},
		}
		if err := store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_update", mcpServer); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Update Merge Agent",
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Description:  "Agent for update merge testing",
				Instructions: "You are a helpful agent.",
			},
		}

		created, err := controller.Create(contextWithAgentKind(), agent)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		created.Spec.McpServerUsages = []*agentv1.McpServerUsage{
			{
				McpServerRef: &apiresource.ApiResourceReference{
					Org:  "test-org",
					Kind: apiresourcekind.ApiResourceKind_mcp_server,
					Slug: "update-mcp",
				},
			},
		}

		updated, err := controller.Update(contextWithAgentKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		envDecls := updated.GetSpec().GetEnv()
		if envDecls == nil {
			t.Fatal("Expected env to be populated after update, got nil")
		}
		if _, ok := envDecls["UPDATE_KEY"]; !ok {
			t.Error("Expected UPDATE_KEY to be merged from MCP server during update")
		}
	})
}
