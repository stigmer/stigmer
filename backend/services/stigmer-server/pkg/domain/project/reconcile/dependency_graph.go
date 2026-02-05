package reconcile

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// emptyGraph is a singleton empty DependencyGraph for reuse.
var emptyGraph = &DependencyGraph{
	edges:      make(map[ResourceKey][]ResourceKey),
	nodeSet:    make(map[ResourceKey]struct{}),
	dependents: make(map[ResourceKey][]ResourceKey),
}

// DependencyGraph is an immutable value object representing resource dependencies.
//
// The graph is used to determine execution order during reconciliation:
//   - Resources must be created in dependency order (dependencies first)
//   - Resources must be deleted in reverse dependency order (dependents first)
//
// The edges map represents "depends on" relationships:
//
//	edges["workflow:data-pipeline"] = ["agent:etl-agent", "agent:validator-agent"]
//
// This means the workflow depends on two agents and must be created after them.
//
// Typical dependency patterns in Stigmer:
//
//	MCP Servers (no dependencies) <- leaf nodes
//	Skills (no dependencies)      <- leaf nodes
//	Agents -> depend on MCP Servers, Skills
//	Workflows -> depend on Agents
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions
//   - Getters return defensive copies to prevent external mutation
//   - There are no setters
//
// Example:
//
//	graph := NewDependencyGraphBuilder().
//	    AddDependency(workflowKey, agentKey).
//	    AddDependency(agentKey, mcpServerKey).
//	    Build()
//
//	order, err := graph.TopologicalSort()
//	if err != nil {
//	    // Handle cycle
//	}
//	// order: [mcpServerKey, agentKey, workflowKey]
type DependencyGraph struct {
	edges      map[ResourceKey][]ResourceKey // dependent -> dependencies (what it depends on)
	nodeSet    map[ResourceKey]struct{}      // all nodes in graph (precomputed)
	dependents map[ResourceKey][]ResourceKey // reverse index: dependency -> dependents
}

// NewDependencyGraph creates a new DependencyGraph with the given edges.
//
// The edges map should have the format: dependent -> [dependencies].
// The constructor performs deep defensive copying and precomputes auxiliary indices.
// Nil maps and nil/empty slices are handled gracefully.
//
// Example:
//
//	edges := map[ResourceKey][]ResourceKey{
//	    workflowKey: {agentKey},
//	    agentKey:    {mcpServerKey, skillKey},
//	}
//	graph := NewDependencyGraph(edges)
func NewDependencyGraph(edges map[ResourceKey][]ResourceKey) *DependencyGraph {
	if edges == nil || len(edges) == 0 {
		return emptyGraph
	}

	// Deep defensive copy of edges
	edgesCopy := make(map[ResourceKey][]ResourceKey, len(edges))
	nodeSet := make(map[ResourceKey]struct{})
	dependents := make(map[ResourceKey][]ResourceKey)

	for dependent, deps := range edges {
		if len(deps) == 0 {
			continue // Skip entries with no dependencies
		}

		// Clone the dependencies slice
		depsCopy := slices.Clone(deps)
		edgesCopy[dependent] = depsCopy

		// Add dependent to node set
		nodeSet[dependent] = struct{}{}

		// Add dependencies to node set and build reverse index
		for _, dep := range depsCopy {
			nodeSet[dep] = struct{}{}
			dependents[dep] = append(dependents[dep], dependent)
		}
	}

	if len(edgesCopy) == 0 {
		return emptyGraph
	}

	return &DependencyGraph{
		edges:      edgesCopy,
		nodeSet:    nodeSet,
		dependents: dependents,
	}
}

// EmptyGraph returns a singleton empty DependencyGraph.
//
// This is more efficient than creating new empty graphs repeatedly.
// Use this when there are no dependencies between resources.
func EmptyGraph() *DependencyGraph {
	return emptyGraph
}

// IsEmpty returns true if the graph has no edges.
func (g *DependencyGraph) IsEmpty() bool {
	return len(g.edges) == 0
}

// NodeCount returns the total number of unique nodes in the graph.
//
// This includes both dependents (keys in edges) and dependencies (values).
func (g *DependencyGraph) NodeCount() int {
	return len(g.nodeSet)
}

// EdgeCount returns the total number of dependency edges in the graph.
func (g *DependencyGraph) EdgeCount() int {
	count := 0
	for _, deps := range g.edges {
		count += len(deps)
	}
	return count
}

// HasNode returns true if the key exists in the graph (as dependent or dependency).
func (g *DependencyGraph) HasNode(key ResourceKey) bool {
	_, exists := g.nodeSet[key]
	return exists
}

// Dependencies returns the resources that the given key depends on.
//
// Returns an empty slice if the key has no dependencies or doesn't exist.
// The returned slice is a defensive copy.
func (g *DependencyGraph) Dependencies(key ResourceKey) []ResourceKey {
	deps, ok := g.edges[key]
	if !ok {
		return []ResourceKey{}
	}
	return slices.Clone(deps)
}

