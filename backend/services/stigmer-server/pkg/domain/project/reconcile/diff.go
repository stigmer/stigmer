package reconcile

import (
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// ComputeDiff compares desired state with actual state and returns a reconciliation plan.
//
// The algorithm iterates all four resource types and categorizes each resource:
//   - Creates: Resources in desired but not in actual
//   - Updates: Resources in both with different specs (ignoring metadata)
//   - Deletes: Resources in actual but not in desired (orphans)
//
// The comparison is spec-only: metadata fields (id, timestamps, etc.) are ignored
// to avoid false update detections. Only user-defined spec fields matter.
//
// The graph parameter is used by the returned plan's GetChangesInExecutionOrder()
// and GetDeletesInReverseDependencyOrder() methods for dependency-aware ordering.
// Pass nil if execution order doesn't matter or if using kind-based fallback ordering.
//
// Example:
//
//	desired := NewDesiredState(agents, workflows, mcpServers, skills)
//	actual := NewActualState(existingAgents, existingWorkflows, nil, nil)
//	graph := BuildDependencyGraph(desired)
//	plan := ComputeDiff(desired, actual, graph)
//
//	fmt.Printf("Creates: %d, Updates: %d, Deletes: %d\n",
//	    plan.CreateCount(), plan.UpdateCount(), plan.DeleteCount())
//
//	// Get changes in safe execution order
//	for _, change := range plan.GetChangesInExecutionOrder() {
//	    execute(change)
//	}
func ComputeDiff(desired *DesiredState, actual *ActualState, graph *DependencyGraph) *ReconciliationPlan {
	// Handle nil states by substituting empty singletons
	if desired == nil {
		desired = EmptyDesiredState()
	}
	if actual == nil {
		actual = EmptyActualState()
	}

	// Early exit for both empty
	if desired.IsEmpty() && actual.IsEmpty() {
		return EmptyPlan()
	}

	var creates, updates, deletes []ResourceChange

	// Diff each resource type
	// Order matches typical dependency hierarchy: leaf nodes first
	diffAgents(desired.Agents(), actual.Agents(), &creates, &updates, &deletes)
	diffWorkflows(desired.Workflows(), actual.Workflows(), &creates, &updates, &deletes)
	diffMcpServers(desired.McpServers(), actual.McpServers(), &creates, &updates, &deletes)
	diffSkills(desired.Skills(), actual.Skills(), &creates, &updates, &deletes)

	return NewReconciliationPlanWithGraph(creates, updates, deletes, graph)
}

// diffAgents computes diff for Agent resources.
func diffAgents(
	desired map[string]*agentv1.Agent,
	actual map[string]*agentv1.Agent,
	creates, updates, deletes *[]ResourceChange,
) {
	// Creates: in desired but not in actual
	for slug, desiredResource := range desired {
		if _, exists := actual[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
			*creates = append(*creates, NewCreateChange(key, desiredResource))
		}
	}

	// Updates: in both but specs differ
	for slug, desiredResource := range desired {
		actualResource, exists := actual[slug]
		if exists && !specEquals(desiredResource, actualResource) {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
			*updates = append(*updates, NewUpdateChange(key, desiredResource, actualResource))
		}
	}

	// Deletes: in actual but not in desired (orphans)
	for slug, actualResource := range actual {
		if _, exists := desired[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
			*deletes = append(*deletes, NewDeleteChange(key, actualResource))
		}
	}
}

// diffWorkflows computes diff for Workflow resources.
func diffWorkflows(
	desired map[string]*workflowv1.Workflow,
	actual map[string]*workflowv1.Workflow,
	creates, updates, deletes *[]ResourceChange,
) {
	for slug, desiredResource := range desired {
		if _, exists := actual[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
			*creates = append(*creates, NewCreateChange(key, desiredResource))
		}
	}

	for slug, desiredResource := range desired {
		actualResource, exists := actual[slug]
		if exists && !specEquals(desiredResource, actualResource) {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
			*updates = append(*updates, NewUpdateChange(key, desiredResource, actualResource))
		}
	}

	for slug, actualResource := range actual {
		if _, exists := desired[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
			*deletes = append(*deletes, NewDeleteChange(key, actualResource))
		}
	}
}

// diffMcpServers computes diff for McpServer resources.
func diffMcpServers(
	desired map[string]*mcpserverv1.McpServer,
	actual map[string]*mcpserverv1.McpServer,
	creates, updates, deletes *[]ResourceChange,
) {
	for slug, desiredResource := range desired {
		if _, exists := actual[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
			*creates = append(*creates, NewCreateChange(key, desiredResource))
		}
	}

	for slug, desiredResource := range desired {
		actualResource, exists := actual[slug]
		if exists && !specEquals(desiredResource, actualResource) {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
			*updates = append(*updates, NewUpdateChange(key, desiredResource, actualResource))
		}
	}

	for slug, actualResource := range actual {
		if _, exists := desired[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
			*deletes = append(*deletes, NewDeleteChange(key, actualResource))
		}
	}
}

// diffSkills computes diff for Skill resources.
func diffSkills(
	desired map[string]*skillv1.Skill,
	actual map[string]*skillv1.Skill,
	creates, updates, deletes *[]ResourceChange,
) {
	for slug, desiredResource := range desired {
		if _, exists := actual[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug)
			*creates = append(*creates, NewCreateChange(key, desiredResource))
		}
	}

	for slug, desiredResource := range desired {
		actualResource, exists := actual[slug]
		if exists && !specEquals(desiredResource, actualResource) {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug)
			*updates = append(*updates, NewUpdateChange(key, desiredResource, actualResource))
		}
	}

	for slug, actualResource := range actual {
		if _, exists := desired[slug]; !exists {
			key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug)
			*deletes = append(*deletes, NewDeleteChange(key, actualResource))
		}
	}
}

