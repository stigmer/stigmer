package reconcile

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Test helper to create ResourceKey for agents
func agentKey(slug string) ResourceKey {
	return MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
}

// Test helper to create ResourceKey for workflows
func workflowKey(slug string) ResourceKey {
	return MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
}

// Test helper to create ResourceKey for MCP servers
func mcpServerKey(slug string) ResourceKey {
	return MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
}

// Test helper to create ResourceKey for skills
func skillKey(slug string) ResourceKey {
	return MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug)
}

// =============================================================================
// Construction Tests
// =============================================================================

func TestEmptyGraph(t *testing.T) {
	graph := EmptyGraph()

	t.Run("is empty", func(t *testing.T) {
		if !graph.IsEmpty() {
			t.Error("expected empty graph to be empty")
		}
	})

	t.Run("has zero nodes", func(t *testing.T) {
		if graph.NodeCount() != 0 {
			t.Errorf("expected 0 nodes, got %d", graph.NodeCount())
		}
	})

	t.Run("has zero edges", func(t *testing.T) {
		if graph.EdgeCount() != 0 {
			t.Errorf("expected 0 edges, got %d", graph.EdgeCount())
		}
	})

	t.Run("is singleton", func(t *testing.T) {
		graph2 := EmptyGraph()
		if graph != graph2 {
			t.Error("expected EmptyGraph to return same instance")
		}
	})
}

func TestNewDependencyGraph_NilEdges(t *testing.T) {
	graph := NewDependencyGraph(nil)

	if !graph.IsEmpty() {
		t.Error("expected graph from nil edges to be empty")
	}
}

func TestNewDependencyGraph_EmptyEdges(t *testing.T) {
	graph := NewDependencyGraph(map[ResourceKey][]ResourceKey{})

	if !graph.IsEmpty() {
		t.Error("expected graph from empty edges to be empty")
	}
}

func TestNewDependencyGraph_DefensiveCopyEdges(t *testing.T) {
	agentA := agentKey("a")
	agentB := agentKey("b")
	agentC := agentKey("c")

	original := map[ResourceKey][]ResourceKey{
		agentA: {agentB, agentC},
	}

	graph := NewDependencyGraph(original)

	// Modify original map - should not affect graph
	agentD := agentKey("d")
	original[agentA] = append(original[agentA], agentD)
	original[agentD] = []ResourceKey{agentB}

	// Graph should not have agentD
	if graph.HasNode(agentD) {
		t.Error("modifying original map should not affect graph")
	}

	// Original dependencies should be intact
	deps := graph.Dependencies(agentA)
	if len(deps) != 2 {
		t.Errorf("expected 2 dependencies, got %d", len(deps))
	}
}

func TestNewDependencyGraph_DefensiveCopyInnerSlices(t *testing.T) {
	agentA := agentKey("a")
	agentB := agentKey("b")
	agentC := agentKey("c")

	innerSlice := []ResourceKey{agentB}
	original := map[ResourceKey][]ResourceKey{
		agentA: innerSlice,
	}

	graph := NewDependencyGraph(original)

	// Modify inner slice - should not affect graph
	innerSlice[0] = agentC

	deps := graph.Dependencies(agentA)
	if len(deps) != 1 || deps[0] != agentB {
		t.Error("modifying inner slice should not affect graph")
	}
}

func TestNewDependencyGraph_EmptyInnerSlices(t *testing.T) {
	agentA := agentKey("a")

	edges := map[ResourceKey][]ResourceKey{
		agentA: {}, // Empty slice
	}

	graph := NewDependencyGraph(edges)

	// Empty dependencies should result in empty graph
	if !graph.IsEmpty() {
		t.Error("expected graph with only empty dependencies to be empty")
	}
}

func TestNewDependencyGraphBuilder_ProducesCorrectGraph(t *testing.T) {
	workflow := workflowKey("pipeline")
	agent := agentKey("etl")
	mcpServer := mcpServerKey("postgres")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflow, agent).
		AddDependency(agent, mcpServer).
		Build()

	if graph.IsEmpty() {
		t.Error("expected non-empty graph")
	}

	if graph.NodeCount() != 3 {
		t.Errorf("expected 3 nodes, got %d", graph.NodeCount())
	}

	if graph.EdgeCount() != 2 {
		t.Errorf("expected 2 edges, got %d", graph.EdgeCount())
	}

	deps := graph.Dependencies(workflow)
	if len(deps) != 1 || deps[0] != agent {
		t.Errorf("expected workflow to depend on agent")
	}
}

