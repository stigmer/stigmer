//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"google.golang.org/protobuf/types/known/structpb"
)

// This file is the shared backbone of the visibility enforcement suite. The
// four-level visibility model (private / org / public / platform) is enforced by
// kind-agnostic machinery — a shared reconciler driven by per-kind proto
// metadata writing OpenFGA tuples, and a uniform load+authorize pipeline. The
// suite therefore proves the *contract* once across all kinds rather than
// re-testing each handler, using a small abstraction (blueprintKind) and a fixed
// cast of principals (harness.Actors).

// requireVisibilityHarness gates a test on the full harness with a real OpenFGA
// backend. Visibility *enforcement* is meaningless without real FGA — the model
// is where the four-level logic lives — so these tests skip rather than pass
// vacuously when FGA is disabled.
func requireVisibilityHarness(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	require.NotNil(t, testHarness, "test harness must be initialized")
	require.NotNil(t, testHarness.Service, "Java service must be running")
	if !testHarness.FGAEnabled() {
		t.Skip("visibility enforcement requires real OpenFGA — skipping")
	}
}

// newVisibilityActors builds the canonical principals (owner / member / stranger)
// bound to the running service.
func newVisibilityActors(t *testing.T, ctx context.Context) *harness.Actors {
	t.Helper()
	return harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
}

// isAccessDenied reports whether err is a "you cannot reach this resource"
// signal. The load+authorize pipeline denies with PERMISSION_DENIED; some get
// paths return NOT_FOUND to avoid leaking existence across tenants. Either is a
// legitimate denial, so the coarse Get probe accepts both. Fine-grained truth is
// asserted separately via CheckMyPermission (an unambiguous boolean).
func isAccessDenied(err error) bool {
	st, ok := status.FromError(err)
	if !ok {
		return false
	}
	return st.Code() == codes.PermissionDenied || st.Code() == codes.NotFound
}

// requireStatusCode asserts that err carries the given gRPC status code.
func requireStatusCode(t *testing.T, err error, want codes.Code, msgAndArgs ...any) {
	t.Helper()
	require.Error(t, err, msgAndArgs...)
	st, ok := status.FromError(err)
	require.True(t, ok, "expected a gRPC status error, got %v", err)
	require.Equalf(t, want, st.Code(), "expected %s, got %s: %v", want, st.Code(), err)
}

// blueprintKind abstracts the four blueprint resource kinds
// (agent / skill / mcp_server / workflow) behind a uniform create / get /
// updateVisibility surface, so visibility enforcement is asserted identically
// across all of them. A single table then proves every kind honours the same
// contract — the right shape for kind-agnostic visibility logic.
type blueprintKind struct {
	// name is the FGA / search kind string ("agent", "skill", ...).
	name string
	// searchKind is the enum used in Search requests.
	searchKind apiresourcekind.ApiResourceKind
	// supportsExecute is true for kinds with a real can_execute relation
	// (agent, workflow); for these "run what you can read" is asserted.
	supportsExecute bool
	// create makes a blueprint as the caller behind clients and returns its id.
	// Blueprints default to visibility_org on create (defaults_to_org_visibility).
	create func(t *testing.T, ctx context.Context, c *harness.Clients) string
	// get loads the blueprint by id — the coarse pipeline-enforcement probe.
	get func(ctx context.Context, c *harness.Clients, id string) error
	// getVisibility reads the persisted visibility level (for create-default and
	// post-update persistence assertions).
	getVisibility func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error)
	// updateVisibility sets the blueprint's visibility level.
	updateVisibility func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error
	// defaultInstanceID returns the eagerly-created default instance id for kinds
	// that have one (agent, workflow); ok is false for kinds that do not.
	defaultInstanceID func(ctx context.Context, c *harness.Clients, id string) (instanceID string, ok bool, err error)
	// instanceKindName is the FGA/search kind of this blueprint's instances
	// ("agent_instance", "workflow_instance"); empty for kinds without instances.
	instanceKindName string
	// updateInstanceVisibility sets visibility on an instance of this kind — used
	// to assert that default instances reject visibility updates. Nil for kinds
	// without instances.
	updateInstanceVisibility func(ctx context.Context, c *harness.Clients, instanceID string, v apiresource.ApiResourceVisibility) error
}

