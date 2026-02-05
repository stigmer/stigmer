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

func execOrderTestAgent(slug string) *agentv1.Agent {
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Test agent " + slug,
			Instructions: "Test instructions",
		},
	}
}

func execOrderTestWorkflow(slug string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Test workflow " + slug,
		},
	}
}

func execOrderTestMcpServer(slug string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Test MCP server " + slug,
		},
	}
}

func execOrderTestSkill(slug string) *skillv1.Skill {
	return &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &skillv1.SkillSpec{
			Description: "Test skill " + slug,
		},
	}
}

func mustKey(kind apiresourcekind.ApiResourceKind, slug string) ResourceKey {
	return MustResourceKey(kind, slug)
}

// keyIndex returns the index of a key in the ordered slice, or -1 if not found.
func keyIndex(ordered []ResourceChange, key ResourceKey) int {
	for i, change := range ordered {
		if change.Key() == key {
			return i
		}
	}
	return -1
}

// =============================================================================
// Empty/Edge Cases Tests
// =============================================================================

func TestGetChangesInExecutionOrder_EmptyPlan(t *testing.T) {
	plan := EmptyPlan()

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 0 {
		t.Errorf("expected empty slice, got %d changes", len(result))
	}
}

func TestGetChangesInExecutionOrder_SingleCreate(t *testing.T) {
	key := mustKey(apiresourcekind.ApiResourceKind_agent, "single-agent")
	create := NewCreateChange(key, execOrderTestAgent("single-agent"))

	plan := NewReconciliationPlan([]ResourceChange{create}, nil, nil)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 1 {
		t.Fatalf("expected 1 change, got %d", len(result))
	}
	if result[0].Key() != key {
		t.Errorf("expected key %s, got %s", key, result[0].Key())
	}
}

func TestGetDeletesInReverseDependencyOrder_EmptyPlan(t *testing.T) {
	plan := EmptyPlan()

	result := plan.GetDeletesInReverseDependencyOrder()

	if len(result) != 0 {
		t.Errorf("expected empty slice, got %d changes", len(result))
	}
}

func TestGetDeletesInReverseDependencyOrder_SingleDelete(t *testing.T) {
	key := mustKey(apiresourcekind.ApiResourceKind_agent, "orphan-agent")
	del := NewDeleteChange(key, execOrderTestAgent("orphan-agent"))

	plan := NewReconciliationPlan(nil, nil, []ResourceChange{del})

	result := plan.GetDeletesInReverseDependencyOrder()

	if len(result) != 1 {
		t.Fatalf("expected 1 delete, got %d", len(result))
	}
	if result[0].Key() != key {
		t.Errorf("expected key %s, got %s", key, result[0].Key())
	}
}

func TestGetChangesInExecutionOrder_NilGraph(t *testing.T) {
	// Creates with no graph should use kind-based ordering
	skillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "skill1")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "workflow1")

	creates := []ResourceChange{
		NewCreateChange(workflowKey, execOrderTestWorkflow("workflow1")), // Added first, but should be last
		NewCreateChange(agentKey, execOrderTestAgent("agent1")),
		NewCreateChange(skillKey, execOrderTestSkill("skill1")), // Should be first
	}

	plan := NewReconciliationPlan(creates, nil, nil)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 changes, got %d", len(result))
	}

	// Kind order: skill < mcp_server < agent < workflow
	skillIdx := keyIndex(result, skillKey)
	agentIdx := keyIndex(result, agentKey)
	workflowIdx := keyIndex(result, workflowKey)

	if skillIdx > agentIdx {
		t.Errorf("skill should come before agent: skill=%d, agent=%d", skillIdx, agentIdx)
	}
	if agentIdx > workflowIdx {
		t.Errorf("agent should come before workflow: agent=%d, workflow=%d", agentIdx, workflowIdx)
	}
}

// =============================================================================
// Create/Update Ordering Tests
// =============================================================================