// =============================================================================
// Topological Sort Tests
// =============================================================================

func TestTopologicalSort_EmptyGraph(t *testing.T) {
	graph := EmptyGraph()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sorted) != 0 {
		t.Errorf("expected empty result, got %v", sorted)
	}
}

func TestTopologicalSort_SingleNode(t *testing.T) {
	agent := agentKey("single")
	mcpServer := mcpServerKey("db")

	graph := NewDependencyGraphBuilder().
		AddDependency(agent, mcpServer).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sorted) != 2 {
		t.Errorf("expected 2 nodes, got %d", len(sorted))
	}

	// mcpServer should come before agent
	mcpIdx := indexOf(sorted, mcpServer)
	agentIdx := indexOf(sorted, agent)
	if mcpIdx >= agentIdx {
		t.Errorf("expected mcpServer before agent, got mcpServer at %d, agent at %d", mcpIdx, agentIdx)
	}
}

func TestTopologicalSort_LinearChain(t *testing.T) {
	// A -> B -> C (A depends on B, B depends on C)
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// C must come before B, B must come before A
	cIdx := indexOf(sorted, c)
	bIdx := indexOf(sorted, b)
	aIdx := indexOf(sorted, a)

	if cIdx >= bIdx {
		t.Errorf("expected C before B")
	}
	if bIdx >= aIdx {
		t.Errorf("expected B before A")
	}
}

func TestTopologicalSort_DiamondPattern(t *testing.T) {
	// A -> B, A -> C, B -> D, C -> D
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")
	d := agentKey("d")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(a, c).
		AddDependency(b, d).
		AddDependency(c, d).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dIdx := indexOf(sorted, d)
	bIdx := indexOf(sorted, b)
	cIdx := indexOf(sorted, c)
	aIdx := indexOf(sorted, a)

	// D must come before B and C
	if dIdx >= bIdx {
		t.Errorf("expected D before B")
	}
	if dIdx >= cIdx {
		t.Errorf("expected D before C")
	}
	// B and C must come before A
	if bIdx >= aIdx {
		t.Errorf("expected B before A")
	}
	if cIdx >= aIdx {
		t.Errorf("expected C before A")
	}
}

func TestTopologicalSort_MultipleIndependentChains(t *testing.T) {
	// Chain 1: a1 -> a2
	// Chain 2: b1 -> b2
	a1 := agentKey("a1")
	a2 := agentKey("a2")
	b1 := agentKey("b1")
	b2 := agentKey("b2")

	graph := NewDependencyGraphBuilder().
		AddDependency(a1, a2).
		AddDependency(b1, b2).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Each chain should be internally ordered
	if indexOf(sorted, a2) >= indexOf(sorted, a1) {
		t.Errorf("expected a2 before a1")
	}
	if indexOf(sorted, b2) >= indexOf(sorted, b1) {
		t.Errorf("expected b2 before b1")
	}
}

func TestTopologicalSort_NoDependenciesFirst(t *testing.T) {
	workflow := workflowKey("main")
	agent := agentKey("etl")
	mcpServer := mcpServerKey("postgres")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflow, agent).
		AddDependency(agent, mcpServer).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// mcpServer (no deps) should come first
	if indexOf(sorted, mcpServer) != 0 {
		t.Errorf("expected mcpServer (no deps) to be first")
	}
}

func TestTopologicalSortSubset(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")
	x := agentKey("x")
	y := agentKey("y")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		AddDependency(x, y).
		Build()

	// Only sort a, b, c
	sorted, err := graph.TopologicalSortSubset([]ResourceKey{a, b, c})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sorted) != 3 {
		t.Errorf("expected 3 nodes in subset sort, got %d", len(sorted))
	}

	if indexOf(sorted, c) >= indexOf(sorted, b) {
		t.Errorf("expected c before b")
	}
	if indexOf(sorted, b) >= indexOf(sorted, a) {
		t.Errorf("expected b before a")
	}
}

func TestTopologicalSort_ReturnsErrorOnCycle(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, a).
		Build()

	_, err := graph.TopologicalSort()
	if err == nil {
		t.Error("expected error for cyclic graph")
	}
}

