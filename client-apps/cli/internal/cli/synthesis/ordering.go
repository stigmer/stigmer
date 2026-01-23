package synthesis

import (
	"fmt"
	"sort"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"
)

// ResourceWithID pairs a proto resource with its ID for ordering.
type ResourceWithID struct {
	ID       string
	Resource proto.Message
}

// GetOrderedResources returns all resources in topological dependency order.
//
// Skills are created first (they have no dependencies).
// Then agents (which may depend on skills).
// Then workflows (which may depend on agents).
//
// Within each category, resources are ordered by their dependencies.
//
// Returns an error if circular dependencies are detected.
func (r *Result) GetOrderedResources() ([]*ResourceWithID, error) {
	// Build a list of all resources with their IDs
	allResources := make([]*ResourceWithID, 0, r.TotalResources())

	// Add skills first (no dependencies)
	for _, skill := range r.Skills {
		id := GetResourceID(skill)
		allResources = append(allResources, &ResourceWithID{
			ID:       id,
			Resource: skill,
		})
	}

	// Add agents
	for _, agent := range r.Agents {
		id := GetResourceID(agent)
		allResources = append(allResources, &ResourceWithID{
			ID:       id,
			Resource: agent,
		})
	}

	// Add workflows
	for _, workflow := range r.Workflows {
		id := GetResourceID(workflow)
		allResources = append(allResources, &ResourceWithID{
			ID:       id,
			Resource: workflow,
		})
	}

	// Perform topological sort
	sorted, err := topologicalSort(allResources, r.Dependencies)
	if err != nil {
		return nil, errors.Wrap(err, "failed to order resources by dependencies")
	}

	return sorted, nil
}

// topologicalSort performs a topological sort using Kahn's algorithm.
//
// Algorithm:
// 1. Find all nodes with no incoming edges (no dependencies)
// 2. Add them to the result
// 3. Remove their outgoing edges
// 4. Repeat until all nodes are processed or a cycle is detected
//
// Returns sorted resources or an error if a circular dependency is found.
func topologicalSort(resources []*ResourceWithID, deps map[string][]string) ([]*ResourceWithID, error) {
	// Build a map of resource ID to resource
	resourceMap := make(map[string]*ResourceWithID)
	for _, res := range resources {
		resourceMap[res.ID] = res
	}

	// Calculate in-degree (number of dependencies) for each resource
	inDegree := make(map[string]int)
	for _, res := range resources {
		inDegree[res.ID] = 0 // Initialize all to 0
	}

	// Count incoming edges (dependencies)
	for resourceID, dependencies := range deps {
		for _, depID := range dependencies {
			// Only count dependencies that exist in our resource set
			if _, exists := resourceMap[depID]; exists {
				inDegree[resourceID]++
			}
		}
	}

	// Find all resources with no dependencies (in-degree = 0)
	queue := make([]string, 0)
	for resourceID, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, resourceID)
		}
	}

	// Sort queue for deterministic output
	sort.Strings(queue)

	// Process resources in topological order
	result := make([]*ResourceWithID, 0, len(resources))

	for len(queue) > 0 {
		// Pop first resource from queue
		currentID := queue[0]
		queue = queue[1:]

		// Add to result
		if res, exists := resourceMap[currentID]; exists {
			result = append(result, res)
		}

		// Process all resources that depend on the current one
		for resourceID, dependencies := range deps {
			// Check if resourceID depends on currentID
			hasDep := false
			for _, depID := range dependencies {
				if depID == currentID {
					hasDep = true
					break
				}
			}

			if hasDep {
				// Reduce in-degree
				inDegree[resourceID]--

				// If no more dependencies, add to queue
				if inDegree[resourceID] == 0 {
					queue = append(queue, resourceID)
					// Sort queue for deterministic output
					sort.Strings(queue)
				}
			}
		}
	}

	// Check for circular dependencies
	if len(result) != len(resources) {
		// Find resources that weren't processed (part of cycle)
		unprocessed := make([]string, 0)
		for _, res := range resources {
			found := false
			for _, sorted := range result {
				if sorted.ID == res.ID {
					found = true
					break
				}
			}
			if !found {
				unprocessed = append(unprocessed, res.ID)
			}
		}

		return nil, errors.Errorf(
			"circular dependency detected among resources: %v\nProcessed %d of %d resources",
			unprocessed,
			len(result),
			len(resources),
		)
	}

	return result, nil
}