func TestGetChangesInExecutionOrder_LinearChain(t *testing.T) {
	// workflow -> agent -> mcp_server
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "etl")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "pipeline")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, execOrderTestWorkflow("pipeline")),
		NewCreateChange(agentKey, execOrderTestAgent("etl")),
		NewCreateChange(mcpKey, execOrderTestMcpServer("db")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 changes, got %d", len(result))
	}

	mcpIdx := keyIndex(result, mcpKey)
	agentIdx := keyIndex(result, agentKey)
	workflowIdx := keyIndex(result, workflowKey)

	// mcp_server should come first, then agent, then workflow
	if mcpIdx >= agentIdx {
		t.Errorf("mcp_server should come before agent: mcp=%d, agent=%d", mcpIdx, agentIdx)
	}
	if agentIdx >= workflowIdx {
		t.Errorf("agent should come before workflow: agent=%d, workflow=%d", agentIdx, workflowIdx)
	}
}

func TestGetChangesInExecutionOrder_DiamondDependency(t *testing.T) {
	// agent depends on two MCP servers (diamond pattern)
	//       agent
	//      /     \
	//   mcp1    mcp2
	mcp1Key := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp1")
	mcp2Key := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp2")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "multi-dep")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcp1Key).
		AddDependency(agentKey, mcp2Key).
		Build()

	creates := []ResourceChange{
		NewCreateChange(agentKey, execOrderTestAgent("multi-dep")),
		NewCreateChange(mcp1Key, execOrderTestMcpServer("mcp1")),
		NewCreateChange(mcp2Key, execOrderTestMcpServer("mcp2")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 changes, got %d", len(result))
	}

	mcp1Idx := keyIndex(result, mcp1Key)
	mcp2Idx := keyIndex(result, mcp2Key)
	agentIdx := keyIndex(result, agentKey)

	// Both MCP servers should come before the agent
	if mcp1Idx >= agentIdx {
		t.Errorf("mcp1 should come before agent: mcp1=%d, agent=%d", mcp1Idx, agentIdx)
	}
	if mcp2Idx >= agentIdx {
		t.Errorf("mcp2 should come before agent: mcp2=%d, agent=%d", mcp2Idx, agentIdx)
	}
}

func TestGetChangesInExecutionOrder_NoDependencies(t *testing.T) {
	// No dependencies - should sort by kind, then slug
	agent1Key := mustKey(apiresourcekind.ApiResourceKind_agent, "alpha")
	agent2Key := mustKey(apiresourcekind.ApiResourceKind_agent, "beta")
	skillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "search")

	// Empty graph
	graph := EmptyGraph()

	creates := []ResourceChange{
		NewCreateChange(agent2Key, execOrderTestAgent("beta")),
		NewCreateChange(agent1Key, execOrderTestAgent("alpha")),
		NewCreateChange(skillKey, execOrderTestSkill("search")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 changes, got %d", len(result))
	}

	// Skills come before agents (kind order)
	skillIdx := keyIndex(result, skillKey)
	agent1Idx := keyIndex(result, agent1Key)
	agent2Idx := keyIndex(result, agent2Key)

	if skillIdx >= agent1Idx || skillIdx >= agent2Idx {
		t.Errorf("skill should come before agents: skill=%d, agent1=%d, agent2=%d",
			skillIdx, agent1Idx, agent2Idx)
	}

	// Within agents, alpha should come before beta (slug order)
	if agent1Idx >= agent2Idx {
		t.Errorf("alpha should come before beta: alpha=%d, beta=%d", agent1Idx, agent2Idx)
	}
}

func TestGetChangesInExecutionOrder_MixedCreatesAndUpdates(t *testing.T) {
	// Both creates and updates should be included and ordered
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "worker")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(mcpKey, execOrderTestMcpServer("db")),
	}
	updates := []ResourceChange{
		NewUpdateChange(agentKey, execOrderTestAgent("worker"), execOrderTestAgent("worker")),
	}

	plan := NewReconciliationPlanWithGraph(creates, updates, nil, graph)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 2 {
		t.Fatalf("expected 2 changes, got %d", len(result))
	}

	mcpIdx := keyIndex(result, mcpKey)
	agentIdx := keyIndex(result, agentKey)

	if mcpIdx >= agentIdx {
		t.Errorf("mcp_server should come before agent: mcp=%d, agent=%d", mcpIdx, agentIdx)
	}
}

