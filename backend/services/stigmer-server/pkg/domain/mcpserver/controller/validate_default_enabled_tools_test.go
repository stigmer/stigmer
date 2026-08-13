package mcpserver

import (
	"context"
	"strings"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestMcpServerController_ValidateDefaultEnabledTools pins the mcpserver half
// of the issue #402 apply-time validation: default_enabled_tools must name
// discovered tools once the server has been connected. The check reads the
// resource's OWN stored capabilities (carried onto the update state by
// BuildUpdateState), so it fires only on update — a freshly created server
// has no capabilities and no basis for rejection.
func TestMcpServerController_ValidateDefaultEnabledTools(t *testing.T) {
	// connectServer simulates what the connect flow persists: discovered
	// capabilities written onto the stored resource's status.
	connectServer := func(t *testing.T, controller *McpServerController, id string) {
		t.Helper()
		stored := &mcpserverv1.McpServer{}
		if err := controller.store.GetResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, id, stored); err != nil {
			t.Fatalf("failed to load server for capability seeding: %v", err)
		}
		if stored.Status == nil {
			stored.Status = &mcpserverv1.McpServerStatus{}
		}
		stored.Status.DiscoveredCapabilities = &mcpserverv1.DiscoveredCapabilities{
			Tools: []*mcpserverv1.DiscoveredTool{
				{Name: "list_issues"},
				{Name: "create_issue"},
			},
			ResourceTemplates: []*mcpserverv1.DiscoveredResourceTemplate{
				{Name: "issue_detail", UriTemplate: "issues://{id}"},
			},
		}
		if err := controller.store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, id, stored); err != nil {
			t.Fatalf("failed to save server with capabilities: %v", err)
		}
	}

	t.Run("create with default_enabled_tools passes (no capabilities yet)", func(t *testing.T) {
		controller, _ := setupTestController(t)

		server := createTestMcpServer("Fresh Server")
		server.Spec.DefaultEnabledTools = []string{"whatever_the_manifest_says"}

		if _, err := controller.Create(contextWithMcpServerKind(), server); err != nil {
			t.Fatalf("Create must not validate default_enabled_tools (no capabilities can exist yet): %v", err)
		}
	})

	t.Run("update with unknown default tool is rejected with INVALID_ARGUMENT", func(t *testing.T) {
		controller, _ := setupTestController(t)

		created, err := controller.Create(contextWithMcpServerKind(), createTestMcpServer("Connected Server"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		connectServer(t, controller, created.Metadata.Id)

		created.Spec.DefaultEnabledTools = []string{"list_issues", "close_issue"}
		_, err = controller.Update(contextWithMcpServerKind(), created)
		if err == nil {
			t.Fatal("Update should reject a default_enabled_tools name the server does not expose")
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT, got %v (%v)", status.Code(err), err)
		}
		for _, want := range []string{"close_issue", "list_issues", "create_issue"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("expected error to contain %q, got: %v", want, err)
			}
		}
	})

	t.Run("update with resource template name gets the targeted error", func(t *testing.T) {
		controller, _ := setupTestController(t)

		created, err := controller.Create(contextWithMcpServerKind(), createTestMcpServer("Template Server"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		connectServer(t, controller, created.Metadata.Id)

		created.Spec.DefaultEnabledTools = []string{"issue_detail"}
		_, err = controller.Update(contextWithMcpServerKind(), created)
		if err == nil {
			t.Fatal("Update should reject a resource-template name in default_enabled_tools")
		}
		if !strings.Contains(err.Error(), "resource template") {
			t.Errorf("expected the targeted resource-template wording, got: %v", err)
		}
	})

	t.Run("update with valid default tools passes", func(t *testing.T) {
		controller, _ := setupTestController(t)

		created, err := controller.Create(contextWithMcpServerKind(), createTestMcpServer("Valid Server"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		connectServer(t, controller, created.Metadata.Id)

		created.Spec.DefaultEnabledTools = []string{"list_issues", "create_issue"}
		if _, err := controller.Update(contextWithMcpServerKind(), created); err != nil {
			t.Fatalf("Update with valid default_enabled_tools failed: %v", err)
		}
	})

	t.Run("update on a never-connected server is skipped", func(t *testing.T) {
		controller, _ := setupTestController(t)

		created, err := controller.Create(contextWithMcpServerKind(), createTestMcpServer("Unconnected Server"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		created.Spec.DefaultEnabledTools = []string{"anything_goes"}
		if _, err := controller.Update(contextWithMcpServerKind(), created); err != nil {
			t.Fatalf("Update should skip validation for a never-connected server, got: %v", err)
		}
	})
}
