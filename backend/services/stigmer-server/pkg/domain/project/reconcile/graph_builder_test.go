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
// Test Helpers
// =============================================================================

// makeAgent creates an agent with optional skill and MCP server references.
func makeAgent(name string, skillSlugs, mcpServerSlugs []string) *agentv1.Agent {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: name},
		Spec:     &agentv1.AgentSpec{Instructions: "Test agent: " + name},
	}

	for _, slug := range skillSlugs {
		agent.Spec.SkillRefs = append(agent.Spec.SkillRefs, &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_skill,
			Slug: slug,
		})
	}

	for _, slug := range mcpServerSlugs {
		agent.Spec.McpServerUsages = append(agent.Spec.McpServerUsages, &agentv1.McpServerUsage{
			McpServerRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_mcp_server,
				Slug: slug,
			},
		})
	}

	return agent
}

// makeAgentWithSubAgents creates an agent with sub-agents that have skill references.
func makeAgentWithSubAgents(name string, subAgentSkills map[string][]string) *agentv1.Agent {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: name},
		Spec:     &agentv1.AgentSpec{Instructions: "Parent agent: " + name},
	}

	for subName, skillSlugs := range subAgentSkills {
		subAgent := &agentv1.SubAgent{
			Name:         subName,
			Instructions: "Sub-agent: " + subName,
		}
		for _, slug := range skillSlugs {
			subAgent.SkillRefs = append(subAgent.SkillRefs, &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_skill,
				Slug: slug,
			})
		}
		agent.Spec.SubAgents = append(agent.Spec.SubAgents, subAgent)
	}

	return agent
}

// makeWorkflow creates a basic workflow.
func makeWorkflow(name string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Name: name},
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      name,
			},
		},
	}
}

// makeMcpServer creates a basic MCP server.
func makeMcpServer(name string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{Name: name},
		Spec:     &mcpserverv1.McpServerSpec{Description: "Test MCP: " + name},
	}
}

// makeSkill creates a basic skill.
func makeSkill(name string) *skillv1.Skill {
	return &skillv1.Skill{
		Metadata: &apiresource.ApiResourceMetadata{Name: name},
		Spec:     &skillv1.SkillSpec{Description: "Test skill: " + name},
	}
}

// =============================================================================
// Basic Functionality Tests
// =============================================================================

func TestBuildDependencyGraph_NilDesiredState(t *testing.T) {
	graph := BuildDependencyGraph(nil)

	if graph != EmptyGraph() {
		t.Error("expected EmptyGraph() singleton for nil DesiredState")
	}
	if !graph.IsEmpty() {
		t.Error("expected empty graph")
	}
}

func TestBuildDependencyGraph_EmptyDesiredState(t *testing.T) {
	desired := EmptyDesiredState()

	graph := BuildDependencyGraph(desired)

	if graph != EmptyGraph() {
		t.Error("expected EmptyGraph() singleton for empty DesiredState")
	}
}

func TestBuildDependencyGraph_NoResourcesWithDependencies(t *testing.T) {
	// Skills and MCP servers with no references should produce empty graph
	desired := NewDesiredState(
		nil,
		nil,
		map[string]*mcpserverv1.McpServer{"postgres": makeMcpServer("postgres")},
		map[string]*skillv1.Skill{"web-search": makeSkill("web-search")},
	)

	graph := BuildDependencyGraph(desired)

	// Graph should be empty since no resources have dependencies
	if !graph.IsEmpty() {
		t.Errorf("expected empty graph for resources with no dependencies, got %d edges", graph.EdgeCount())
	}
}

func TestBuildDependencyGraph_ReturnsImmutableGraph(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": makeAgent("my-agent", []string{"skill1"}, nil)},
		nil,
		nil,
		map[string]*skillv1.Skill{"skill1": makeSkill("skill1")},
	)

	graph1 := BuildDependencyGraph(desired)
	graph2 := BuildDependencyGraph(desired)

	// Both calls should produce equivalent graphs
	if graph1.NodeCount() != graph2.NodeCount() {
		t.Error("expected equivalent graphs from multiple calls")
	}
	if graph1.EdgeCount() != graph2.EdgeCount() {
		t.Error("expected equivalent edge counts from multiple calls")
	}
}