func TestGetChangesInExecutionOrder_RealWorldDataPipeline(t *testing.T) {
	// Real-world scenario: data pipeline with multiple dependencies
	// workflow -> [etl-agent, validator-agent]
	// etl-agent -> [postgres-mcp, s3-mcp]
	// validator-agent -> [validation-skill]

	postgresKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	s3Key := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "s3")
	validationKey := mustKey(apiresourcekind.ApiResourceKind_skill, "validation")
	etlAgentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "etl")
	validatorKey := mustKey(apiresourcekind.ApiResourceKind_agent, "validator")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "data-pipeline")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, etlAgentKey).
		AddDependency(workflowKey, validatorKey).
		AddDependency(etlAgentKey, postgresKey).
		AddDependency(etlAgentKey, s3Key).
		AddDependency(validatorKey, validationKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, execOrderTestWorkflow("data-pipeline")),
		NewCreateChange(etlAgentKey, execOrderTestAgent("etl")),
		NewCreateChange(validatorKey, execOrderTestAgent("validator")),
		NewCreateChange(postgresKey, execOrderTestMcpServer("postgres")),
		NewCreateChange(s3Key, execOrderTestMcpServer("s3")),
		NewCreateChange(validationKey, execOrderTestSkill("validation")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)

	result := plan.GetChangesInExecutionOrder()

	if len(result) != 6 {
		t.Fatalf("expected 6 changes, got %d", len(result))
	}

	postgresIdx := keyIndex(result, postgresKey)
	s3Idx := keyIndex(result, s3Key)
	validationIdx := keyIndex(result, validationKey)
	etlIdx := keyIndex(result, etlAgentKey)
	validatorIdx := keyIndex(result, validatorKey)
	workflowIdx := keyIndex(result, workflowKey)

	// Leaf nodes should come before their dependents
	if postgresIdx >= etlIdx {
		t.Errorf("postgres should come before etl: postgres=%d, etl=%d", postgresIdx, etlIdx)
	}
	if s3Idx >= etlIdx {
		t.Errorf("s3 should come before etl: s3=%d, etl=%d", s3Idx, etlIdx)
	}
	if validationIdx >= validatorIdx {
		t.Errorf("validation should come before validator: validation=%d, validator=%d",
			validationIdx, validatorIdx)
	}

	// Agents should come before the workflow
	if etlIdx >= workflowIdx {
		t.Errorf("etl should come before workflow: etl=%d, workflow=%d", etlIdx, workflowIdx)
	}
	if validatorIdx >= workflowIdx {
		t.Errorf("validator should come before workflow: validator=%d, workflow=%d",
			validatorIdx, workflowIdx)
	}
}

func TestGetChangesInExecutionOrder_Deterministic(t *testing.T) {
	// Same inputs should always produce same output
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "worker")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(agentKey, execOrderTestAgent("worker")),
		NewCreateChange(mcpKey, execOrderTestMcpServer("db")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)

	// Run multiple times and verify same order
	for i := 0; i < 10; i++ {
		result := plan.GetChangesInExecutionOrder()
		if result[0].Key() != mcpKey {
			t.Errorf("iteration %d: expected mcp first, got %s", i, result[0].Key())
		}
		if result[1].Key() != agentKey {
			t.Errorf("iteration %d: expected agent second, got %s", i, result[1].Key())
		}
	}
}

// =============================================================================
// Delete Ordering Tests
// =============================================================================

func TestGetDeletesInReverseDependencyOrder_LinearChain(t *testing.T) {
	// workflow -> agent -> mcp_server
	// Deletion should be: workflow, agent, mcp_server
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "etl")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "pipeline")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(mcpKey, execOrderTestMcpServer("db")),
		NewDeleteChange(agentKey, execOrderTestAgent("etl")),
		NewDeleteChange(workflowKey, execOrderTestWorkflow("pipeline")),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)

	result := plan.GetDeletesInReverseDependencyOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 deletes, got %d", len(result))
	}

	workflowIdx := keyIndex(result, workflowKey)
	agentIdx := keyIndex(result, agentKey)
	mcpIdx := keyIndex(result, mcpKey)

	// Workflow first (depends on agent), then agent, then mcp_server
	if workflowIdx >= agentIdx {
		t.Errorf("workflow should be deleted before agent: workflow=%d, agent=%d",
			workflowIdx, agentIdx)
	}
	if agentIdx >= mcpIdx {
		t.Errorf("agent should be deleted before mcp: agent=%d, mcp=%d", agentIdx, mcpIdx)
	}
}