func TestTopologicalSort_DisconnectedComponents(t *testing.T) {
	// Component 1: workflow -> agent
	// Component 2: standalone skill (no edges, won't appear in graph)
	workflow := workflowKey("w1")
	agent := agentKey("a1")
	skill := skillKey("s1")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflow, agent).
		AddDependency(agent, skill).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sorted) != 3 {
		t.Errorf("expected 3 nodes, got %d", len(sorted))
	}

	// skill should come first (no deps)
	if indexOf(sorted, skill) >= indexOf(sorted, agent) {
		t.Errorf("expected skill before agent")
	}
	if indexOf(sorted, agent) >= indexOf(sorted, workflow) {
		t.Errorf("expected agent before workflow")
	}
}

func TestTopologicalSort_RealWorldStigmerPattern(t *testing.T) {
	// Typical pattern: workflows -> agents -> mcp_servers/skills
	pipeline := workflowKey("data-pipeline")
	etlAgent := agentKey("etl")
	validatorAgent := agentKey("validator")
	postgres := mcpServerKey("postgres")
	dataTransform := skillKey("data-transform")
	validation := skillKey("validation")

	graph := NewDependencyGraphBuilder().
		AddDependency(pipeline, etlAgent).
		AddDependency(pipeline, validatorAgent).
		AddDependency(etlAgent, postgres).
		AddDependency(etlAgent, dataTransform).
		AddDependency(validatorAgent, validation).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Dependencies before dependents
	if indexOf(sorted, postgres) >= indexOf(sorted, etlAgent) {
		t.Errorf("expected postgres before etlAgent")
	}
	if indexOf(sorted, dataTransform) >= indexOf(sorted, etlAgent) {
		t.Errorf("expected dataTransform before etlAgent")
	}
	if indexOf(sorted, validation) >= indexOf(sorted, validatorAgent) {
		t.Errorf("expected validation before validatorAgent")
	}
	if indexOf(sorted, etlAgent) >= indexOf(sorted, pipeline) {
		t.Errorf("expected etlAgent before pipeline")
	}
	if indexOf(sorted, validatorAgent) >= indexOf(sorted, pipeline) {
		t.Errorf("expected validatorAgent before pipeline")
	}
}

// =============================================================================
// Reverse Topological Sort Tests
// =============================================================================

func TestReverseTopologicalSort_EmptyGraph(t *testing.T) {
	graph := EmptyGraph()

	sorted, err := graph.ReverseTopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(sorted) != 0 {
		t.Errorf("expected empty result, got %v", sorted)
	}
}

func TestReverseTopologicalSort_ExactReverse(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		Build()

	forward, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	reverse, err := graph.ReverseTopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Reverse should be exact reverse of forward
	for i := 0; i < len(forward); i++ {
		if forward[i] != reverse[len(reverse)-1-i] {
			t.Errorf("reverse order mismatch at index %d", i)
		}
	}
}

func TestReverseTopologicalSort_DeletionOrder(t *testing.T) {
	// workflow -> agent -> mcp_server
	workflow := workflowKey("w")
	agent := agentKey("a")
	mcpServer := mcpServerKey("m")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflow, agent).
		AddDependency(agent, mcpServer).
		Build()

	sorted, err := graph.ReverseTopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// workflow (dependent) should come before agent and mcpServer (dependencies)
	if indexOf(sorted, workflow) >= indexOf(sorted, agent) {
		t.Errorf("expected workflow before agent in deletion order")
	}
	if indexOf(sorted, agent) >= indexOf(sorted, mcpServer) {
		t.Errorf("expected agent before mcpServer in deletion order")
	}
}

func TestReverseTopologicalSort_ReturnsErrorOnCycle(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		AddDependency(c, a).
		Build()

	_, err := graph.ReverseTopologicalSort()
	if err == nil {
		t.Error("expected error for cyclic graph")
	}
}

// =============================================================================
// Cycle Detection Tests
// =============================================================================

func TestDetectCycle_NoCycleInAcyclicGraph(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		Build()

	cyclePath, hasCycle := graph.DetectCycle()
	if hasCycle {
		t.Errorf("expected no cycle, but found: %v", cyclePath)
	}
}