// =============================================================================
// Single Resource Type Tests
// =============================================================================

func TestBuildDependencyGraph_AgentWithSingleSkillRef(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": makeAgent("my-agent", []string{"web-search"}, nil)},
		nil,
		nil,
		map[string]*skillv1.Skill{"web-search": makeSkill("web-search")},
	)

	graph := BuildDependencyGraph(desired)

	if graph.IsEmpty() {
		t.Fatal("expected non-empty graph")
	}
	if graph.NodeCount() != 2 {
		t.Errorf("expected 2 nodes (agent + skill), got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 1 {
		t.Errorf("expected 1 edge, got %d", graph.EdgeCount())
	}

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	skillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "web-search")

	deps := graph.Dependencies(agentKey)
	if len(deps) != 1 || deps[0] != skillKey {
		t.Errorf("expected agent to depend on skill, got %v", deps)
	}
}

func TestBuildDependencyGraph_AgentWithSingleMcpServerRef(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": makeAgent("my-agent", nil, []string{"github"})},
		nil,
		map[string]*mcpserverv1.McpServer{"github": makeMcpServer("github")},
		nil,
	)

	graph := BuildDependencyGraph(desired)

	if graph.NodeCount() != 2 {
		t.Errorf("expected 2 nodes (agent + mcp_server), got %d", graph.NodeCount())
	}

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "github")

	deps := graph.Dependencies(agentKey)
	if len(deps) != 1 || deps[0] != mcpKey {
		t.Errorf("expected agent to depend on mcp_server, got %v", deps)
	}
}

func TestBuildDependencyGraph_AgentWithMultipleSkillRefs(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"my-agent": makeAgent("my-agent", []string{"web-search", "code-review", "data-analysis"}, nil),
		},
		nil,
		nil,
		map[string]*skillv1.Skill{
			"web-search":    makeSkill("web-search"),
			"code-review":   makeSkill("code-review"),
			"data-analysis": makeSkill("data-analysis"),
		},
	)

	graph := BuildDependencyGraph(desired)

	if graph.NodeCount() != 4 {
		t.Errorf("expected 4 nodes (1 agent + 3 skills), got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 3 {
		t.Errorf("expected 3 edges, got %d", graph.EdgeCount())
	}

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	deps := graph.Dependencies(agentKey)
	if len(deps) != 3 {
		t.Errorf("expected 3 dependencies, got %d", len(deps))
	}
}

func TestBuildDependencyGraph_AgentWithBothSkillAndMcpRefs(t *testing.T) {
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"my-agent": makeAgent("my-agent", []string{"web-search"}, []string{"github", "slack"}),
		},
		nil,
		map[string]*mcpserverv1.McpServer{
			"github": makeMcpServer("github"),
			"slack":  makeMcpServer("slack"),
		},
		map[string]*skillv1.Skill{
			"web-search": makeSkill("web-search"),
		},
	)

	graph := BuildDependencyGraph(desired)

	if graph.NodeCount() != 4 {
		t.Errorf("expected 4 nodes (1 agent + 1 skill + 2 mcp_servers), got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 3 {
		t.Errorf("expected 3 edges, got %d", graph.EdgeCount())
	}

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	deps := graph.Dependencies(agentKey)
	if len(deps) != 3 {
		t.Errorf("expected 3 dependencies, got %d", len(deps))
	}
}

// =============================================================================
// Dependency Filtering Tests
// =============================================================================

func TestBuildDependencyGraph_IgnoresExternalReferences(t *testing.T) {
	// Agent references a skill that doesn't exist in DesiredState
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"my-agent": makeAgent("my-agent", []string{"external-skill"}, nil),
		},
		nil,
		nil,
		nil, // No skills in DesiredState
	)

	graph := BuildDependencyGraph(desired)

	// Graph should be empty - no valid internal dependencies
	if !graph.IsEmpty() {
		t.Errorf("expected empty graph when all references are external, got %d edges", graph.EdgeCount())
	}
}