// specEquals compares only the spec fields of two resources.
//
// This is critical for correct reconciliation: metadata fields like id, created_at,
// updated_at change on every database save and must be ignored. Only the spec
// represents user intent.
//
// The function performs a type switch to extract and compare specs:
//   - Agent: compares AgentSpec
//   - Workflow: compares WorkflowSpec
//   - McpServer: compares McpServerSpec
//   - Skill: compares SkillSpec
//
// For unknown types, falls back to full proto comparison.
//
// Example:
//
//	// Same spec, different metadata -> true (no update needed)
//	agent1 := &agentv1.Agent{Spec: spec, Metadata: &ApiResourceMetadata{Id: "a"}}
//	agent2 := &agentv1.Agent{Spec: spec, Metadata: &ApiResourceMetadata{Id: "b"}}
//	specEquals(agent1, agent2) // true
//
//	// Different spec -> false (update needed)
//	agent3 := &agentv1.Agent{Spec: differentSpec}
//	specEquals(agent1, agent3) // false
func specEquals(desired, actual proto.Message) bool {
	if desired == nil && actual == nil {
		return true
	}
	if desired == nil || actual == nil {
		return false
	}

	switch d := desired.(type) {
	case *agentv1.Agent:
		a, ok := actual.(*agentv1.Agent)
		if !ok {
			return false
		}
		return proto.Equal(d.GetSpec(), a.GetSpec())

	case *workflowv1.Workflow:
		w, ok := actual.(*workflowv1.Workflow)
		if !ok {
			return false
		}
		return proto.Equal(d.GetSpec(), w.GetSpec())

	case *mcpserverv1.McpServer:
		m, ok := actual.(*mcpserverv1.McpServer)
		if !ok {
			return false
		}
		return proto.Equal(d.GetSpec(), m.GetSpec())

	case *skillv1.Skill:
		s, ok := actual.(*skillv1.Skill)
		if !ok {
			return false
		}
		return proto.Equal(d.GetSpec(), s.GetSpec())
	}

	// Fallback for unknown types: compare full messages
	return proto.Equal(desired, actual)
}