// Dependents returns the resources that depend on the given key.
//
// Returns an empty slice if nothing depends on this key or it doesn't exist.
// The returned slice is a defensive copy.
func (g *DependencyGraph) Dependents(key ResourceKey) []ResourceKey {
	deps, ok := g.dependents[key]
	if !ok {
		return []ResourceKey{}
	}
	return slices.Clone(deps)
}

// AllNodes returns all unique nodes in the graph.
//
// The returned slice is a defensive copy sorted by string representation
// for deterministic ordering.
func (g *DependencyGraph) AllNodes() []ResourceKey {
	if len(g.nodeSet) == 0 {
		return []ResourceKey{}
	}

	nodes := make([]ResourceKey, 0, len(g.nodeSet))
	for node := range g.nodeSet {
		nodes = append(nodes, node)
	}

	// Sort for deterministic output
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].String() < nodes[j].String()
	})

	return nodes
}

// TopologicalSort returns resources in dependency order using Kahn's algorithm.
//
// Dependencies come before dependents in the result. Resources with no
// dependencies (leaf nodes like MCP Servers and Skills) come first.
// This is the order for creation operations.
//
// Returns an error if a cycle is detected.
//
// Example:
//
//	// Given: workflow -> agent -> mcp_server
//	order, err := graph.TopologicalSort()
//	// order: [mcp_server, agent, workflow]
func (g *DependencyGraph) TopologicalSort() ([]ResourceKey, error) {
	return g.topologicalSortNodes(g.AllNodes())
}

// TopologicalSortSubset returns a subset of nodes in dependency order.
//
// Only the specified nodes are included in the result, but their dependency
// relationships within the graph are still respected.
//
// Returns an error if a cycle is detected among the subset nodes.
func (g *DependencyGraph) TopologicalSortSubset(nodes []ResourceKey) ([]ResourceKey, error) {
	return g.topologicalSortNodes(nodes)
}

// topologicalSortNodes implements Kahn's algorithm for topological sorting.
func (g *DependencyGraph) topologicalSortNodes(nodesToSort []ResourceKey) ([]ResourceKey, error) {
	if len(nodesToSort) == 0 {
		return []ResourceKey{}, nil
	}

	// Build set of nodes to sort for O(1) lookup
	nodeSet := make(map[ResourceKey]struct{}, len(nodesToSort))
	for _, node := range nodesToSort {
		nodeSet[node] = struct{}{}
	}

	// Compute in-degree (count of dependencies within the subset)
	inDegree := make(map[ResourceKey]int, len(nodesToSort))
	for _, node := range nodesToSort {
		inDegree[node] = 0
	}

	for _, node := range nodesToSort {
		for _, dep := range g.edges[node] {
			if _, inSubset := nodeSet[dep]; inSubset {
				inDegree[node]++
			}
		}
	}

	// Initialize queue with nodes having no dependencies (in-degree 0)
	// Use sorted order for deterministic results
	queue := make([]ResourceKey, 0)
	for _, node := range nodesToSort {
		if inDegree[node] == 0 {
			queue = append(queue, node)
		}
	}
	sort.Slice(queue, func(i, j int) bool {
		return queue[i].String() < queue[j].String()
	})

	result := make([]ResourceKey, 0, len(nodesToSort))

	for len(queue) > 0 {
		// Dequeue (FIFO)
		current := queue[0]
		queue = queue[1:]
		result = append(result, current)

		// For each node that depends on current, decrement its in-degree
		for _, dependent := range g.dependents[current] {
			if _, inSubset := nodeSet[dependent]; !inSubset {
				continue
			}

			inDegree[dependent]--
			if inDegree[dependent] == 0 {
				// Insert in sorted position for deterministic ordering
				insertIdx := sort.Search(len(queue), func(i int) bool {
					return queue[i].String() >= dependent.String()
				})
				queue = slices.Insert(queue, insertIdx, dependent)
			}
		}
	}

	// If we couldn't process all nodes, there's a cycle
	if len(result) != len(nodesToSort) {
		cyclePath, hasCycle := g.DetectCycle()
		if hasCycle {
			return nil, fmt.Errorf("circular dependency detected: %s", formatCyclePath(cyclePath))
		}
		return nil, fmt.Errorf("circular dependency detected in graph")
	}

	return result, nil
}

// ReverseTopologicalSort returns resources in reverse dependency order.
//
// Dependents come before dependencies in the result. This is the order
// for deletion operations (delete dependents before their dependencies).
//
// Returns an error if a cycle is detected.
//
// Example:
//
//	// Given: workflow -> agent -> mcp_server
//	order, err := graph.ReverseTopologicalSort()
//	// order: [workflow, agent, mcp_server]
func (g *DependencyGraph) ReverseTopologicalSort() ([]ResourceKey, error) {
	sorted, err := g.TopologicalSort()
	if err != nil {
		return nil, err
	}

	slices.Reverse(sorted)
	return sorted, nil
}