func TestGetDeletesInReverseDependencyOrder_KindHierarchyFallback(t *testing.T) {
	// No graph - should use kind hierarchy
	skillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "orphan-skill")
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "orphan-mcp")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "orphan-agent")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "orphan-workflow")

	deletes := []ResourceChange{
		NewDeleteChange(skillKey, execOrderTestSkill("orphan-skill")),
		NewDeleteChange(mcpKey, execOrderTestMcpServer("orphan-mcp")),
		NewDeleteChange(agentKey, execOrderTestAgent("orphan-agent")),
		NewDeleteChange(workflowKey, execOrderTestWorkflow("orphan-workflow")),
	}

	// No graph
	plan := NewReconciliationPlan(nil, nil, deletes)

	result := plan.GetDeletesInReverseDependencyOrder()

	if len(result) != 4 {
		t.Fatalf("expected 4 deletes, got %d", len(result))
	}

	workflowIdx := keyIndex(result, workflowKey)
	agentIdx := keyIndex(result, agentKey)
	mcpIdx := keyIndex(result, mcpKey)
	skillIdx := keyIndex(result, skillKey)

	// Kind order: workflow < agent < mcp_server < skill
	if workflowIdx >= agentIdx {
		t.Errorf("workflow should come before agent: workflow=%d, agent=%d",
			workflowIdx, agentIdx)
	}
	if agentIdx >= mcpIdx {
		t.Errorf("agent should come before mcp: agent=%d, mcp=%d", agentIdx, mcpIdx)
	}
	if mcpIdx >= skillIdx {
		t.Errorf("mcp should come before skill: mcp=%d, skill=%d", mcpIdx, skillIdx)
	}
}

func TestGetDeletesInReverseDependencyOrder_PartialGraphCoverage(t *testing.T) {
	// Graph doesn't cover all orphans - should fall back to kind order
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp1")
	orphanKey := mustKey(apiresourcekind.ApiResourceKind_skill, "orphan") // Not in graph

	// Graph only has agent -> mcp dependency
	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(agentKey, execOrderTestAgent("agent1")),
		NewDeleteChange(mcpKey, execOrderTestMcpServer("mcp1")),
		NewDeleteChange(orphanKey, execOrderTestSkill("orphan")),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)

	result := plan.GetDeletesInReverseDependencyOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 deletes, got %d", len(result))
	}

	// Since graph doesn't cover orphan skill, falls back to kind order
	// Kind order: agent < mcp < skill
	agentIdx := keyIndex(result, agentKey)
	mcpIdx := keyIndex(result, mcpKey)
	orphanIdx := keyIndex(result, orphanKey)

	if agentIdx >= mcpIdx {
		t.Errorf("agent should come before mcp: agent=%d, mcp=%d", agentIdx, mcpIdx)
	}
	if mcpIdx >= orphanIdx {
		t.Errorf("mcp should come before skill: mcp=%d, skill=%d", mcpIdx, orphanIdx)
	}
}

func TestGetDeletesInReverseDependencyOrder_SlugOrderWithinKind(t *testing.T) {
	// Multiple agents - should be sorted by slug within kind
	agentAKey := mustKey(apiresourcekind.ApiResourceKind_agent, "alpha")
	agentBKey := mustKey(apiresourcekind.ApiResourceKind_agent, "beta")
	agentCKey := mustKey(apiresourcekind.ApiResourceKind_agent, "charlie")

	deletes := []ResourceChange{
		NewDeleteChange(agentCKey, execOrderTestAgent("charlie")),
		NewDeleteChange(agentAKey, execOrderTestAgent("alpha")),
		NewDeleteChange(agentBKey, execOrderTestAgent("beta")),
	}

	plan := NewReconciliationPlan(nil, nil, deletes)

	result := plan.GetDeletesInReverseDependencyOrder()

	if len(result) != 3 {
		t.Fatalf("expected 3 deletes, got %d", len(result))
	}

	// All same kind - should be sorted by slug
	aIdx := keyIndex(result, agentAKey)
	bIdx := keyIndex(result, agentBKey)
	cIdx := keyIndex(result, agentCKey)

	if aIdx >= bIdx {
		t.Errorf("alpha should come before beta: alpha=%d, beta=%d", aIdx, bIdx)
	}
	if bIdx >= cIdx {
		t.Errorf("beta should come before charlie: beta=%d, charlie=%d", bIdx, cIdx)
	}
}

