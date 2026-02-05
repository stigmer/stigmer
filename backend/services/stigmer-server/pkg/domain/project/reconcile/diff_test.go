package reconcile

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// =============================================================================
// Test Fixtures
// =============================================================================

func createDiffTestAgent(slug, description string) *agentv1.Agent {
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  description,
			Instructions: "Test instructions for " + slug,
		},
	}
}

func createDiffTestAgentWithID(slug, description, id string) *agentv1.Agent {
	agent := createDiffTestAgent(slug, description)
	agent.Metadata.Id = id
	return agent
}

func createDiffTestWorkflow(slug, description string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: description,
		},
	}
}

func createDiffTestWorkflowWithID(slug, description, id string) *workflowv1.Workflow {
	workflow := createDiffTestWorkflow(slug, description)
	workflow.Metadata.Id = id
	return workflow
}

func createDiffTestMcpServer(slug, description string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: description,
		},
	}
}

func createDiffTestMcpServerWithID(slug, description, id string) *mcpserverv1.McpServer {
	mcp := createDiffTestMcpServer(slug, description)
	mcp.Metadata.Id = id
	return mcp
}

func createDiffTestSkill(slug, description string) *skillv1.Skill {
	return &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &skillv1.SkillSpec{
			Description: description,
		},
	}
}

func createDiffTestSkillWithID(slug, description, id string) *skillv1.Skill {
	skill := createDiffTestSkill(slug, description)
	skill.Metadata.Id = id
	return skill
}

// =============================================================================
// Basic Functionality Tests
// =============================================================================

func TestComputeDiff_NilDesired(t *testing.T) {
	actual := NewActualState(
		map[string]*agentv1.Agent{"agent1": createDiffTestAgent("agent1", "desc")},
		nil, nil, nil,
	)

	plan := ComputeDiff(nil, actual, nil)

	if plan.CreateCount() != 0 {
		t.Errorf("expected 0 creates, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 0 {
		t.Errorf("expected 0 updates, got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete (orphan), got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_NilActual(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{"agent1": createDiffTestAgent("agent1", "desc")},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, nil, nil)

	if plan.CreateCount() != 1 {
		t.Errorf("expected 1 create, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 0 {
		t.Errorf("expected 0 updates, got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 0 {
		t.Errorf("expected 0 deletes, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_BothNil(t *testing.T) {
	plan := ComputeDiff(nil, nil, nil)

	if !plan.IsEmpty() {
		t.Error("expected empty plan for nil states")
	}
}

func TestComputeDiff_BothEmpty(t *testing.T) {
	plan := ComputeDiff(EmptyDesiredState(), EmptyActualState(), nil)

	if !plan.IsEmpty() {
		t.Error("expected empty plan for empty states")
	}
	if plan != EmptyPlan() {
		t.Error("expected singleton EmptyPlan for both empty")
	}
}

func TestComputeDiff_IdenticalStates(t *testing.T) {
	agent := createDiffTestAgent("my-agent", "description")

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": agent},
		nil, nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{"my-agent": agent},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if !plan.IsEmpty() {
		t.Errorf("expected empty plan for identical states, got %d changes", plan.TotalChanges())
	}
}

// =============================================================================
// Create Tests
// =============================================================================

func TestComputeDiff_CreateSingleAgent(t *testing.T) {
	agent := createDiffTestAgent("new-agent", "A new agent")

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"new-agent": agent},
		nil, nil, nil,
	)
	actual := EmptyActualState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Fatalf("expected 1 create, got %d", plan.CreateCount())
	}

	create := plan.Creates()[0]
	if create.Key().String() != "agent:new-agent" {
		t.Errorf("expected key agent:new-agent, got %s", create.Key())
	}
	if !create.IsCreate() {
		t.Error("expected IsCreate() to be true")
	}
}

func TestComputeDiff_CreateSingleWorkflow(t *testing.T) {
	workflow := createDiffTestWorkflow("new-workflow", "A new workflow")

	desired := NewDesiredState(
		nil,
		map[string]*workflowv1.Workflow{"new-workflow": workflow},
		nil, nil,
	)
	actual := EmptyActualState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Fatalf("expected 1 create, got %d", plan.CreateCount())
	}

	create := plan.Creates()[0]
	if create.Key().Kind() != apiresourcekind.ApiResourceKind_workflow {
		t.Errorf("expected workflow kind, got %v", create.Key().Kind())
	}
}

func TestComputeDiff_CreateSingleMcpServer(t *testing.T) {
	mcp := createDiffTestMcpServer("new-mcp", "A new MCP server")

	desired := NewDesiredState(
		nil, nil,
		map[string]*mcpserverv1.McpServer{"new-mcp": mcp},
		nil,
	)
	actual := EmptyActualState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Fatalf("expected 1 create, got %d", plan.CreateCount())
	}

	create := plan.Creates()[0]
	if create.Key().Kind() != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("expected mcp_server kind, got %v", create.Key().Kind())
	}
}

func TestComputeDiff_CreateSingleSkill(t *testing.T) {
	skill := createDiffTestSkill("new-skill", "A new skill")

	desired := NewDesiredState(
		nil, nil, nil,
		map[string]*skillv1.Skill{"new-skill": skill},
	)
	actual := EmptyActualState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Fatalf("expected 1 create, got %d", plan.CreateCount())
	}

	create := plan.Creates()[0]
	if create.Key().Kind() != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("expected skill kind, got %v", create.Key().Kind())
	}
}

