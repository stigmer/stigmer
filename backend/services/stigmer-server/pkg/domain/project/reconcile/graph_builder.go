package reconcile

import (
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// BuildDependencyGraph constructs a DependencyGraph from a DesiredState.
//
// The function iterates all resources in the desired state, discovers their
// dependencies via proto reflection, and builds a graph where edges represent
// "depends on" relationships. Only dependencies that exist within the
// DesiredState are included in the graph.
//
// The algorithm:
//  1. Iterate all resources (agents, workflows, mcp_servers, skills)
//  2. For each resource, use DiscoverDependencies to find ApiResourceReference fields
//  3. Convert references to ResourceKeys and filter to only those in DesiredState
//  4. Add edges to the graph builder
//  5. Build and return the immutable graph
//
// Returns EmptyGraph() for nil or empty DesiredState.
//
// Example:
//
//	desired := NewDesiredState(agents, workflows, mcpServers, skills)
//	graph := BuildDependencyGraph(desired)
//	order, err := graph.TopologicalSort()
//	// order contains resources in dependency order for creation
func BuildDependencyGraph(desired *DesiredState) *DependencyGraph {
	if desired == nil || desired.IsEmpty() {
		return EmptyGraph()
	}

	builder := NewDependencyGraphBuilder()

	// Process agents - most commonly have dependencies on skills and MCP servers
	for slug, agent := range desired.Agents() {
		dependentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
		addDependenciesToBuilder(builder, dependentKey, agent, desired)
	}

	// Process workflows - may reference agents in the future
	for slug, workflow := range desired.Workflows() {
		dependentKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
		addDependenciesToBuilder(builder, dependentKey, workflow, desired)
	}

	// Process MCP servers - typically leaf nodes with no dependencies
	for slug, mcpServer := range desired.McpServers() {
		dependentKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
		addDependenciesToBuilder(builder, dependentKey, mcpServer, desired)
	}

	// Process skills - typically leaf nodes with no dependencies
	for slug, skill := range desired.Skills() {
		dependentKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug)
		addDependenciesToBuilder(builder, dependentKey, skill, desired)
	}

	return builder.Build()
}

// addDependenciesToBuilder discovers dependencies in a resource and adds them to the builder.
//
// Only dependencies that exist in the DesiredState are added. This ensures the graph
// only contains nodes that will be reconciled as part of the project.
//
// Invalid references (nil, empty slug, unsupported kind) are silently skipped.
func addDependenciesToBuilder(
	builder *DependencyGraphBuilder,
	dependent ResourceKey,
	resource proto.Message,
	desired *DesiredState,
) {
	if resource == nil {
		return
	}

	refs := DiscoverDependencies(resource)
	for _, ref := range refs {
		depKey, err := ToResourceKey(ref)
		if err != nil || depKey.IsZero() {
			continue // Skip invalid references
		}
		if !desired.HasResource(depKey) {
			continue // Only track dependencies within the DesiredState
		}
		builder.AddDependency(dependent, depKey)
	}
}