func TestGetDeletesInReverseDependencyOrder_AllKinds(t *testing.T) {
	// Verify all four kinds are ordered correctly
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "wf")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "agt")
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp")
	skillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "skl")

	deletes := []ResourceChange{
		NewDeleteChange(skillKey, execOrderTestSkill("skl")),
		NewDeleteChange(workflowKey, execOrderTestWorkflow("wf")),
		NewDeleteChange(mcpKey, execOrderTestMcpServer("mcp")),
		NewDeleteChange(agentKey, execOrderTestAgent("agt")),
	}

	plan := NewReconciliationPlan(nil, nil, deletes)

	result := plan.GetDeletesInReverseDependencyOrder()

	// Expected order: workflow, agent, mcp_server, skill
	if result[0].Key().Kind() != apiresourcekind.ApiResourceKind_workflow {
		t.Errorf("first delete should be workflow, got %s", result[0].Key().Kind())
	}
	if result[1].Key().Kind() != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("second delete should be agent, got %s", result[1].Key().Kind())
	}
	if result[2].Key().Kind() != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("third delete should be mcp_server, got %s", result[2].Key().Kind())
	}
	if result[3].Key().Kind() != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("fourth delete should be skill, got %s", result[3].Key().Kind())
	}
}

func TestGetDeletesInReverseDependencyOrder_Deterministic(t *testing.T) {
	// Same inputs should always produce same output
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "worker")
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "db")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(mcpKey, execOrderTestMcpServer("db")),
		NewDeleteChange(agentKey, execOrderTestAgent("worker")),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)

	for i := 0; i < 10; i++ {
		result := plan.GetDeletesInReverseDependencyOrder()
		if result[0].Key() != agentKey {
			t.Errorf("iteration %d: expected agent first, got %s", i, result[0].Key())
		}
		if result[1].Key() != mcpKey {
			t.Errorf("iteration %d: expected mcp second, got %s", i, result[1].Key())
		}
	}
}

// =============================================================================
// Integration Scenario Tests
// =============================================================================

func TestExecutionOrder_FullReconciliation(t *testing.T) {
	// Full reconciliation: creates, updates, and deletes
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "worker")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "pipeline")
	orphanKey := mustKey(apiresourcekind.ApiResourceKind_skill, "old-skill")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, execOrderTestWorkflow("pipeline")),
		NewCreateChange(agentKey, execOrderTestAgent("worker")),
		NewCreateChange(mcpKey, execOrderTestMcpServer("db")),
	}
	deletes := []ResourceChange{
		NewDeleteChange(orphanKey, execOrderTestSkill("old-skill")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, deletes, graph)

	// Verify create order
	createOrder := plan.GetChangesInExecutionOrder()
	if len(createOrder) != 3 {
		t.Fatalf("expected 3 creates, got %d", len(createOrder))
	}

	mcpIdx := keyIndex(createOrder, mcpKey)
	agentIdx := keyIndex(createOrder, agentKey)
	workflowIdx := keyIndex(createOrder, workflowKey)

	if mcpIdx >= agentIdx || agentIdx >= workflowIdx {
		t.Errorf("create order should be mcp -> agent -> workflow: %d, %d, %d",
			mcpIdx, agentIdx, workflowIdx)
	}

	// Verify delete order (single item, just verify it exists)
	deleteOrder := plan.GetDeletesInReverseDependencyOrder()
	if len(deleteOrder) != 1 {
		t.Fatalf("expected 1 delete, got %d", len(deleteOrder))
	}
	if deleteOrder[0].Key() != orphanKey {
		t.Errorf("expected orphan skill to be deleted")
	}
}