func TestComputeDiff_CreateMultipleResources(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"agent1": createDiffTestAgent("agent1", "desc1"),
			"agent2": createDiffTestAgent("agent2", "desc2"),
		},
		map[string]*workflowv1.Workflow{
			"workflow1": createDiffTestWorkflow("workflow1", "desc1"),
		},
		nil, nil,
	)
	actual := EmptyActualState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 3 {
		t.Errorf("expected 3 creates, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 0 {
		t.Errorf("expected 0 updates, got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 0 {
		t.Errorf("expected 0 deletes, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_CreateAllResourceTypes(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{"agent1": createDiffTestAgent("agent1", "desc")},
		map[string]*workflowv1.Workflow{"workflow1": createDiffTestWorkflow("workflow1", "desc")},
		map[string]*mcpserverv1.McpServer{"mcp1": createDiffTestMcpServer("mcp1", "desc")},
		map[string]*skillv1.Skill{"skill1": createDiffTestSkill("skill1", "desc")},
	)
	actual := EmptyActualState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 4 {
		t.Errorf("expected 4 creates, got %d", plan.CreateCount())
	}
}

// =============================================================================
// Update Tests
// =============================================================================

func TestComputeDiff_UpdateAgentSpec(t *testing.T) {
	desiredAgent := createDiffTestAgent("my-agent", "New description")
	actualAgent := createDiffTestAgentWithID("my-agent", "Old description", "agt_123")

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": desiredAgent},
		nil, nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{"my-agent": actualAgent},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 0 {
		t.Errorf("expected 0 creates, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 1 {
		t.Fatalf("expected 1 update, got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 0 {
		t.Errorf("expected 0 deletes, got %d", plan.DeleteCount())
	}

	update := plan.Updates()[0]
	if !update.IsUpdate() {
		t.Error("expected IsUpdate() to be true")
	}
	if update.DesiredState() == nil {
		t.Error("expected DesiredState to be non-nil")
	}
	if update.ActualState() == nil {
		t.Error("expected ActualState to be non-nil")
	}
}

func TestComputeDiff_UpdateWorkflowSpec(t *testing.T) {
	desired := NewDesiredState(
		nil,
		map[string]*workflowv1.Workflow{
			"pipeline": createDiffTestWorkflow("pipeline", "New description"),
		},
		nil, nil,
	)
	actual := NewActualState(
		nil,
		map[string]*workflowv1.Workflow{
			"pipeline": createDiffTestWorkflowWithID("pipeline", "Old description", "wf_123"),
		},
		nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update, got %d", plan.UpdateCount())
	}
}

func TestComputeDiff_UpdateMcpServerSpec(t *testing.T) {
	desired := NewDesiredState(
		nil, nil,
		map[string]*mcpserverv1.McpServer{
			"postgres": createDiffTestMcpServer("postgres", "New description"),
		},
		nil,
	)
	actual := NewActualState(
		nil, nil,
		map[string]*mcpserverv1.McpServer{
			"postgres": createDiffTestMcpServerWithID("postgres", "Old description", "mcp_123"),
		},
		nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update, got %d", plan.UpdateCount())
	}
}

func TestComputeDiff_UpdateSkillSpec(t *testing.T) {
	desired := NewDesiredState(
		nil, nil, nil,
		map[string]*skillv1.Skill{
			"search": createDiffTestSkill("search", "New description"),
		},
	)
	actual := NewActualState(
		nil, nil, nil,
		map[string]*skillv1.Skill{
			"search": createDiffTestSkillWithID("search", "Old description", "sk_123"),
		},
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update, got %d", plan.UpdateCount())
	}
}

func TestComputeDiff_NoUpdateWhenSpecSame(t *testing.T) {
	// Same spec but different metadata (ID) - should NOT be an update
	desiredAgent := createDiffTestAgent("my-agent", "Same description")
	actualAgent := createDiffTestAgentWithID("my-agent", "Same description", "agt_123")

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": desiredAgent},
		nil, nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{"my-agent": actualAgent},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.UpdateCount() != 0 {
		t.Errorf("expected 0 updates (spec unchanged), got %d", plan.UpdateCount())
	}
}

func TestComputeDiff_NoUpdateMetadataOnlyDifference(t *testing.T) {
	// Identical specs but different metadata fields should NOT trigger update
	desiredAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test",
			Slug: "test",
			// No ID (new resource from SDK)
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Same description",
			Instructions: "Same instructions",
		},
	}
	actualAgent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test",
			Slug: "test",
			Id:   "agt_existing_id", // Has ID (from database)
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Same description",
			Instructions: "Same instructions",
		},
	}

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"test": desiredAgent},
		nil, nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{"test": actualAgent},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.UpdateCount() != 0 {
		t.Errorf("expected 0 updates (metadata-only difference), got %d", plan.UpdateCount())
	}
}

