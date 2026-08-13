package agent

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestAgentController_ValidateEnabledTools pins the apply-time half of the
// issue #350/#402 enforcement pair: the runner warns-and-intersects unknown
// enabled_tools at execution time, and the server rejects them at
// create/update/apply time IF the referenced server has discovered
// capabilities. Servers never connected are deliberately skipped — the
// runner's leniency remains the safety net for that window.
func TestAgentController_ValidateEnabledTools(t *testing.T) {
	// saveConnectedServer persists an MCP server whose status carries
	// discovered capabilities, as the connect flow would have left it.
	saveConnectedServer := func(t *testing.T, s store.Store, id, slug string) {
		t.Helper()
		server := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   id,
				Name: slug,
				Slug: slug,
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{Description: "Connected server"},
			Status: &mcpserverv1.McpServerStatus{
				DiscoveredCapabilities: &mcpserverv1.DiscoveredCapabilities{
					Tools: []*mcpserverv1.DiscoveredTool{
						{Name: "search_code"},
						{Name: "create_pr"},
					},
					ResourceTemplates: []*mcpserverv1.DiscoveredResourceTemplate{
						{Name: "repo_readme", UriTemplate: "repo://{owner}/{repo}/readme"},
					},
				},
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, id, server); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}
	}

	newAgentUsing := func(name, serverSlug string, enabledTools ...string) *agentv1.Agent {
		return &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name,
				Org:  "test-org",
			},
			Spec: &agentv1.AgentSpec{
				Instructions: "You are an enabled-tools validation test agent.",
				McpServerUsages: []*agentv1.McpServerUsage{
					{
						McpServerRef: &apiresource.ApiResourceReference{
							Org:  "test-org",
							Kind: apiresourcekind.ApiResourceKind_mcp_server,
							Slug: serverSlug,
						},
						EnabledTools: enabledTools,
					},
				},
			},
		}
	}

	newStore := func(t *testing.T) store.Store {
		t.Helper()
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		t.Cleanup(func() { s.Close() })
		return s
	}

	t.Run("unknown tool name is rejected with INVALID_ARGUMENT", func(t *testing.T) {
		s := newStore(t)
		controller := NewAgentController(s, nil)
		saveConnectedServer(t, s, "mcp_vet1", "vet-server")

		_, err := controller.Create(contextWithAgentKind(), newAgentUsing("Typo Agent", "vet-server", "creat_pr"))
		if err == nil {
			t.Fatal("Create should reject an enabled_tools name the server does not expose")
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT, got %v (%v)", status.Code(err), err)
		}
		// The error must name the bad entry AND list what is valid — the fix
		// should be one edit away for the operator.
		for _, want := range []string{"creat_pr", "search_code", "create_pr", "vet-server"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("expected error to contain %q, got: %v", want, err)
			}
		}
	})

	t.Run("resource template name gets the targeted error", func(t *testing.T) {
		s := newStore(t)
		controller := NewAgentController(s, nil)
		saveConnectedServer(t, s, "mcp_vet2", "vet-server")

		_, err := controller.Create(contextWithAgentKind(), newAgentUsing("Template Agent", "vet-server", "repo_readme"))
		if err == nil {
			t.Fatal("Create should reject a resource-template name in enabled_tools")
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT, got %v", status.Code(err))
		}
		if !strings.Contains(err.Error(), "resource template") {
			t.Errorf("expected the targeted resource-template wording, got: %v", err)
		}
	})

	t.Run("valid tool names pass", func(t *testing.T) {
		s := newStore(t)
		controller := NewAgentController(s, nil)
		saveConnectedServer(t, s, "mcp_vet3", "vet-server")

		if _, err := controller.Create(contextWithAgentKind(), newAgentUsing("Valid Agent", "vet-server", "search_code", "create_pr")); err != nil {
			t.Fatalf("Create with valid enabled_tools failed: %v", err)
		}
	})

	t.Run("server without discovered capabilities is skipped", func(t *testing.T) {
		s := newStore(t)
		controller := NewAgentController(s, nil)

		// A server that exists but was never connected — no status at all.
		// Any enabled_tools list must pass: there is nothing authoritative
		// to validate against, and the runner's warn-and-intersect covers it.
		unconnected := &mcpserverv1.McpServer{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "McpServer",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   "mcp_vet4",
				Name: "unconnected-server",
				Slug: "unconnected-server",
				Org:  "test-org",
			},
			Spec: &mcpserverv1.McpServerSpec{Description: "Never connected"},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_mcp_server, "mcp_vet4", unconnected); err != nil {
			t.Fatalf("failed to save MCP server: %v", err)
		}

		if _, err := controller.Create(contextWithAgentKind(), newAgentUsing("Lenient Agent", "unconnected-server", "anything_goes")); err != nil {
			t.Fatalf("Create should skip validation for an unconnected server, got: %v", err)
		}
	})

	t.Run("update path enforces too", func(t *testing.T) {
		s := newStore(t)
		controller := NewAgentController(s, nil)
		saveConnectedServer(t, s, "mcp_vet5", "vet-server")

		created, err := controller.Create(contextWithAgentKind(), newAgentUsing("Update Agent", "vet-server", "search_code"))
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}

		created.Spec.McpServerUsages[0].EnabledTools = []string{"search_code", "not_a_tool"}
		_, err = controller.Update(contextWithAgentKind(), created)
		if err == nil {
			t.Fatal("Update should reject an enabled_tools name the server does not expose")
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT, got %v", status.Code(err))
		}
	})

	t.Run("apply path enforces via delegation", func(t *testing.T) {
		s := newStore(t)
		controller := NewAgentController(s, nil)
		saveConnectedServer(t, s, "mcp_vet6", "vet-server")

		// Apply of a new agent delegates to Create — the step must fire there.
		_, err := controller.Apply(contextWithAgentKind(), newAgentUsing("Apply Agent", "vet-server", "no_such_tool"))
		if err == nil {
			t.Fatal("Apply should reject an enabled_tools name the server does not expose")
		}
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT, got %v", status.Code(err))
		}
	})
}