func TestDetectCycle_SimpleCycle(t *testing.T) {
	// A -> B -> C -> A
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		AddDependency(c, a).
		Build()

	cyclePath, hasCycle := graph.DetectCycle()
	if !hasCycle {
		t.Error("expected cycle to be detected")
	}
	if len(cyclePath) < 2 {
		t.Errorf("expected cycle path with at least 2 nodes, got %d", len(cyclePath))
	}
}

func TestDetectCycle_SelfReference(t *testing.T) {
	// A -> A
	a := agentKey("a")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, a).
		Build()

	_, hasCycle := graph.DetectCycle()
	if !hasCycle {
		t.Error("expected self-reference cycle to be detected")
	}
}

func TestDetectCycle_TwoNodeCycle(t *testing.T) {
	// A -> B -> A
	a := agentKey("a")
	b := agentKey("b")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, a).
		Build()

	_, hasCycle := graph.DetectCycle()
	if !hasCycle {
		t.Error("expected two-node cycle to be detected")
	}
}

func TestDetectCycle_ComplexGraphWithCycle(t *testing.T) {
	// Linear: x -> y -> z
	// Cycle: a -> b -> c -> d -> b
	x := agentKey("x")
	y := agentKey("y")
	z := agentKey("z")
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")
	d := agentKey("d")

	graph := NewDependencyGraphBuilder().
		AddDependency(x, y).
		AddDependency(y, z).
		AddDependency(a, b).
		AddDependency(b, c).
		AddDependency(c, d).
		AddDependency(d, b). // Creates cycle
		Build()

	_, hasCycle := graph.DetectCycle()
	if !hasCycle {
		t.Error("expected cycle to be detected in complex graph")
	}
}

func TestDetectCycle_ReturnsPath(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		AddDependency(c, a).
		Build()

	cyclePath, hasCycle := graph.DetectCycle()
	if !hasCycle {
		t.Fatal("expected cycle")
	}

	// Path should contain the cycle nodes
	if len(cyclePath) < 2 {
		t.Errorf("expected cycle path with at least 2 nodes")
	}

	// First and last should be the same (completing the cycle)
	if len(cyclePath) >= 2 && cyclePath[0] != cyclePath[len(cyclePath)-1] {
		t.Errorf("expected cycle path to start and end with same node")
	}
}

func TestHasCycle_ReturnsBoolean(t *testing.T) {
	tests := []struct {
		name     string
		edges    func() *DependencyGraph
		expected bool
	}{
		{
			name: "acyclic",
			edges: func() *DependencyGraph {
				return NewDependencyGraphBuilder().
					AddDependency(agentKey("a"), agentKey("b")).
					Build()
			},
			expected: false,
		},
		{
			name: "cyclic",
			edges: func() *DependencyGraph {
				return NewDependencyGraphBuilder().
					AddDependency(agentKey("a"), agentKey("b")).
					AddDependency(agentKey("b"), agentKey("a")).
					Build()
			},
			expected: true,
		},
		{
			name: "empty",
			edges: func() *DependencyGraph {
				return EmptyGraph()
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			graph := tt.edges()
			if graph.HasCycle() != tt.expected {
				t.Errorf("expected HasCycle() = %v", tt.expected)
			}
		})
	}
}

func TestDetectCycle_MultipleCycles(t *testing.T) {
	// Two separate cycles
	// Cycle 1: a -> b -> a
	// Cycle 2: x -> y -> z -> x
	a := agentKey("a")
	b := agentKey("b")
	x := agentKey("x")
	y := agentKey("y")
	z := agentKey("z")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, a).
		AddDependency(x, y).
		AddDependency(y, z).
		AddDependency(z, x).
		Build()

	_, hasCycle := graph.DetectCycle()
	if !hasCycle {
		t.Error("expected at least one cycle to be detected")
	}
}

// =============================================================================
// Query Method Tests
// =============================================================================

func TestDependencies_ReturnsCorrectDeps(t *testing.T) {
	workflow := workflowKey("w")
	agent1 := agentKey("a1")
	agent2 := agentKey("a2")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflow, agent1).
		AddDependency(workflow, agent2).
		Build()

	deps := graph.Dependencies(workflow)
	if len(deps) != 2 {
		t.Errorf("expected 2 dependencies, got %d", len(deps))
	}

	hasAgent1 := false
	hasAgent2 := false
	for _, dep := range deps {
		if dep == agent1 {
			hasAgent1 = true
		}
		if dep == agent2 {
			hasAgent2 = true
		}
	}
	if !hasAgent1 || !hasAgent2 {
		t.Error("expected both agents in dependencies")
	}
}