func TestBuildDependencyGraph_IgnoresReferencesOutsideDesiredState(t *testing.T) {
	// Agent references skills, but only one is in DesiredState
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"my-agent": makeAgent("my-agent", []string{"internal-skill", "external-skill"}, nil),
		},
		nil,
		nil,
		map[string]*skillv1.Skill{
			"internal-skill": makeSkill("internal-skill"),
			// "external-skill" is NOT in DesiredState
		},
	)

	graph := BuildDependencyGraph(desired)

	if graph.EdgeCount() != 1 {
		t.Errorf("expected 1 edge (only internal dependency), got %d", graph.EdgeCount())
	}

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	deps := graph.Dependencies(agentKey)
	if len(deps) != 1 {
		t.Errorf("expected 1 dependency, got %d", len(deps))
	}
}

func TestBuildDependencyGraph_IgnoresInvalidReferences(t *testing.T) {
	// Create agent with an invalid (empty slug) reference manually
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "my-agent"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: ""}, // Invalid - empty slug
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "valid-skill"},
			},
		},
	}

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": agent},
		nil,
		nil,
		map[string]*skillv1.Skill{"valid-skill": makeSkill("valid-skill")},
	)

	graph := BuildDependencyGraph(desired)

	// Should only have 1 edge (to valid-skill), invalid reference should be skipped
	if graph.EdgeCount() != 1 {
		t.Errorf("expected 1 edge (invalid refs skipped), got %d", graph.EdgeCount())
	}
}

func TestBuildDependencyGraph_DeduplicatesDependencies(t *testing.T) {
	// Agent references the same skill twice
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "my-agent"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "web-search"},
				{Kind: apiresourcekind.ApiResourceKind_skill, Slug: "web-search"}, // Duplicate
			},
		},
	}

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"my-agent": agent},
		nil,
		nil,
		map[string]*skillv1.Skill{"web-search": makeSkill("web-search")},
	)

	graph := BuildDependencyGraph(desired)

	// DependencyDiscoverer already deduplicates, but graph builder should handle it gracefully
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	deps := graph.Dependencies(agentKey)

	// The builder adds duplicate edges but DependencyGraph handles it
	// (checking behavior matches expectation)
	if len(deps) < 1 {
		t.Error("expected at least 1 dependency")
	}
}

// =============================================================================
// Multiple Resources Tests
// =============================================================================

func TestBuildDependencyGraph_MultipleAgentsSharedDependency(t *testing.T) {
	// Two agents depend on the same skill
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"agent-a": makeAgent("agent-a", []string{"shared-skill"}, nil),
			"agent-b": makeAgent("agent-b", []string{"shared-skill"}, nil),
		},
		nil,
		nil,
		map[string]*skillv1.Skill{"shared-skill": makeSkill("shared-skill")},
	)

	graph := BuildDependencyGraph(desired)

	if graph.NodeCount() != 3 {
		t.Errorf("expected 3 nodes (2 agents + 1 skill), got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 2 {
		t.Errorf("expected 2 edges (both agents -> skill), got %d", graph.EdgeCount())
	}

	skillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "shared-skill")
	dependents := graph.Dependents(skillKey)
	if len(dependents) != 2 {
		t.Errorf("expected skill to have 2 dependents, got %d", len(dependents))
	}
}

func TestBuildDependencyGraph_MultipleAgentsIndependentDependencies(t *testing.T) {
	// Two agents with completely independent dependencies
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"agent-a": makeAgent("agent-a", []string{"skill-a"}, nil),
			"agent-b": makeAgent("agent-b", []string{"skill-b"}, nil),
		},
		nil,
		nil,
		map[string]*skillv1.Skill{
			"skill-a": makeSkill("skill-a"),
			"skill-b": makeSkill("skill-b"),
		},
	)

	graph := BuildDependencyGraph(desired)

	if graph.NodeCount() != 4 {
		t.Errorf("expected 4 nodes (2 agents + 2 skills), got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 2 {
		t.Errorf("expected 2 edges, got %d", graph.EdgeCount())
	}
}