// ValidateDependencies checks if all dependencies reference valid resources.
//
// Returns an error if any dependency references a non-existent resource.
func (r *Result) ValidateDependencies() error {
	// Build set of valid resource IDs
	validIDs := make(map[string]bool)

	for _, skill := range r.Skills {
		validIDs[GetResourceID(skill)] = true
	}
	for _, agent := range r.Agents {
		validIDs[GetResourceID(agent)] = true
	}
	for _, workflow := range r.Workflows {
		validIDs[GetResourceID(workflow)] = true
	}

	// Check all dependencies
	for resourceID, deps := range r.Dependencies {
		// Check if the resource itself exists
		if !validIDs[resourceID] {
			return errors.Errorf("dependency map references non-existent resource: %s", resourceID)
		}

		// Check if all dependencies exist
		for _, depID := range deps {
			// Skip external references (e.g., "skill:external:some-slug")
			if isExternalReference(depID) {
				continue
			}

			if !validIDs[depID] {
				return errors.Errorf(
					"resource %s depends on non-existent resource: %s",
					resourceID,
					depID,
				)
			}
		}
	}

	return nil
}

// isExternalReference checks if a resource ID refers to an external resource.
//
// External resources have the format: "{type}:external:{slug}"
// Example: "skill:external:platform-security"
func isExternalReference(resourceID string) bool {
	// Simple check: external references contain ":external:"
	// Check minimum length and look for the ":external:" substring
	if len(resourceID) < 15 {
		return false
	}
	// Check if it contains ":external:"
	for i := 0; i <= len(resourceID)-10; i++ {
		if i+10 <= len(resourceID) && resourceID[i:i+10] == ":external:" {
			return true
		}
	}
	return false
}

// GetDependencyGraph returns a human-readable representation of the dependency graph.
func (r *Result) GetDependencyGraph() string {
	if len(r.Dependencies) == 0 {
		return "No dependencies"
	}

	var result string
	result += fmt.Sprintf("Dependency Graph (%d edges):\n", countDependencies(r.Dependencies))

	// Sort resource IDs for consistent output
	resourceIDs := make([]string, 0, len(r.Dependencies))
	for id := range r.Dependencies {
		resourceIDs = append(resourceIDs, id)
	}
	sort.Strings(resourceIDs)

	for _, resourceID := range resourceIDs {
		deps := r.Dependencies[resourceID]
		if len(deps) > 0 {
			result += fmt.Sprintf("  %s → %v\n", resourceID, deps)
		}
	}

	return result
}

