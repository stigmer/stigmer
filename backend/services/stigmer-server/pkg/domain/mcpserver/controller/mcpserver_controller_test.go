package mcpserver

import (
	"context"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// contextWithMcpServerKind creates a context with the mcp_server resource kind injected.
// This simulates what the apiresource interceptor does in production.
func contextWithMcpServerKind() context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_mcp_server)
}

// setupTestController creates a test controller with necessary dependencies.
func setupTestController(t *testing.T) (*McpServerController, store.Store) {
	// Create temporary SQLite store
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}

	controller := NewMcpServerController(store)

	return controller, store
}

// createTestMcpServer creates a valid McpServer proto for testing with stdio config.
func createTestMcpServer(name string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name,
			OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Test MCP server for unit tests",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "npx",
					Args:    []string{"-y", "@modelcontextprotocol/server-test"},
				},
			},
		},
	}
}

// createTestMcpServerWithHttp creates a valid McpServer proto with HTTP config.
func createTestMcpServerWithHttp(name string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name,
			OwnerScope: apiresource.ApiResourceOwnerScope_organization,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "HTTP-based MCP server",
			ServerType: &mcpserverv1.McpServerSpec_Http{
				Http: &mcpserverv1.HttpServerConfig{
					Url:            "https://mcp.example.com/v1",
					TimeoutSeconds: 30,
					Headers: map[string]string{
						"Authorization": "Bearer ${API_TOKEN}",
					},
				},
			},
		},
	}
}

// createTestMcpServerWithDocker creates a valid McpServer proto with Docker config.
func createTestMcpServerWithDocker(name string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       name,
			OwnerScope: apiresource.ApiResourceOwnerScope_organization,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Docker-based MCP server",
			ServerType: &mcpserverv1.McpServerSpec_Docker{
				Docker: &mcpserverv1.DockerServerConfig{
					Image: "ghcr.io/example/mcp-server:latest",
					Args:  []string{"--verbose"},
					Volumes: []*mcpserverv1.VolumeMount{
						{
							HostPath:      "/data",
							ContainerPath: "/app/data",
							ReadOnly:      false,
						},
					},
					Ports: []*mcpserverv1.PortMapping{
						{
							HostPort:      8080,
							ContainerPort: 80,
							Protocol:      "tcp",
						},
					},
				},
			},
		},
	}
}