// =============================================================================
// Delete Tests
// =============================================================================

func TestComputeDiff_DeleteOrphanAgent(t *testing.T) {
	actual := NewActualState(
		map[string]*agentv1.Agent{
			"orphan-agent": createDiffTestAgentWithID("orphan-agent", "desc", "agt_orphan"),
		},
		nil, nil, nil,
	)
	desired := EmptyDesiredState()

	plan := ComputeDiff(desired, actual, nil)

	if plan.DeleteCount() != 1 {
		t.Fatalf("expected 1 delete, got %d", plan.DeleteCount())
	}

	del := plan.Deletes()[0]
	if del.Key().String() != "agent:orphan-agent" {
		t.Errorf("expected key agent:orphan-agent, got %s", del.Key())
	}
	if !del.IsDelete() {
		t.Error("expected IsDelete() to be true")
	}
	if del.ActualState() == nil {
		t.Error("expected ActualState to be non-nil")
	}
	if del.DesiredState() != nil {
		t.Error("expected DesiredState to be nil for delete")
	}
}

func TestComputeDiff_DeleteOrphanWorkflow(t *testing.T) {
	actual := NewActualState(
		nil,
		map[string]*workflowv1.Workflow{
			"old-workflow": createDiffTestWorkflowWithID("old-workflow", "desc", "wf_old"),
		},
		nil, nil,
	)

	plan := ComputeDiff(EmptyDesiredState(), actual, nil)

	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_DeleteOrphanMcpServer(t *testing.T) {
	actual := NewActualState(
		nil, nil,
		map[string]*mcpserverv1.McpServer{
			"old-mcp": createDiffTestMcpServerWithID("old-mcp", "desc", "mcp_old"),
		},
		nil,
	)

	plan := ComputeDiff(EmptyDesiredState(), actual, nil)

	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_DeleteOrphanSkill(t *testing.T) {
	actual := NewActualState(
		nil, nil, nil,
		map[string]*skillv1.Skill{
			"old-skill": createDiffTestSkillWithID("old-skill", "desc", "sk_old"),
		},
	)

	plan := ComputeDiff(EmptyDesiredState(), actual, nil)

	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_DeleteMultipleOrphans(t *testing.T) {
	actual := NewActualState(
		map[string]*agentv1.Agent{
			"orphan1": createDiffTestAgent("orphan1", "desc"),
			"orphan2": createDiffTestAgent("orphan2", "desc"),
		},
		map[string]*workflowv1.Workflow{
			"orphan-wf": createDiffTestWorkflow("orphan-wf", "desc"),
		},
		nil, nil,
	)

	plan := ComputeDiff(EmptyDesiredState(), actual, nil)

	if plan.DeleteCount() != 3 {
		t.Errorf("expected 3 deletes, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_DeleteAllResourceTypes(t *testing.T) {
	actual := NewActualState(
		map[string]*agentv1.Agent{"a": createDiffTestAgent("a", "d")},
		map[string]*workflowv1.Workflow{"w": createDiffTestWorkflow("w", "d")},
		map[string]*mcpserverv1.McpServer{"m": createDiffTestMcpServer("m", "d")},
		map[string]*skillv1.Skill{"s": createDiffTestSkill("s", "d")},
	)

	plan := ComputeDiff(EmptyDesiredState(), actual, nil)

	if plan.DeleteCount() != 4 {
		t.Errorf("expected 4 deletes, got %d", plan.DeleteCount())
	}
}

// =============================================================================
// Mixed Operations Tests
// =============================================================================

func TestComputeDiff_MixedCreateUpdateDelete(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"new-agent":      createDiffTestAgent("new-agent", "new"),       // CREATE
			"existing-agent": createDiffTestAgent("existing-agent", "NEW!"), // UPDATE
		},
		nil, nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{
			"existing-agent": createDiffTestAgentWithID("existing-agent", "old", "agt_1"), // UPDATE
			"orphan-agent":   createDiffTestAgentWithID("orphan-agent", "bye", "agt_2"),   // DELETE
		},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Errorf("expected 1 create, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update, got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_MixedAcrossResourceTypes(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"new-agent": createDiffTestAgent("new-agent", "new"),
		},
		map[string]*workflowv1.Workflow{
			"updated-wf": createDiffTestWorkflow("updated-wf", "NEW desc"),
		},
		nil, nil,
	)
	actual := NewActualState(
		nil,
		map[string]*workflowv1.Workflow{
			"updated-wf": createDiffTestWorkflowWithID("updated-wf", "OLD desc", "wf_1"),
		},
		map[string]*mcpserverv1.McpServer{
			"orphan-mcp": createDiffTestMcpServer("orphan-mcp", "bye"),
		},
		nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Errorf("expected 1 create (agent), got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update (workflow), got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete (mcp), got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_ComplexScenario(t *testing.T) {
	// Simulate a realistic reconciliation scenario
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"code-reviewer": createDiffTestAgent("code-reviewer", "Reviews code"),
			"writer":        createDiffTestAgent("writer", "Updated instructions"),
		},
		map[string]*workflowv1.Workflow{
			"ci-pipeline": createDiffTestWorkflow("ci-pipeline", "CI/CD pipeline"),
		},
		map[string]*mcpserverv1.McpServer{
			"github": createDiffTestMcpServer("github", "GitHub integration"),
			"slack":  createDiffTestMcpServer("slack", "Slack integration"),
		},
		map[string]*skillv1.Skill{
			"coding-standards": createDiffTestSkill("coding-standards", "Coding standards knowledge"),
		},
	)

	actual := NewActualState(
		map[string]*agentv1.Agent{
			"writer":     createDiffTestAgentWithID("writer", "Old instructions", "agt_1"),
			"deprecated": createDiffTestAgentWithID("deprecated", "To be deleted", "agt_2"),
		},
		nil,
		map[string]*mcpserverv1.McpServer{
			"github": createDiffTestMcpServerWithID("github", "GitHub integration", "mcp_1"), // Same
		},
		map[string]*skillv1.Skill{
			"old-skill": createDiffTestSkillWithID("old-skill", "To be deleted", "sk_1"),
		},
	)

	plan := ComputeDiff(desired, actual, nil)

	// Creates: code-reviewer, ci-pipeline, slack, coding-standards = 4
	if plan.CreateCount() != 4 {
		t.Errorf("expected 4 creates, got %d", plan.CreateCount())
	}
	// Updates: writer (instructions changed) = 1
	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update, got %d", plan.UpdateCount())
	}
	// Deletes: deprecated, old-skill = 2
	if plan.DeleteCount() != 2 {
		t.Errorf("expected 2 deletes, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_AllUnchanged(t *testing.T) {
	agent := createDiffTestAgent("stable-agent", "Stable agent")
	workflow := createDiffTestWorkflow("stable-workflow", "Stable workflow")

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"stable-agent": agent},
		map[string]*workflowv1.Workflow{"stable-workflow": workflow},
		nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{"stable-agent": agent},
		map[string]*workflowv1.Workflow{"stable-workflow": workflow},
		nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if !plan.IsEmpty() {
		t.Errorf("expected empty plan, got creates=%d updates=%d deletes=%d",
			plan.CreateCount(), plan.UpdateCount(), plan.DeleteCount())
	}
}

// =============================================================================
// Real-World Scenario Tests
// =============================================================================

func TestComputeDiff_TypicalFirstApply(t *testing.T) {
	// First time applying a project - everything is a create
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"main-agent": createDiffTestAgent("main-agent", "Main agent"),
		},
		map[string]*workflowv1.Workflow{
			"deploy": createDiffTestWorkflow("deploy", "Deployment workflow"),
		},
		map[string]*mcpserverv1.McpServer{
			"docker": createDiffTestMcpServer("docker", "Docker integration"),
		},
		map[string]*skillv1.Skill{
			"devops": createDiffTestSkill("devops", "DevOps knowledge"),
		},
	)

	plan := ComputeDiff(desired, EmptyActualState(), nil)

	if plan.CreateCount() != 4 {
		t.Errorf("expected 4 creates on first apply, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 0 || plan.DeleteCount() != 0 {
		t.Error("expected no updates or deletes on first apply")
	}
}

func TestComputeDiff_TypicalIncrementalUpdate(t *testing.T) {
	// Incremental update: add one resource, update one, remove one
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"existing":    createDiffTestAgent("existing", "Updated description"),
			"new-feature": createDiffTestAgent("new-feature", "New agent"),
		},
		nil, nil, nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{
			"existing":   createDiffTestAgentWithID("existing", "Old description", "agt_1"),
			"deprecated": createDiffTestAgentWithID("deprecated", "To remove", "agt_2"),
		},
		nil, nil, nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if plan.CreateCount() != 1 {
		t.Errorf("expected 1 create, got %d", plan.CreateCount())
	}
	if plan.UpdateCount() != 1 {
		t.Errorf("expected 1 update, got %d", plan.UpdateCount())
	}
	if plan.DeleteCount() != 1 {
		t.Errorf("expected 1 delete, got %d", plan.DeleteCount())
	}
}

func TestComputeDiff_TypicalNoop(t *testing.T) {
	// No changes needed - stable state
	agent := createDiffTestAgent("stable", "Stable agent")
	mcp := createDiffTestMcpServer("github", "GitHub")

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"stable": agent},
		nil,
		map[string]*mcpserverv1.McpServer{"github": mcp},
		nil,
	)
	actual := NewActualState(
		map[string]*agentv1.Agent{"stable": agent},
		nil,
		map[string]*mcpserverv1.McpServer{"github": mcp},
		nil,
	)

	plan := ComputeDiff(desired, actual, nil)

	if !plan.IsEmpty() {
		t.Error("expected empty plan for stable state")
	}
}