// blueprintKinds returns the full blueprint cast under test.
func blueprintKinds() []blueprintKind {
	return []blueprintKind{
		{
			name:            "agent",
			searchKind:      apiresourcekind.ApiResourceKind_agent,
			supportsExecute: true,
			create: func(t *testing.T, ctx context.Context, c *harness.Clients) string {
				return createAgentBlueprint(t, ctx, c).GetMetadata().GetId()
			},
			get: func(ctx context.Context, c *harness.Clients, id string) error {
				_, err := c.AgentQuery.Get(ctx, &agentv1.AgentId{Value: id})
				return err
			},
			getVisibility: func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error) {
				agent, err := c.AgentQuery.Get(ctx, &agentv1.AgentId{Value: id})
				return agent.GetMetadata().GetVisibility(), err
			},
			updateVisibility: func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error {
				_, err := c.AgentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: id, Visibility: v})
				return err
			},
			defaultInstanceID: func(ctx context.Context, c *harness.Clients, id string) (string, bool, error) {
				agent, err := c.AgentQuery.Get(ctx, &agentv1.AgentId{Value: id})
				if err != nil {
					return "", false, err
				}
				instID := agent.GetStatus().GetDefaultInstanceId()
				return instID, instID != "", nil
			},
			instanceKindName: "agent_instance",
			updateInstanceVisibility: func(ctx context.Context, c *harness.Clients, instanceID string, v apiresource.ApiResourceVisibility) error {
				_, err := c.AgentInstanceCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: instanceID, Visibility: v})
				return err
			},
		},
		{
			name:            "skill",
			searchKind:      apiresourcekind.ApiResourceKind_skill,
			supportsExecute: false,
			create: func(t *testing.T, ctx context.Context, c *harness.Clients) string {
				return createSkillBlueprint(t, ctx, c).GetMetadata().GetId()
			},
			get: func(ctx context.Context, c *harness.Clients, id string) error {
				_, err := c.SkillQuery.Get(ctx, &skillv1.SkillId{Value: id})
				return err
			},
			getVisibility: func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error) {
				skill, err := c.SkillQuery.Get(ctx, &skillv1.SkillId{Value: id})
				return skill.GetMetadata().GetVisibility(), err
			},
			updateVisibility: func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error {
				_, err := c.SkillCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: id, Visibility: v})
				return err
			},
		},
		{
			name:            "mcp_server",
			searchKind:      apiresourcekind.ApiResourceKind_mcp_server,
			supportsExecute: false,
			create: func(t *testing.T, ctx context.Context, c *harness.Clients) string {
				return createMcpServerBlueprint(t, ctx, c).GetMetadata().GetId()
			},
			get: func(ctx context.Context, c *harness.Clients, id string) error {
				_, err := c.McpServerQuery.Get(ctx, &apiresource.ApiResourceId{Value: id})
				return err
			},
			getVisibility: func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error) {
				server, err := c.McpServerQuery.Get(ctx, &apiresource.ApiResourceId{Value: id})
				return server.GetMetadata().GetVisibility(), err
			},
			updateVisibility: func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error {
				_, err := c.McpServerCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: id, Visibility: v})
				return err
			},
		},
		{
			name:            "workflow",
			searchKind:      apiresourcekind.ApiResourceKind_workflow,
			supportsExecute: true,
			create: func(t *testing.T, ctx context.Context, c *harness.Clients) string {
				return createWorkflowBlueprint(t, ctx, c).GetMetadata().GetId()
			},
			get: func(ctx context.Context, c *harness.Clients, id string) error {
				_, err := c.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: id})
				return err
			},
			getVisibility: func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error) {
				wf, err := c.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: id})
				return wf.GetMetadata().GetVisibility(), err
			},
			updateVisibility: func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error {
				_, err := c.WorkflowCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: id, Visibility: v})
				return err
			},
			defaultInstanceID: func(ctx context.Context, c *harness.Clients, id string) (string, bool, error) {
				wf, err := c.WorkflowQuery.Get(ctx, &workflowv1.WorkflowId{Value: id})
				if err != nil {
					return "", false, err
				}
				instID := wf.GetStatus().GetDefaultInstanceId()
				return instID, instID != "", nil
			},
			instanceKindName: "workflow_instance",
			updateInstanceVisibility: func(ctx context.Context, c *harness.Clients, instanceID string, v apiresource.ApiResourceVisibility) error {
				_, err := c.InstanceCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: instanceID, Visibility: v})
				return err
			},
		},
	}
}