// DetectCycle checks for cycles in the graph using DFS.
//
// Returns the cycle path and true if a cycle exists, empty slice and false otherwise.
// The cycle path shows the nodes involved in the cycle for debugging.
func (g *DependencyGraph) DetectCycle() ([]ResourceKey, bool) {
	visited := make(map[ResourceKey]struct{})
	recursionStack := make(map[ResourceKey]struct{})
	path := make([]ResourceKey, 0)

	// Process nodes in deterministic order
	for _, node := range g.AllNodes() {
		if _, seen := visited[node]; !seen {
			if cyclePath, hasCycle := g.detectCycleDFS(node, visited, recursionStack, path); hasCycle {
				return cyclePath, true
			}
		}
	}

	return []ResourceKey{}, false
}

// detectCycleDFS performs DFS cycle detection with path tracking.
func (g *DependencyGraph) detectCycleDFS(
	node ResourceKey,
	visited map[ResourceKey]struct{},
	recursionStack map[ResourceKey]struct{},
	path []ResourceKey,
) ([]ResourceKey, bool) {
	visited[node] = struct{}{}
	recursionStack[node] = struct{}{}
	path = append(path, node)

	for _, dep := range g.edges[node] {
		if _, seen := visited[dep]; !seen {
			if cyclePath, hasCycle := g.detectCycleDFS(dep, visited, recursionStack, path); hasCycle {
				return cyclePath, true
			}
		} else if _, inStack := recursionStack[dep]; inStack {
			// Found a cycle - extract the cycle path
			cycleStart := -1
			for i, p := range path {
				if p == dep {
					cycleStart = i
					break
				}
			}
			if cycleStart >= 0 {
				cyclePath := make([]ResourceKey, len(path)-cycleStart+1)
				copy(cyclePath, path[cycleStart:])
				cyclePath[len(cyclePath)-1] = dep // Complete the cycle
				return cyclePath, true
			}
			return path, true
		}
	}

	delete(recursionStack, node)
	return nil, false
}

// HasCycle returns true if the graph contains a cycle.
func (g *DependencyGraph) HasCycle() bool {
	_, hasCycle := g.DetectCycle()
	return hasCycle
}

// String returns a formatted string representation of the graph.
//
// Implements fmt.Stringer for clean printing and logging.
func (g *DependencyGraph) String() string {
	if g.IsEmpty() {
		return "DependencyGraph[empty]"
	}

	var sb strings.Builder
	sb.WriteString("DependencyGraph[\n")

	// Sort keys for deterministic output
	keys := make([]ResourceKey, 0, len(g.edges))
	for k := range g.edges {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return keys[i].String() < keys[j].String()
	})

	for _, key := range keys {
		deps := g.edges[key]
		if len(deps) > 0 {
			depStrs := make([]string, len(deps))
			for i, dep := range deps {
				depStrs[i] = dep.String()
			}
			sort.Strings(depStrs)
			sb.WriteString(fmt.Sprintf("  %s -> [%s]\n", key, strings.Join(depStrs, ", ")))
		}
	}

	sb.WriteString("]")
	return sb.String()
}

// formatCyclePath formats a cycle path for error messages.
func formatCyclePath(path []ResourceKey) string {
	strs := make([]string, len(path))
	for i, p := range path {
		strs[i] = p.String()
	}
	return strings.Join(strs, " -> ")
}

// DependencyGraphBuilder provides incremental construction of a DependencyGraph.
//
// Use the builder when constructing the graph edge by edge, such as when
// discovering dependencies via reflection.
//
// Example:
//
//	graph := NewDependencyGraphBuilder().
//	    AddDependency(workflowKey, agentKey).
//	    AddDependency(agentKey, mcpServerKey).
//	    AddDependency(agentKey, skillKey).
//	    Build()
type DependencyGraphBuilder struct {
	edges map[ResourceKey][]ResourceKey
}

// NewDependencyGraphBuilder creates a new builder for constructing a DependencyGraph.
func NewDependencyGraphBuilder() *DependencyGraphBuilder {
	return &DependencyGraphBuilder{
		edges: make(map[ResourceKey][]ResourceKey),
	}
}

// AddDependency adds a single dependency edge.
//
// The dependent depends on the dependency (dependent must be created after dependency).
// Returns the builder for method chaining.
func (b *DependencyGraphBuilder) AddDependency(dependent, dependency ResourceKey) *DependencyGraphBuilder {
	b.edges[dependent] = append(b.edges[dependent], dependency)
	return b
}

// AddDependencies adds multiple dependencies for a single dependent.
//
// All dependencies must be created before the dependent.
// Returns the builder for method chaining.
func (b *DependencyGraphBuilder) AddDependencies(dependent ResourceKey, deps []ResourceKey) *DependencyGraphBuilder {
	b.edges[dependent] = append(b.edges[dependent], deps...)
	return b
}

// Build creates the immutable DependencyGraph from the builder's edges.
//
// The builder can be reused after calling Build.
func (b *DependencyGraphBuilder) Build() *DependencyGraph {
	return NewDependencyGraph(b.edges)
}