func TestMcpServerController_Create(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful creation with stdio config", func(t *testing.T) {
		mcpServer := createTestMcpServer("GitHub MCP Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Verify defaults set by pipeline
		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug == "" {
			t.Error("Expected slug to be set")
		}

		if created.Metadata.Slug != "github-mcp-server" {
			t.Errorf("Expected slug 'github-mcp-server', got '%s'", created.Metadata.Slug)
		}

		if created.Kind != "McpServer" {
			t.Errorf("Expected kind 'McpServer', got '%s'", created.Kind)
		}

		if created.ApiVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("Expected api_version 'agentic.stigmer.ai/v1', got '%s'", created.ApiVersion)
		}

		// Verify description is preserved
		if created.Spec.Description != "Test MCP server for unit tests" {
			t.Errorf("Expected description 'Test MCP server for unit tests', got '%s'", created.Spec.Description)
		}

		// Verify stdio config is preserved
		stdioConfig := created.Spec.GetStdio()
		if stdioConfig == nil {
			t.Error("Expected stdio config to be set")
		}

		if stdioConfig.Command != "npx" {
			t.Errorf("Expected command 'npx', got '%s'", stdioConfig.Command)
		}

		if len(stdioConfig.Args) != 2 {
			t.Errorf("Expected 2 args, got %d", len(stdioConfig.Args))
		}
	})

	t.Run("successful creation with http config", func(t *testing.T) {
		mcpServer := createTestMcpServerWithHttp("HTTP MCP Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug != "http-mcp-server" {
			t.Errorf("Expected slug 'http-mcp-server', got '%s'", created.Metadata.Slug)
		}

		// Verify http config is preserved
		httpConfig := created.Spec.GetHttp()
		if httpConfig == nil {
			t.Error("Expected http config to be set")
		}

		if httpConfig.Url != "https://mcp.example.com/v1" {
			t.Errorf("Expected URL 'https://mcp.example.com/v1', got '%s'", httpConfig.Url)
		}

		if httpConfig.TimeoutSeconds != 30 {
			t.Errorf("Expected timeout 30, got %d", httpConfig.TimeoutSeconds)
		}

		if httpConfig.Headers["Authorization"] != "Bearer ${API_TOKEN}" {
			t.Errorf("Expected Authorization header 'Bearer ${API_TOKEN}', got '%s'", httpConfig.Headers["Authorization"])
		}
	})

	t.Run("successful creation with docker config", func(t *testing.T) {
		mcpServer := createTestMcpServerWithDocker("Docker MCP Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		if created.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if created.Metadata.Slug != "docker-mcp-server" {
			t.Errorf("Expected slug 'docker-mcp-server', got '%s'", created.Metadata.Slug)
		}

		// Verify docker config is preserved
		dockerConfig := created.Spec.GetDocker()
		if dockerConfig == nil {
			t.Error("Expected docker config to be set")
		}

		if dockerConfig.Image != "ghcr.io/example/mcp-server:latest" {
			t.Errorf("Expected image 'ghcr.io/example/mcp-server:latest', got '%s'", dockerConfig.Image)
		}

		if len(dockerConfig.Volumes) != 1 {
			t.Errorf("Expected 1 volume mount, got %d", len(dockerConfig.Volumes))
		}

		if len(dockerConfig.Ports) != 1 {
			t.Errorf("Expected 1 port mapping, got %d", len(dockerConfig.Ports))
		}

		if dockerConfig.Ports[0].HostPort != 8080 {
			t.Errorf("Expected host port 8080, got %d", dockerConfig.Ports[0].HostPort)
		}
	})

	t.Run("validation error - missing metadata", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test description",
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "npx",
					},
				},
			},
		}

		_, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err == nil {
			t.Error("Expected error for missing metadata")
		}
	})

	t.Run("validation error - missing name", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata:   &apiresource.ApiResourceMetadata{},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test description",
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "npx",
					},
				},
			},
		}

		_, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err == nil {
			t.Error("Expected error for missing name")
		}
	})

	t.Run("validation error - missing server type", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Server",
				OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test description",
				// No server_type set - this should fail validation
			},
		}

		_, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err == nil {
			t.Error("Expected error for missing server type (stdio/http/docker)")
		}
	})

	t.Run("validation error - stdio missing command", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Stdio Server",
				OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test description",
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "", // Empty command - should fail
					},
				},
			},
		}

		_, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err == nil {
			t.Error("Expected error for empty stdio command")
		}
	})

	t.Run("validation error - docker missing image", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "Invalid Docker Server",
				OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test description",
				ServerType: &mcpserverv1.McpServerSpec_Docker{
					Docker: &mcpserverv1.DockerServerConfig{
						Image: "", // Empty image - should fail
					},
				},
			},
		}

		_, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err == nil {
			t.Error("Expected error for empty docker image")
		}
	})

	t.Run("duplicate detection", func(t *testing.T) {
		// Create first MCP server
		mcpServer := createTestMcpServer("Duplicate Test Server")
		_, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("First Create failed: %v", err)
		}

		// Try to create duplicate
		duplicate := createTestMcpServer("Duplicate Test Server")
		_, err = controller.Create(contextWithMcpServerKind(), duplicate)
		if err == nil {
			t.Error("Expected error for duplicate MCP server")
		}
	})
}

func TestMcpServerController_Get(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get", func(t *testing.T) {
		// Create MCP server first
		mcpServer := createTestMcpServer("Get Test Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get the MCP server
		retrieved, err := controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Spec.Description != "Test MCP server for unit tests" {
			t.Errorf("Expected description 'Test MCP server for unit tests', got '%s'", retrieved.Spec.Description)
		}

		// Verify stdio config is preserved
		stdioConfig := retrieved.Spec.GetStdio()
		if stdioConfig == nil {
			t.Error("Expected stdio config to be set")
		}

		if stdioConfig.Command != "npx" {
			t.Errorf("Expected command 'npx', got '%s'", stdioConfig.Command)
		}
	})

	t.Run("get non-existent MCP server", func(t *testing.T) {
		_, err := controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: "non-existent-id"})
		if err == nil {
			t.Error("Expected error when getting non-existent MCP server")
		}
	})

	t.Run("get with empty ID", func(t *testing.T) {
		_, err := controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: ""})
		if err == nil {
			t.Error("Expected error when getting with empty ID")
		}
	})
}