func TestExecutionOrder_IncrementalUpdate(t *testing.T) {
	// Incremental update: add new resource, update existing, delete orphan
	existingMcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	newSkillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "new-skill")
	updateAgentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "worker")
	orphanWorkflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "old-workflow")

	graph := NewDependencyGraphBuilder().
		AddDependency(updateAgentKey, existingMcpKey).
		AddDependency(updateAgentKey, newSkillKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(newSkillKey, execOrderTestSkill("new-skill")),
	}
	updates := []ResourceChange{
		NewUpdateChange(updateAgentKey, execOrderTestAgent("worker"), execOrderTestAgent("worker")),
	}
	deletes := []ResourceChange{
		NewDeleteChange(orphanWorkflowKey, execOrderTestWorkflow("old-workflow")),
	}

	plan := NewReconciliationPlanWithGraph(creates, updates, deletes, graph)

	// Create/update order: skill should come before agent
	ordered := plan.GetChangesInExecutionOrder()
	skillIdx := keyIndex(ordered, newSkillKey)
	agentIdx := keyIndex(ordered, updateAgentKey)

	if skillIdx >= agentIdx {
		t.Errorf("skill should come before agent: skill=%d, agent=%d", skillIdx, agentIdx)
	}

	// Delete: workflow is the only delete
	deleteOrder := plan.GetDeletesInReverseDependencyOrder()
	if len(deleteOrder) != 1 || deleteOrder[0].Key() != orphanWorkflowKey {
		t.Errorf("expected orphan workflow to be deleted")
	}
}

func TestExecutionOrder_FirstApply(t *testing.T) {
	// First apply: all creates, no actual state
	skillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "coding")
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "github")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "reviewer")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "ci-cd")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		AddDependency(agentKey, skillKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, execOrderTestWorkflow("ci-cd")),
		NewCreateChange(agentKey, execOrderTestAgent("reviewer")),
		NewCreateChange(mcpKey, execOrderTestMcpServer("github")),
		NewCreateChange(skillKey, execOrderTestSkill("coding")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)

	ordered := plan.GetChangesInExecutionOrder()

	if len(ordered) != 4 {
		t.Fatalf("expected 4 creates, got %d", len(ordered))
	}

	// Verify dependency order
	skillIdx := keyIndex(ordered, skillKey)
	mcpIdx := keyIndex(ordered, mcpKey)
	agentIdx := keyIndex(ordered, agentKey)
	workflowIdx := keyIndex(ordered, workflowKey)

	if skillIdx >= agentIdx {
		t.Errorf("skill should come before agent: %d, %d", skillIdx, agentIdx)
	}
	if mcpIdx >= agentIdx {
		t.Errorf("mcp should come before agent: %d, %d", mcpIdx, agentIdx)
	}
	if agentIdx >= workflowIdx {
		t.Errorf("agent should come before workflow: %d, %d", agentIdx, workflowIdx)
	}

	// Deletes should be empty
	deleteOrder := plan.GetDeletesInReverseDependencyOrder()
	if len(deleteOrder) != 0 {
		t.Errorf("expected no deletes on first apply, got %d", len(deleteOrder))
	}
}

func TestExecutionOrder_CompleteTeardown(t *testing.T) {
	// Complete teardown: all deletes
	skillKey := mustKey(apiresourcekind.ApiResourceKind_skill, "coding")
	mcpKey := mustKey(apiresourcekind.ApiResourceKind_mcp_server, "github")
	agentKey := mustKey(apiresourcekind.ApiResourceKind_agent, "reviewer")
	workflowKey := mustKey(apiresourcekind.ApiResourceKind_workflow, "ci-cd")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		AddDependency(agentKey, skillKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(skillKey, execOrderTestSkill("coding")),
		NewDeleteChange(mcpKey, execOrderTestMcpServer("github")),
		NewDeleteChange(agentKey, execOrderTestAgent("reviewer")),
		NewDeleteChange(workflowKey, execOrderTestWorkflow("ci-cd")),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)

	ordered := plan.GetDeletesInReverseDependencyOrder()

	if len(ordered) != 4 {
		t.Fatalf("expected 4 deletes, got %d", len(ordered))
	}

	// Verify reverse dependency order
	workflowIdx := keyIndex(ordered, workflowKey)
	agentIdx := keyIndex(ordered, agentKey)
	mcpIdx := keyIndex(ordered, mcpKey)
	skillIdx := keyIndex(ordered, skillKey)

	if workflowIdx >= agentIdx {
		t.Errorf("workflow should be deleted before agent: %d, %d", workflowIdx, agentIdx)
	}
	if agentIdx >= mcpIdx {
		t.Errorf("agent should be deleted before mcp: %d, %d", agentIdx, mcpIdx)
	}
	if agentIdx >= skillIdx {
		t.Errorf("agent should be deleted before skill: %d, %d", agentIdx, skillIdx)
	}

	// Creates should be empty
	createOrder := plan.GetChangesInExecutionOrder()
	if len(createOrder) != 0 {
		t.Errorf("expected no creates on teardown, got %d", len(createOrder))
	}
}