// ── Resource factories (consolidated) ───────────────────────────────────────
// All visibility resources are created in harness.TestOrg by the caller behind
// the supplied clients. Names carry a uuid suffix so repeated runs never collide
// on slug.

func uniqueVisibilityName(prefix string) string {
	return fmt.Sprintf("%s-%s", prefix, uuid.New().String()[:8])
}

func createAgentBlueprint(t *testing.T, ctx context.Context, c *harness.Clients) *agentv1.Agent {
	t.Helper()
	agent, err := c.AgentCommand.Create(ctx, &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: uniqueVisibilityName("vis-agent"),
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Visibility test agent",
			Instructions: "You are a visibility test agent.",
		},
	})
	require.NoError(t, err, "create agent blueprint")
	return agent
}

func createWorkflowBlueprint(t *testing.T, ctx context.Context, c *harness.Clients) *workflowv1.Workflow {
	t.Helper()
	name := uniqueVisibilityName("vis-wf")
	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{"ok": "true"},
	})
	require.NoError(t, err, "build workflow task config")

	wf, err := c.WorkflowCommand.Create(ctx, &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Visibility test workflow",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "noop",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
				},
			},
		},
	})
	require.NoError(t, err, "create workflow blueprint")
	return wf
}

func createMcpServerBlueprint(t *testing.T, ctx context.Context, c *harness.Clients) *mcpserverv1.McpServer {
	t.Helper()
	server, err := c.McpServerCommand.Create(ctx, &mcpserverv1.McpServer{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: uniqueVisibilityName("vis-mcp"),
			Org:  harness.TestOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Visibility test MCP server",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "echo",
					Args:    []string{"visibility-test"},
				},
			},
		},
	})
	require.NoError(t, err, "create mcp_server blueprint")
	return server
}

// createSkillBlueprint creates a skill via push (skills have no Create RPC — they
// are artifact-backed and uploaded through PushSkill, here backed by the MinIO
// testcontainer). Reuses createTestSkill from agent_execution_helpers_test.go.
func createSkillBlueprint(t *testing.T, ctx context.Context, c *harness.Clients) *skillv1.Skill {
	t.Helper()
	name := uniqueVisibilityName("vis-skill")
	return createTestSkill(t, ctx, c, name, "# Visibility Test Skill\nA skill used to test visibility enforcement.\n")
}

func createWorkflowInstanceFor(t *testing.T, ctx context.Context, c *harness.Clients, workflowID string) *workflowinstancev1.WorkflowInstance {
	t.Helper()
	inst, err := c.InstanceCommand.Create(ctx, &workflowinstancev1.WorkflowInstance{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "WorkflowInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: uniqueVisibilityName("vis-wf-inst"),
			Org:  harness.TestOrg,
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId: workflowID,
		},
	})
	require.NoError(t, err, "create workflow instance")
	return inst
}

func createAgentInstanceFor(t *testing.T, ctx context.Context, c *harness.Clients, agentID string) *agentinstancev1.AgentInstance {
	t.Helper()
	inst, err := c.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "AgentInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: uniqueVisibilityName("vis-agent-inst"),
			Org:  harness.TestOrg,
		},
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId: agentID,
		},
	})
	require.NoError(t, err, "create agent instance")
	return inst
}