func TestMcpServerController_GetByReference(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful get by reference", func(t *testing.T) {
		// Create MCP server first
		mcpServer := createTestMcpServer("Reference Test Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Get by reference (slug)
		ref := &apiresource.ApiResourceReference{
			Slug: created.Metadata.Slug,
			Kind: apiresourcekind.ApiResourceKind_mcp_server,
		}

		retrieved, err := controller.GetByReference(contextWithMcpServerKind(), ref)
		if err != nil {
			t.Fatalf("GetByReference failed: %v", err)
		}

		if retrieved.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID '%s', got '%s'", created.Metadata.Id, retrieved.Metadata.Id)
		}

		if retrieved.Metadata.Slug != "reference-test-server" {
			t.Errorf("Expected slug 'reference-test-server', got '%s'", retrieved.Metadata.Slug)
		}
	})

	t.Run("get non-existent by reference", func(t *testing.T) {
		ref := &apiresource.ApiResourceReference{
			Slug: "non-existent-slug",
			Kind: apiresourcekind.ApiResourceKind_mcp_server,
		}

		_, err := controller.GetByReference(contextWithMcpServerKind(), ref)
		if err == nil {
			t.Error("Expected error when getting non-existent MCP server by reference")
		}
	})

	t.Run("get with empty slug", func(t *testing.T) {
		ref := &apiresource.ApiResourceReference{
			Slug: "",
			Kind: apiresourcekind.ApiResourceKind_mcp_server,
		}

		_, err := controller.GetByReference(contextWithMcpServerKind(), ref)
		if err == nil {
			t.Error("Expected error when getting with empty slug")
		}
	})
}

func TestMcpServerController_Update(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful update - description", func(t *testing.T) {
		// Create MCP server first
		mcpServer := createTestMcpServer("Update Test Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update the description
		created.Spec.Description = "Updated description"
		updated, err := controller.Update(contextWithMcpServerKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if updated.Spec.Description != "Updated description" {
			t.Errorf("Expected description 'Updated description', got '%s'", updated.Spec.Description)
		}

		// Verify ID and slug remain unchanged
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected ID to remain '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		if updated.Metadata.Slug != created.Metadata.Slug {
			t.Errorf("Expected slug to remain '%s', got '%s'", created.Metadata.Slug, updated.Metadata.Slug)
		}
	})

	t.Run("successful update - change server config", func(t *testing.T) {
		// Create MCP server with stdio
		mcpServer := createTestMcpServer("Config Change Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Update to different command
		created.Spec.GetStdio().Command = "python"
		created.Spec.GetStdio().Args = []string{"-m", "mcp_server"}

		updated, err := controller.Update(contextWithMcpServerKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		stdioConfig := updated.Spec.GetStdio()
		if stdioConfig.Command != "python" {
			t.Errorf("Expected command 'python', got '%s'", stdioConfig.Command)
		}

		if len(stdioConfig.Args) != 2 || stdioConfig.Args[0] != "-m" {
			t.Errorf("Expected args ['-m', 'mcp_server'], got %v", stdioConfig.Args)
		}
	})

	t.Run("successful update - add default enabled tools", func(t *testing.T) {
		// Create MCP server
		mcpServer := createTestMcpServer("Tools Update Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Add default enabled tools
		created.Spec.DefaultEnabledTools = []string{"search_code", "create_pull_request"}

		updated, err := controller.Update(contextWithMcpServerKind(), created)
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}

		if len(updated.Spec.DefaultEnabledTools) != 2 {
			t.Errorf("Expected 2 default enabled tools, got %d", len(updated.Spec.DefaultEnabledTools))
		}

		if updated.Spec.DefaultEnabledTools[0] != "search_code" {
			t.Errorf("Expected first tool 'search_code', got '%s'", updated.Spec.DefaultEnabledTools[0])
		}
	})

	t.Run("update non-existent MCP server", func(t *testing.T) {
		mcpServer := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         "non-existent-id",
				Name:       "Non-existent Server",
				OwnerScope: apiresource.ApiResourceOwnerScope_identity_account,
			},
			Spec: &mcpserverv1.McpServerSpec{
				Description: "Test description",
				ServerType: &mcpserverv1.McpServerSpec_Stdio{
					Stdio: &mcpserverv1.StdioServerConfig{
						Command: "npx",
					},
				},
			},
		}

		_, err := controller.Update(contextWithMcpServerKind(), mcpServer)
		if err == nil {
			t.Error("Expected error for updating non-existent MCP server")
		}
	})
}