// GetDependencyGraphMermaid returns a Mermaid diagram representation of the dependency graph.
//
// The generated diagram uses a left-to-right flowchart format with:
// - Different shapes for different resource types (skills, agents, workflows)
// - Arrows showing dependency relationships
// - Color coding by resource type
//
// Example output:
//
//	```mermaid
//	flowchart LR
//	  skill_coding[skill:coding]:::skill
//	  agent_reviewer[agent:reviewer]:::agent
//	  workflow_pr[workflow:pr-review]:::workflow
//	  skill_coding --> agent_reviewer
//	  agent_reviewer --> workflow_pr
//	  classDef skill fill:#e1f5e1,stroke:#4caf50
//	  classDef agent fill:#e3f2fd,stroke:#2196f3
//	  classDef workflow fill:#fff3e0,stroke:#ff9800
//	```
func (r *Result) GetDependencyGraphMermaid() string {
	// Collect all resource IDs
	allResources := make(map[string]bool)
	
	// Add resources from skills, agents, workflows
	for _, skill := range r.Skills {
		allResources[GetResourceID(skill)] = true
	}
	for _, agent := range r.Agents {
		allResources[GetResourceID(agent)] = true
	}
	for _, workflow := range r.Workflows {
		allResources[GetResourceID(workflow)] = true
	}

	if len(allResources) == 0 {
		return "```mermaid\nflowchart LR\n  empty[No resources]\n```"
	}

	var result string
	result += "```mermaid\nflowchart LR\n"

	// Sort resource IDs for consistent output
	sortedIDs := make([]string, 0, len(allResources))
	for id := range allResources {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	// Define nodes with shapes and labels
	for _, resourceID := range sortedIDs {
		// Generate Mermaid-safe node ID (replace colons with underscores)
		nodeID := sanitizeMermaidID(resourceID)
		
		// Determine resource type for styling
		resourceType := getResourceType(resourceID)
		
		// Add node definition
		result += fmt.Sprintf("  %s[%s]:::%s\n", nodeID, resourceID, resourceType)
	}

	// Add edges (dependencies)
	depIDs := make([]string, 0, len(r.Dependencies))
	for id := range r.Dependencies {
		depIDs = append(depIDs, id)
	}
	sort.Strings(depIDs)

	for _, resourceID := range depIDs {
		deps := r.Dependencies[resourceID]
		if len(deps) == 0 {
			continue
		}
		
		sourceNode := sanitizeMermaidID(resourceID)
		
		// Sort dependencies for consistent output
		sortedDeps := make([]string, len(deps))
		copy(sortedDeps, deps)
		sort.Strings(sortedDeps)
		
		for _, depID := range sortedDeps {
			// Skip external references in visualization
			if isExternalReference(depID) {
				continue
			}
			
			targetNode := sanitizeMermaidID(depID)
			result += fmt.Sprintf("  %s --> %s\n", targetNode, sourceNode)
		}
	}

	// Add styling
	result += "  classDef skill fill:#e1f5e1,stroke:#4caf50,stroke-width:2px\n"
	result += "  classDef agent fill:#e3f2fd,stroke:#2196f3,stroke-width:2px\n"
	result += "  classDef workflow fill:#fff3e0,stroke:#ff9800,stroke-width:2px\n"
	result += "```"

	return result
}

// GetDependencyGraphDot returns a Graphviz DOT representation of the dependency graph.
//
// The generated diagram uses:
// - Different shapes for different resource types (box, ellipse, hexagon)
// - Color coding by resource type
// - Left-to-right layout (rankdir=LR)
//
// Example output:
//
//	digraph dependencies {
//	  rankdir=LR;
//	  node [style=filled];
//	  
//	  "skill:coding" [shape=box, fillcolor="#e1f5e1"];
//	  "agent:reviewer" [shape=ellipse, fillcolor="#e3f2fd"];
//	  "workflow:pr-review" [shape=hexagon, fillcolor="#fff3e0"];
//	  
//	  "skill:coding" -> "agent:reviewer";
//	  "agent:reviewer" -> "workflow:pr-review";
//	}
func (r *Result) GetDependencyGraphDot() string {
	// Collect all resource IDs
	allResources := make(map[string]bool)
	
	// Add resources from skills, agents, workflows
	for _, skill := range r.Skills {
		allResources[GetResourceID(skill)] = true
	}
	for _, agent := range r.Agents {
		allResources[GetResourceID(agent)] = true
	}
	for _, workflow := range r.Workflows {
		allResources[GetResourceID(workflow)] = true
	}

	if len(allResources) == 0 {
		return "digraph dependencies {\n  empty [label=\"No resources\"];\n}"
	}

	var result string
	result += "digraph dependencies {\n"
	result += "  rankdir=LR;\n"
	result += "  node [style=filled];\n\n"

	// Sort resource IDs for consistent output
	sortedIDs := make([]string, 0, len(allResources))
	for id := range allResources {
		sortedIDs = append(sortedIDs, id)
	}
	sort.Strings(sortedIDs)

	// Define nodes with shapes and colors
	for _, resourceID := range sortedIDs {
		shape, color := getNodeStyle(resourceID)
		result += fmt.Sprintf("  \"%s\" [shape=%s, fillcolor=\"%s\"];\n", resourceID, shape, color)
	}

	result += "\n"

	// Add edges (dependencies)
	depIDs := make([]string, 0, len(r.Dependencies))
	for id := range r.Dependencies {
		depIDs = append(depIDs, id)
	}
	sort.Strings(depIDs)

	for _, resourceID := range depIDs {
		deps := r.Dependencies[resourceID]
		if len(deps) == 0 {
			continue
		}
		
		// Sort dependencies for consistent output
		sortedDeps := make([]string, len(deps))
		copy(sortedDeps, deps)
		sort.Strings(sortedDeps)
		
		for _, depID := range sortedDeps {
			// Skip external references in visualization
			if isExternalReference(depID) {
				continue
			}
			
			result += fmt.Sprintf("  \"%s\" -> \"%s\";\n", depID, resourceID)
		}
	}

	result += "}"

	return result
}

// getNodeStyle returns the shape and color for a resource type in Graphviz DOT format.
func getNodeStyle(resourceID string) (shape string, color string) {
	resourceType := getResourceType(resourceID)
	
	switch resourceType {
	case "skill":
		return "box", "#e1f5e1"
	case "agent":
		return "ellipse", "#e3f2fd"
	case "workflow":
		return "hexagon", "#fff3e0"
	default:
		return "ellipse", "#f5f5f5"
	}
}

// countDependencies counts the total number of dependency edges.
func countDependencies(deps map[string][]string) int {
	count := 0
	for _, depList := range deps {
		count += len(depList)
	}
	return count
}

// sanitizeMermaidID converts a resource ID to a Mermaid-safe node identifier.
// Replaces colons and other special characters with underscores.
func sanitizeMermaidID(resourceID string) string {
	result := ""
	for _, char := range resourceID {
		if char == ':' || char == '-' || char == '/' {
			result += "_"
		} else {
			result += string(char)
		}
	}
	return result
}

// getResourceType determines the resource type from a resource ID.
// Returns "skill", "agent", or "workflow" for styling purposes.
func getResourceType(resourceID string) string {
	if len(resourceID) >= 6 && resourceID[:6] == "skill:" {
		return "skill"
	}
	if len(resourceID) >= 6 && resourceID[:6] == "agent:" {
		return "agent"
	}
	if len(resourceID) >= 9 && resourceID[:9] == "workflow:" {
		return "workflow"
	}
	return "unknown"
}

// GetResourcesByDepth groups resources by their dependency depth level.
//
// Depth 0: Resources with no dependencies
// Depth 1: Resources that only depend on depth 0 resources
// Depth 2: Resources that depend on depth 0 or 1 resources
// ...
//
// Resources at the same depth can be created in parallel since they don't depend on each other.
//
// Returns an ordered list of resource groups where each group can be created concurrently.
func (r *Result) GetResourcesByDepth() ([][]*ResourceWithID, error) {
	// First get all resources in topological order
	ordered, err := r.GetOrderedResources()
	if err != nil {
		return nil, err
	}

	if len(ordered) == 0 {
		return [][]*ResourceWithID{}, nil
	}

	// Build a map of resource ID to resource
	resourceMap := make(map[string]*ResourceWithID)
	for _, res := range ordered {
		resourceMap[res.ID] = res
	}

	// Calculate depth for each resource
	depths := make(map[string]int)
	
	// Use BFS-like approach to calculate depths
	// Start with resources that have no dependencies (depth 0)
	for _, res := range ordered {
		if len(r.Dependencies[res.ID]) == 0 {
			depths[res.ID] = 0
		}
	}

	// Calculate depths iteratively
	// Process resources in topological order to ensure dependencies are processed first
	for _, res := range ordered {
		if _, exists := depths[res.ID]; exists {
			// Already processed (no dependencies)
			continue
		}

		// Find maximum depth of dependencies
		maxDepth := -1
		for _, depID := range r.Dependencies[res.ID] {
			// Skip external references
			if isExternalReference(depID) {
				continue
			}
			
			if depDepth, exists := depths[depID]; exists {
				if depDepth > maxDepth {
					maxDepth = depDepth
				}
			}
		}

		// This resource is one level deeper than its deepest dependency
		depths[res.ID] = maxDepth + 1
	}

	// Group resources by depth
	depthGroups := make(map[int][]*ResourceWithID)
	maxDepthFound := 0
	
	for _, res := range ordered {
		depth := depths[res.ID]
		if depth > maxDepthFound {
			maxDepthFound = depth
		}
		depthGroups[depth] = append(depthGroups[depth], res)
	}

	// Convert map to ordered slice
	result := make([][]*ResourceWithID, maxDepthFound+1)
	for depth := 0; depth <= maxDepthFound; depth++ {
		result[depth] = depthGroups[depth]
	}

	return result, nil
}