// =============================================================================
// specEquals Tests
// =============================================================================

func TestSpecEquals_NilValues(t *testing.T) {
	t.Run("both nil", func(t *testing.T) {
		if !specEquals(nil, nil) {
			t.Error("expected true for both nil")
		}
	})

	t.Run("desired nil", func(t *testing.T) {
		agent := createDiffTestAgent("test", "desc")
		if specEquals(nil, agent) {
			t.Error("expected false when desired is nil")
		}
	})

	t.Run("actual nil", func(t *testing.T) {
		agent := createDiffTestAgent("test", "desc")
		if specEquals(agent, nil) {
			t.Error("expected false when actual is nil")
		}
	})
}

func TestSpecEquals_TypeMismatch(t *testing.T) {
	agent := createDiffTestAgent("test", "desc")
	workflow := createDiffTestWorkflow("test", "desc")

	if specEquals(agent, workflow) {
		t.Error("expected false for type mismatch")
	}
}

func TestSpecEquals_AgentSpecComparison(t *testing.T) {
	t.Run("same spec", func(t *testing.T) {
		a1 := createDiffTestAgent("test", "description")
		a2 := createDiffTestAgentWithID("test", "description", "agt_123")

		if !specEquals(a1, a2) {
			t.Error("expected true for same spec (different metadata)")
		}
	})

	t.Run("different spec", func(t *testing.T) {
		a1 := createDiffTestAgent("test", "description1")
		a2 := createDiffTestAgent("test", "description2")

		if specEquals(a1, a2) {
			t.Error("expected false for different spec")
		}
	})
}