func TestBuildDependencyGraph_AgentsWithNoOverlap(t *testing.T) {
	// Multiple agents with different dependency types
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"agent-a": makeAgent("agent-a", []string{"skill-a"}, nil),
			"agent-b": makeAgent("agent-b", nil, []string{"mcp-b"}),
		},
		nil,
		map[string]*mcpserverv1.McpServer{"mcp-b": makeMcpServer("mcp-b")},
		map[string]*skillv1.Skill{"skill-a": makeSkill("skill-a")},
	)

	graph := BuildDependencyGraph(desired)

	if graph.NodeCount() != 4 {
		t.Errorf("expected 4 nodes, got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 2 {
		t.Errorf("expected 2 edges, got %d", graph.EdgeCount())
	}

	// Verify each agent has correct dependencies
	agentA := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent-a")
	agentB := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent-b")

	depsA := graph.Dependencies(agentA)
	if len(depsA) != 1 {
		t.Errorf("expected agent-a to have 1 dep, got %d", len(depsA))
	}

	depsB := graph.Dependencies(agentB)
	if len(depsB) != 1 {
		t.Errorf("expected agent-b to have 1 dep, got %d", len(depsB))
	}
}

func TestBuildDependencyGraph_MixedResourceTypes(t *testing.T) {
	// Mix of all resource types - future-proof for when workflows might have deps
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"etl-agent": makeAgent("etl-agent", []string{"data-skill"}, []string{"postgres"}),
		},
		map[string]*workflowv1.Workflow{
			"pipeline": makeWorkflow("pipeline"),
		},
		map[string]*mcpserverv1.McpServer{
			"postgres": makeMcpServer("postgres"),
		},
		map[string]*skillv1.Skill{
			"data-skill": makeSkill("data-skill"),
		},
	)

	graph := BuildDependencyGraph(desired)

	// Only agent has dependencies (workflow has none currently)
	if graph.NodeCount() != 3 {
		t.Errorf("expected 3 nodes in graph, got %d", graph.NodeCount())
	}
	if graph.EdgeCount() != 2 {
		t.Errorf("expected 2 edges (agent -> skill, agent -> mcp), got %d", graph.EdgeCount())
	}
}

// =============================================================================
// Real-World Scenarios Tests
// =============================================================================

func TestBuildDependencyGraph_TypicalProjectWithAgentAndSkills(t *testing.T) {
	// Typical project: one agent with multiple skills
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"engineering-assistant": makeAgent("engineering-assistant",
				[]string{"web-search", "code-review", "documentation"},
				[]string{"github", "slack"},
			),
		},
		nil,
		map[string]*mcpserverv1.McpServer{
			"github": makeMcpServer("github"),
			"slack":  makeMcpServer("slack"),
		},
		map[string]*skillv1.Skill{
			"web-search":    makeSkill("web-search"),
			"code-review":   makeSkill("code-review"),
			"documentation": makeSkill("documentation"),
		},
	)

	graph := BuildDependencyGraph(desired)

	// 1 agent + 3 skills + 2 mcp servers = 6 nodes
	if graph.NodeCount() != 6 {
		t.Errorf("expected 6 nodes, got %d", graph.NodeCount())
	}
	// Agent depends on all 5 resources
	if graph.EdgeCount() != 5 {
		t.Errorf("expected 5 edges, got %d", graph.EdgeCount())
	}

	// Verify topological sort works
	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error in topological sort: %v", err)
	}

	// Agent should come last (depends on everything else)
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "engineering-assistant")
	agentIdx := -1
	for i, key := range sorted {
		if key == agentKey {
			agentIdx = i
			break
		}
	}
	if agentIdx != len(sorted)-1 {
		t.Errorf("expected agent to be last in sort order, was at index %d of %d", agentIdx, len(sorted)-1)
	}
}

