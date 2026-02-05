package reconcile

import (
	"slices"
	"sort"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// deletionKindOrder defines the safe order for deleting resources by kind.
//
// Workflows are deleted first because they may reference Agents.
// Agents are deleted second because they may reference MCP Servers and Skills.
// MCP Servers and Skills are leaf nodes with no dependencies, deleted last.
//
// This order ensures that dependents are always deleted before their dependencies,
// preventing "resource in use" errors during deletion.
var deletionKindOrder = []apiresourcekind.ApiResourceKind{
	apiresourcekind.ApiResourceKind_workflow,
	apiresourcekind.ApiResourceKind_agent,
	apiresourcekind.ApiResourceKind_mcp_server,
	apiresourcekind.ApiResourceKind_skill,
}

// creationKindOrder defines the safe order for creating resources by kind.
//
// This is the reverse of deletionKindOrder. Leaf nodes (Skills, MCP Servers)
// are created first, then Agents that depend on them, then Workflows.
//
// This order ensures that dependencies are always created before their dependents.
var creationKindOrder = []apiresourcekind.ApiResourceKind{
	apiresourcekind.ApiResourceKind_skill,
	apiresourcekind.ApiResourceKind_mcp_server,
	apiresourcekind.ApiResourceKind_agent,
	apiresourcekind.ApiResourceKind_workflow,
}

// GetChangesInExecutionOrder returns creates and updates in dependency order.
//
// Dependencies come before dependents in the result. For example, if an Agent
// depends on an MCP Server, the MCP Server will appear before the Agent.
//
// When a dependency graph is available, the method uses topological sorting
// to determine the correct order. When no graph is available (or on cycle
// detection), it falls back to kind-based ordering:
//
//	Skills -> MCP Servers -> Agents -> Workflows
//
// Within the same precedence level, resources are sorted by slug for
// deterministic, reproducible results.
//
// Example:
//
//	plan := ComputeDiff(desired, actual, graph)
//	for _, change := range plan.GetChangesInExecutionOrder() {
//	    if err := executeChange(change); err != nil {
//	        // Handle error, but dependencies are already created
//	    }
//	}
func (p *ReconciliationPlan) GetChangesInExecutionOrder() []ResourceChange {
	// Combine creates and updates (both need dependency ordering)
	changes := make([]ResourceChange, 0, len(p.creates)+len(p.updates))
	changes = append(changes, p.creates...)
	changes = append(changes, p.updates...)

	if len(changes) == 0 {
		return changes
	}

	// If no graph available, use kind-based ordering
	if p.graph == nil || p.graph.IsEmpty() {
		return sortByKindAndSlug(changes, creationKindOrder)
	}

	// Try topological sort using the dependency graph
	return orderByTopologicalSort(changes, p.graph, creationKindOrder)
}

// GetDeletesInReverseDependencyOrder returns deletes in safe deletion order.
//
// Dependents come before dependencies in the result. For example, if a Workflow
// references an Agent, the Workflow will be deleted before the Agent.
//
// When a dependency graph is available and covers all delete candidates, the
// method uses reverse topological sorting. Otherwise, it falls back to
// kind-based hierarchy:
//
//	Workflows -> Agents -> MCP Servers -> Skills
//
// Within the same kind, resources are sorted by slug for deterministic results.
//
// Note: Orphan resources (those being deleted) may not have edges in the
// dependency graph (which was built from desired state). The kind hierarchy
// fallback handles this case safely.
//
// Example:
//
//	plan := ComputeDiff(desired, actual, graph)
//	for _, change := range plan.GetDeletesInReverseDependencyOrder() {
//	    if err := deleteResource(change); err != nil {
//	        // Handle error, but dependents are already deleted
//	    }
//	}
func (p *ReconciliationPlan) GetDeletesInReverseDependencyOrder() []ResourceChange {
	if len(p.deletes) == 0 {
		return []ResourceChange{}
	}

	// Prepare kind-sorted fallback order
	sortedByKind := sortByKindAndSlug(p.deletes, deletionKindOrder)

	// If no graph available, return kind-sorted order
	if p.graph == nil || p.graph.IsEmpty() {
		return sortedByKind
	}

	// Try reverse topological sort
	result := orderByReverseTopologicalSort(p.deletes, p.graph)

	// If topo sort doesn't cover all deletes, fall back to kind order
	if len(result) != len(p.deletes) {
		return sortedByKind
	}

	return result
}

// orderByTopologicalSort orders changes using the dependency graph.
//
// Returns changes in topological order (dependencies first).
// Falls back to kind-based ordering on cycle detection or if graph
// doesn't cover all changes.
func orderByTopologicalSort(changes []ResourceChange, graph *DependencyGraph, fallbackOrder []apiresourcekind.ApiResourceKind) []ResourceChange {
	// Extract keys and build lookup map
	keys := extractKeys(changes)
	changeMap := buildChangeMap(changes)

	// Topological sort the keys
	sorted, err := graph.TopologicalSortSubset(keys)
	if err != nil {
		// Cycle detected - fall back to kind ordering
		return sortByKindAndSlug(changes, fallbackOrder)
	}

	// Map sorted keys back to changes
	result := make([]ResourceChange, 0, len(sorted))
	for _, key := range sorted {
		if change, ok := changeMap[key]; ok {
			result = append(result, change)
		}
	}

	// If some changes weren't in the graph, add them sorted by kind
	if len(result) < len(changes) {
		result = appendMissingChanges(result, changes, changeMap, fallbackOrder)
	}

	return result
}

// orderByReverseTopologicalSort orders changes for deletion (dependents first).
//
// Returns changes in reverse topological order.
// Returns partial results if graph doesn't cover all changes.
func orderByReverseTopologicalSort(changes []ResourceChange, graph *DependencyGraph) []ResourceChange {
	keys := extractKeys(changes)
	changeMap := buildChangeMap(changes)

	// Check if all keys are actually in the graph
	// If any key is not in the graph, return empty to trigger fallback
	for _, key := range keys {
		if !graph.HasNode(key) {
			// Not all nodes are in the graph - fallback to kind order
			return []ResourceChange{}
		}
	}

	// Topological sort the keys
	sorted, err := graph.TopologicalSortSubset(keys)
	if err != nil {
		// Cycle detected - return empty to trigger fallback
		return []ResourceChange{}
	}

	// Reverse for deletion order
	slices.Reverse(sorted)

	// Map sorted keys back to changes
	result := make([]ResourceChange, 0, len(sorted))
	for _, key := range sorted {
		if change, ok := changeMap[key]; ok {
			result = append(result, change)
		}
	}

	return result
}

// sortByKindAndSlug sorts changes by kind hierarchy, then by slug.
//
// The kindOrder parameter determines the priority of each kind.
// Earlier kinds in the order appear first in the result.
// Within the same kind, resources are sorted alphabetically by slug.
func sortByKindAndSlug(changes []ResourceChange, kindOrder []apiresourcekind.ApiResourceKind) []ResourceChange {
	result := slices.Clone(changes)

	sort.SliceStable(result, func(i, j int) bool {
		iPriority := kindPriority(result[i].Key().Kind(), kindOrder)
		jPriority := kindPriority(result[j].Key().Kind(), kindOrder)

		if iPriority != jPriority {
			return iPriority < jPriority
		}
		// Same kind - sort by slug
		return result[i].Key().Slug() < result[j].Key().Slug()
	})

	return result
}

// kindPriority returns the sort priority for a kind based on the given order.
//
// Lower values indicate higher priority (appear earlier in sorted results).
// Unknown kinds get the highest priority value (appear last).
func kindPriority(kind apiresourcekind.ApiResourceKind, kindOrder []apiresourcekind.ApiResourceKind) int {
	for i, k := range kindOrder {
		if k == kind {
			return i
		}
	}
	// Unknown kind - put at end
	return len(kindOrder)
}

// extractKeys extracts ResourceKeys from a slice of changes.
func extractKeys(changes []ResourceChange) []ResourceKey {
	keys := make([]ResourceKey, len(changes))
	for i, change := range changes {
		keys[i] = change.Key()
	}
	return keys
}

// buildChangeMap creates a map from ResourceKey to ResourceChange for O(1) lookup.
func buildChangeMap(changes []ResourceChange) map[ResourceKey]ResourceChange {
	m := make(map[ResourceKey]ResourceChange, len(changes))
	for _, change := range changes {
		m[change.Key()] = change
	}
	return m
}

// appendMissingChanges adds changes that weren't in the sorted result.
//
// This handles edge cases where the graph doesn't include all resources.
// Missing changes are sorted by kind and appended to the result.
func appendMissingChanges(
	result []ResourceChange,
	allChanges []ResourceChange,
	alreadyIncluded map[ResourceKey]ResourceChange,
	kindOrder []apiresourcekind.ApiResourceKind,
) []ResourceChange {
	// Find changes not yet in result
	resultSet := make(map[ResourceKey]struct{}, len(result))
	for _, change := range result {
		resultSet[change.Key()] = struct{}{}
	}

	var missing []ResourceChange
	for _, change := range allChanges {
		if _, exists := resultSet[change.Key()]; !exists {
			missing = append(missing, change)
		}
	}

	if len(missing) == 0 {
		return result
	}

	// Sort missing by kind and slug, then append
	sortedMissing := sortByKindAndSlug(missing, kindOrder)
	return append(result, sortedMissing...)
}