func TestSpecEquals_WorkflowSpecComparison(t *testing.T) {
	t.Run("same spec", func(t *testing.T) {
		w1 := createDiffTestWorkflow("test", "description")
		w2 := createDiffTestWorkflowWithID("test", "description", "wf_123")

		if !specEquals(w1, w2) {
			t.Error("expected true for same spec")
		}
	})

	t.Run("different spec", func(t *testing.T) {
		w1 := createDiffTestWorkflow("test", "desc1")
		w2 := createDiffTestWorkflow("test", "desc2")

		if specEquals(w1, w2) {
			t.Error("expected false for different spec")
		}
	})
}

func TestSpecEquals_McpServerSpecComparison(t *testing.T) {
	t.Run("same spec", func(t *testing.T) {
		m1 := createDiffTestMcpServer("test", "description")
		m2 := createDiffTestMcpServerWithID("test", "description", "mcp_123")

		if !specEquals(m1, m2) {
			t.Error("expected true for same spec")
		}
	})

	t.Run("different spec", func(t *testing.T) {
		m1 := createDiffTestMcpServer("test", "desc1")
		m2 := createDiffTestMcpServer("test", "desc2")

		if specEquals(m1, m2) {
			t.Error("expected false for different spec")
		}
	})
}

func TestSpecEquals_SkillSpecComparison(t *testing.T) {
	t.Run("same spec", func(t *testing.T) {
		s1 := createDiffTestSkill("test", "description")
		s2 := createDiffTestSkillWithID("test", "description", "sk_123")

		if !specEquals(s1, s2) {
			t.Error("expected true for same spec")
		}
	})

	t.Run("different spec", func(t *testing.T) {
		s1 := createDiffTestSkill("test", "desc1")
		s2 := createDiffTestSkill("test", "desc2")

		if specEquals(s1, s2) {
			t.Error("expected false for different spec")
		}
	})
}