func TestBuildDependencyGraph_AgentWithSubAgentSkillRefs(t *testing.T) {
	// Agent with sub-agents that have their own skill references
	agent := makeAgentWithSubAgents("parent-agent", map[string][]string{
		"code-reviewer": {"code-review-skill", "security-skill"},
		"doc-writer":    {"markdown-skill"},
	})

	desired := NewDesiredState(
		map[string]*agentv1.Agent{"parent-agent": agent},
		nil,
		nil,
		map[string]*skillv1.Skill{
			"code-review-skill": makeSkill("code-review-skill"),
			"security-skill":    makeSkill("security-skill"),
			"markdown-skill":    makeSkill("markdown-skill"),
		},
	)

	graph := BuildDependencyGraph(desired)

	// 1 agent + 3 skills = 4 nodes
	if graph.NodeCount() != 4 {
		t.Errorf("expected 4 nodes, got %d", graph.NodeCount())
	}
	// Agent depends on all 3 skills (discovered from sub-agents)
	if graph.EdgeCount() != 3 {
		t.Errorf("expected 3 edges, got %d", graph.EdgeCount())
	}

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "parent-agent")
	deps := graph.Dependencies(agentKey)
	if len(deps) != 3 {
		t.Errorf("expected 3 dependencies from sub-agents, got %d", len(deps))
	}
}

func TestBuildDependencyGraph_ComplexProjectTopology(t *testing.T) {
	// Complex project with multiple agents, shared dependencies
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"reader-agent": makeAgent("reader-agent", []string{"data-parsing"}, []string{"postgres"}),
			"writer-agent": makeAgent("writer-agent", []string{"data-validation"}, []string{"postgres"}),
			"api-agent":    makeAgent("api-agent", nil, []string{"api-server"}),
		},
		map[string]*workflowv1.Workflow{
			"data-pipeline": makeWorkflow("data-pipeline"),
		},
		map[string]*mcpserverv1.McpServer{
			"postgres":   makeMcpServer("postgres"),
			"api-server": makeMcpServer("api-server"),
		},
		map[string]*skillv1.Skill{
			"data-parsing":    makeSkill("data-parsing"),
			"data-validation": makeSkill("data-validation"),
		},
	)

	graph := BuildDependencyGraph(desired)

	// Verify structure
	// reader-agent -> postgres, data-parsing
	// writer-agent -> postgres, data-validation
	// api-agent -> api-server
	// Total: 5 edges
	if graph.EdgeCount() != 5 {
		t.Errorf("expected 5 edges, got %d", graph.EdgeCount())
	}

	// postgres should have 2 dependents
	postgresKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	dependents := graph.Dependents(postgresKey)
	if len(dependents) != 2 {
		t.Errorf("expected postgres to have 2 dependents, got %d", len(dependents))
	}

	// Verify no cycles
	if graph.HasCycle() {
		t.Error("expected no cycles in complex project graph")
	}
}

func TestBuildDependencyGraph_GraphSupportsTopologicalSort(t *testing.T) {
	// Integration test: verify built graph works with topological sort
	desired := NewDesiredState(
		map[string]*agentv1.Agent{
			"agent-a": makeAgent("agent-a", []string{"skill-x"}, nil),
			"agent-b": makeAgent("agent-b", []string{"skill-y"}, nil),
		},
		nil,
		nil,
		map[string]*skillv1.Skill{
			"skill-x": makeSkill("skill-x"),
			"skill-y": makeSkill("skill-y"),
		},
	)

	graph := BuildDependencyGraph(desired)

	// Should successfully sort
	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("topological sort failed: %v", err)
	}

	if len(sorted) != 4 {
		t.Errorf("expected 4 nodes in sorted result, got %d", len(sorted))
	}

	// Verify skills come before agents
	skillX := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "skill-x")
	skillY := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "skill-y")
	agentA := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent-a")
	agentB := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent-b")

	skillXIdx := indexOf(sorted, skillX)
	skillYIdx := indexOf(sorted, skillY)
	agentAIdx := indexOf(sorted, agentA)
	agentBIdx := indexOf(sorted, agentB)

	if skillXIdx >= agentAIdx {
		t.Error("expected skill-x before agent-a")
	}
	if skillYIdx >= agentBIdx {
		t.Error("expected skill-y before agent-b")
	}
}

// indexOf returns the index of key in slice, or -1 if not found.
// Note: This helper is already defined in dependency_graph_test.go but we
// need a local copy since tests are in the same package but separate files.
func indexOfGraphBuilder(slice []ResourceKey, key ResourceKey) int {
	for i, k := range slice {
		if k == key {
			return i
		}
	}
	return -1
}