func TestMcpServerController_Delete(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("successful deletion", func(t *testing.T) {
		// Create MCP server first
		mcpServer := createTestMcpServer("Delete Test Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete the MCP server
		deleted, err := controller.Delete(contextWithMcpServerKind(), &apiresource.ApiResourceDeleteInput{ResourceId: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		if deleted.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected deleted MCP server ID '%s', got '%s'", created.Metadata.Id, deleted.Metadata.Id)
		}

		// Verify MCP server is deleted
		_, err = controller.Get(contextWithMcpServerKind(), &apiresource.ApiResourceId{Value: created.Metadata.Id})
		if err == nil {
			t.Error("Expected error when getting deleted MCP server")
		}
	})

	t.Run("delete non-existent MCP server", func(t *testing.T) {
		_, err := controller.Delete(contextWithMcpServerKind(), &apiresource.ApiResourceDeleteInput{ResourceId: "non-existent-id"})
		if err == nil {
			t.Error("Expected error for deleting non-existent MCP server")
		}
	})

	t.Run("delete with empty ID", func(t *testing.T) {
		_, err := controller.Delete(contextWithMcpServerKind(), &apiresource.ApiResourceDeleteInput{ResourceId: ""})
		if err == nil {
			t.Error("Expected error when deleting with empty ID")
		}
	})

	t.Run("verify deleted MCP server returns correct data", func(t *testing.T) {
		// Create MCP server with specific config
		mcpServer := createTestMcpServerWithHttp("Delete Verify Server")

		created, err := controller.Create(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		// Delete and verify returned data
		deleted, err := controller.Delete(contextWithMcpServerKind(), &apiresource.ApiResourceDeleteInput{ResourceId: created.Metadata.Id})
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify all fields are preserved in deleted response
		if deleted.Spec.Description != "HTTP-based MCP server" {
			t.Errorf("Expected description 'HTTP-based MCP server', got '%s'", deleted.Spec.Description)
		}

		if deleted.Metadata.Name != "Delete Verify Server" {
			t.Errorf("Expected name 'Delete Verify Server', got '%s'", deleted.Metadata.Name)
		}

		httpConfig := deleted.Spec.GetHttp()
		if httpConfig == nil {
			t.Error("Expected http config to be preserved")
		}

		if httpConfig.Url != "https://mcp.example.com/v1" {
			t.Errorf("Expected URL 'https://mcp.example.com/v1', got '%s'", httpConfig.Url)
		}
	})
}

func TestMcpServerController_Apply(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	t.Run("apply creates new MCP server", func(t *testing.T) {
		mcpServer := createTestMcpServer("Apply New Server")

		applied, err := controller.Apply(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("Apply failed: %v", err)
		}

		if applied.Metadata.Id == "" {
			t.Error("Expected ID to be set")
		}

		if applied.Metadata.Slug != "apply-new-server" {
			t.Errorf("Expected slug 'apply-new-server', got '%s'", applied.Metadata.Slug)
		}
	})

	t.Run("apply updates existing MCP server", func(t *testing.T) {
		// First apply creates the resource
		mcpServer := createTestMcpServer("Apply Update Server")
		created, err := controller.Apply(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("First Apply failed: %v", err)
		}

		// Second apply updates the resource
		created.Spec.Description = "Updated via apply"
		updated, err := controller.Apply(contextWithMcpServerKind(), created)
		if err != nil {
			t.Fatalf("Second Apply failed: %v", err)
		}

		// Verify it's the same resource (same ID)
		if updated.Metadata.Id != created.Metadata.Id {
			t.Errorf("Expected same ID '%s', got '%s'", created.Metadata.Id, updated.Metadata.Id)
		}

		// Verify description was updated
		if updated.Spec.Description != "Updated via apply" {
			t.Errorf("Expected description 'Updated via apply', got '%s'", updated.Spec.Description)
		}
	})

	t.Run("apply is idempotent", func(t *testing.T) {
		mcpServer := createTestMcpServer("Idempotent Server")

		// Apply multiple times
		first, err := controller.Apply(contextWithMcpServerKind(), mcpServer)
		if err != nil {
			t.Fatalf("First Apply failed: %v", err)
		}

		second, err := controller.Apply(contextWithMcpServerKind(), first)
		if err != nil {
			t.Fatalf("Second Apply failed: %v", err)
		}

		third, err := controller.Apply(contextWithMcpServerKind(), second)
		if err != nil {
			t.Fatalf("Third Apply failed: %v", err)
		}

		// All should have the same ID
		if first.Metadata.Id != second.Metadata.Id || second.Metadata.Id != third.Metadata.Id {
			t.Error("Expected all applies to return the same resource ID")
		}
	})
}