func TestDependencies_ReturnsEmptyForUnknownNode(t *testing.T) {
	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey("a"), agentKey("b")).
		Build()

	deps := graph.Dependencies(agentKey("unknown"))
	if len(deps) != 0 {
		t.Errorf("expected empty slice for unknown node, got %v", deps)
	}
}

func TestDependencies_DefensiveCopy(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		Build()

	deps1 := graph.Dependencies(a)
	deps1[0] = agentKey("modified")

	deps2 := graph.Dependencies(a)
	if deps2[0] != b {
		t.Error("modifying returned slice should not affect graph")
	}
}

func TestDependents_ReturnsCorrectDependents(t *testing.T) {
	mcpServer := mcpServerKey("db")
	agent1 := agentKey("a1")
	agent2 := agentKey("a2")

	graph := NewDependencyGraphBuilder().
		AddDependency(agent1, mcpServer).
		AddDependency(agent2, mcpServer).
		Build()

	dependents := graph.Dependents(mcpServer)
	if len(dependents) != 2 {
		t.Errorf("expected 2 dependents, got %d", len(dependents))
	}
}

func TestDependents_ReturnsEmptyForUnknownNode(t *testing.T) {
	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey("a"), agentKey("b")).
		Build()

	dependents := graph.Dependents(agentKey("unknown"))
	if len(dependents) != 0 {
		t.Errorf("expected empty slice for unknown node, got %v", dependents)
	}
}

func TestAllNodes_ReturnsAllNodes(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(b, c).
		Build()

	nodes := graph.AllNodes()
	if len(nodes) != 3 {
		t.Errorf("expected 3 nodes, got %d", len(nodes))
	}

	nodeSet := make(map[ResourceKey]bool)
	for _, n := range nodes {
		nodeSet[n] = true
	}

	if !nodeSet[a] || !nodeSet[b] || !nodeSet[c] {
		t.Error("expected all nodes to be present")
	}
}

func TestNodeCount_EdgeCount(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")
	c := agentKey("c")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		AddDependency(a, c).
		AddDependency(b, c).
		Build()

	if graph.NodeCount() != 3 {
		t.Errorf("expected 3 nodes, got %d", graph.NodeCount())
	}

	if graph.EdgeCount() != 3 {
		t.Errorf("expected 3 edges, got %d", graph.EdgeCount())
	}
}

func TestHasNode(t *testing.T) {
	a := agentKey("a")
	b := agentKey("b")

	graph := NewDependencyGraphBuilder().
		AddDependency(a, b).
		Build()

	if !graph.HasNode(a) {
		t.Error("expected HasNode(a) to be true")
	}
	if !graph.HasNode(b) {
		t.Error("expected HasNode(b) to be true")
	}
	if graph.HasNode(agentKey("unknown")) {
		t.Error("expected HasNode(unknown) to be false")
	}
}

func TestString_Informative(t *testing.T) {
	t.Run("empty graph", func(t *testing.T) {
		graph := EmptyGraph()
		str := graph.String()
		if str != "DependencyGraph[empty]" {
			t.Errorf("unexpected string for empty graph: %s", str)
		}
	})

	t.Run("non-empty graph", func(t *testing.T) {
		a := agentKey("a")
		b := agentKey("b")

		graph := NewDependencyGraphBuilder().
			AddDependency(a, b).
			Build()

		str := graph.String()
		if str == "" {
			t.Error("expected non-empty string")
		}
		if !contains(str, "DependencyGraph") {
			t.Error("expected string to contain 'DependencyGraph'")
		}
		if !contains(str, "agent:a") {
			t.Error("expected string to contain 'agent:a'")
		}
	})
}

// =============================================================================
// Builder Tests
// =============================================================================

func TestBuilder_AddDependencies(t *testing.T) {
	workflow := workflowKey("w")
	agent1 := agentKey("a1")
	agent2 := agentKey("a2")

	graph := NewDependencyGraphBuilder().
		AddDependencies(workflow, []ResourceKey{agent1, agent2}).
		Build()

	deps := graph.Dependencies(workflow)
	if len(deps) != 2 {
		t.Errorf("expected 2 dependencies, got %d", len(deps))
	}
}