// =============================================================================
// Helper Function Tests
// =============================================================================

func TestKindPriority(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		order    []apiresourcekind.ApiResourceKind
		expected int
	}{
		{
			name:     "skill in creation order",
			kind:     apiresourcekind.ApiResourceKind_skill,
			order:    creationKindOrder,
			expected: 0,
		},
		{
			name:     "workflow in creation order",
			kind:     apiresourcekind.ApiResourceKind_workflow,
			order:    creationKindOrder,
			expected: 3,
		},
		{
			name:     "workflow in deletion order",
			kind:     apiresourcekind.ApiResourceKind_workflow,
			order:    deletionKindOrder,
			expected: 0,
		},
		{
			name:     "skill in deletion order",
			kind:     apiresourcekind.ApiResourceKind_skill,
			order:    deletionKindOrder,
			expected: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := kindPriority(tt.kind, tt.order)
			if got != tt.expected {
				t.Errorf("kindPriority(%v) = %d, want %d", tt.kind, got, tt.expected)
			}
		})
	}
}

func TestExtractKeys(t *testing.T) {
	key1 := mustKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	key2 := mustKey(apiresourcekind.ApiResourceKind_workflow, "workflow1")

	changes := []ResourceChange{
		NewCreateChange(key1, execOrderTestAgent("agent1")),
		NewCreateChange(key2, execOrderTestWorkflow("workflow1")),
	}

	keys := extractKeys(changes)

	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}
	if keys[0] != key1 {
		t.Errorf("expected first key to be %s, got %s", key1, keys[0])
	}
	if keys[1] != key2 {
		t.Errorf("expected second key to be %s, got %s", key2, keys[1])
	}
}

func TestBuildChangeMap(t *testing.T) {
	key1 := mustKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	key2 := mustKey(apiresourcekind.ApiResourceKind_workflow, "workflow1")

	change1 := NewCreateChange(key1, execOrderTestAgent("agent1"))
	change2 := NewCreateChange(key2, execOrderTestWorkflow("workflow1"))

	changes := []ResourceChange{change1, change2}

	m := buildChangeMap(changes)

	if len(m) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m))
	}
	if m[key1] != change1 {
		t.Error("map should contain change1 for key1")
	}
	if m[key2] != change2 {
		t.Error("map should contain change2 for key2")
	}
}

func TestSortByKindAndSlug(t *testing.T) {
	// Input in random order
	changes := []ResourceChange{
		NewCreateChange(mustKey(apiresourcekind.ApiResourceKind_workflow, "beta"), execOrderTestWorkflow("beta")),
		NewCreateChange(mustKey(apiresourcekind.ApiResourceKind_skill, "alpha"), execOrderTestSkill("alpha")),
		NewCreateChange(mustKey(apiresourcekind.ApiResourceKind_agent, "gamma"), execOrderTestAgent("gamma")),
		NewCreateChange(mustKey(apiresourcekind.ApiResourceKind_skill, "zeta"), execOrderTestSkill("zeta")),
	}

	sorted := sortByKindAndSlug(changes, creationKindOrder)

	// Expected order: skill:alpha, skill:zeta, agent:gamma, workflow:beta
	expected := []string{"skill:alpha", "skill:zeta", "agent:gamma", "workflow:beta"}

	if len(sorted) != len(expected) {
		t.Fatalf("expected %d items, got %d", len(expected), len(sorted))
	}

	for i, exp := range expected {
		if sorted[i].Key().String() != exp {
			t.Errorf("position %d: expected %s, got %s", i, exp, sorted[i].Key())
		}
	}
}