func TestBuilder_Reusable(t *testing.T) {
	builder := NewDependencyGraphBuilder().
		AddDependency(agentKey("a"), agentKey("b"))

	graph1 := builder.Build()
	graph2 := builder.Build()

	if graph1.NodeCount() != graph2.NodeCount() {
		t.Error("builder should produce consistent graphs")
	}
}

func TestBuilder_ChainedCalls(t *testing.T) {
	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey("w1"), agentKey("a1")).
		AddDependency(workflowKey("w2"), agentKey("a2")).
		AddDependencies(agentKey("a1"), []ResourceKey{mcpServerKey("m1"), skillKey("s1")}).
		Build()

	if graph.NodeCount() != 6 {
		t.Errorf("expected 6 nodes, got %d", graph.NodeCount())
	}
}

// =============================================================================
// Real-World Scenario Tests
// =============================================================================

func TestRealWorld_AgentsSharingMcpServers(t *testing.T) {
	// Multiple agents depending on same MCP server
	db := mcpServerKey("database")
	reader := agentKey("reader")
	writer := agentKey("writer")
	main := workflowKey("main")

	graph := NewDependencyGraphBuilder().
		AddDependency(reader, db).
		AddDependency(writer, db).
		AddDependency(main, reader).
		AddDependency(main, writer).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dbIdx := indexOf(sorted, db)
	readerIdx := indexOf(sorted, reader)
	writerIdx := indexOf(sorted, writer)
	mainIdx := indexOf(sorted, main)

	// Database must come before both agents
	if dbIdx >= readerIdx {
		t.Error("expected db before reader")
	}
	if dbIdx >= writerIdx {
		t.Error("expected db before writer")
	}
	// Both agents must come before workflow
	if readerIdx >= mainIdx {
		t.Error("expected reader before main")
	}
	if writerIdx >= mainIdx {
		t.Error("expected writer before main")
	}
}

func TestRealWorld_ComplexDeployment(t *testing.T) {
	// Complex deployment scenario
	// Frontend workflow -> frontend agent -> api mcp server
	// Backend workflow -> backend agent -> database mcp server, cache skill
	// API mcp server depends on database mcp server

	frontendWorkflow := workflowKey("frontend")
	backendWorkflow := workflowKey("backend")
	frontendAgent := agentKey("frontend-agent")
	backendAgent := agentKey("backend-agent")
	apiServer := mcpServerKey("api")
	dbServer := mcpServerKey("database")
	cacheSkill := skillKey("cache")

	graph := NewDependencyGraphBuilder().
		AddDependency(frontendWorkflow, frontendAgent).
		AddDependency(frontendAgent, apiServer).
		AddDependency(backendWorkflow, backendAgent).
		AddDependency(backendAgent, dbServer).
		AddDependency(backendAgent, cacheSkill).
		AddDependency(apiServer, dbServer).
		Build()

	sorted, err := graph.TopologicalSort()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify critical ordering constraints
	// dbServer and cacheSkill should come first (no deps)
	// apiServer should come after dbServer
	// agents should come after their deps
	// workflows should come last

	if indexOf(sorted, dbServer) >= indexOf(sorted, apiServer) {
		t.Error("expected dbServer before apiServer")
	}
	if indexOf(sorted, apiServer) >= indexOf(sorted, frontendAgent) {
		t.Error("expected apiServer before frontendAgent")
	}
	if indexOf(sorted, frontendAgent) >= indexOf(sorted, frontendWorkflow) {
		t.Error("expected frontendAgent before frontendWorkflow")
	}
	if indexOf(sorted, dbServer) >= indexOf(sorted, backendAgent) {
		t.Error("expected dbServer before backendAgent")
	}
	if indexOf(sorted, cacheSkill) >= indexOf(sorted, backendAgent) {
		t.Error("expected cacheSkill before backendAgent")
	}
	if indexOf(sorted, backendAgent) >= indexOf(sorted, backendWorkflow) {
		t.Error("expected backendAgent before backendWorkflow")
	}
}

// =============================================================================
// Helper Functions
// =============================================================================

func indexOf(slice []ResourceKey, key ResourceKey) int {
	for i, k := range slice {
		if k == key {
			return i
		}
	}
	return -1
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsAt(s, substr, 0))
}

func containsAt(s, substr string, start int) bool {
	for i := start; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
