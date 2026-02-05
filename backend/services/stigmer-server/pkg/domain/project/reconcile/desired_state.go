package reconcile

import (
	"maps"
	"slices"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// emptyDesiredState is a singleton empty state for reuse.
var emptyDesiredState = &DesiredState{
	agents:     make(map[string]*agentv1.Agent),
	workflows:  make(map[string]*workflowv1.Workflow),
	mcpServers: make(map[string]*mcpserverv1.McpServer),
	skills:     make(map[string]*skillv1.Skill),
}

// DesiredState is an immutable value object representing resources from Project.Spec.
//
// DesiredState represents the "what should exist" side of the reconciliation equation.
// It contains all resources declared in a project's SDK definition, keyed by slug
// for O(1) lookup during diff operations.
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions
//   - Getters return defensive copies to prevent external mutation
//   - There are no setters
//
// Example:
//
//	desired := NewDesiredState(
//	    map[string]*agentv1.Agent{"my-agent": agent},
//	    map[string]*workflowv1.Workflow{"pipeline": workflow},
//	    nil,
//	    nil,
//	)
//	fmt.Println(desired.ResourceCount()) // Output: 2
type DesiredState struct {
	agents     map[string]*agentv1.Agent
	workflows  map[string]*workflowv1.Workflow
	mcpServers map[string]*mcpserverv1.McpServer
	skills     map[string]*skillv1.Skill
}

// NewDesiredState creates a new DesiredState with the given resource maps.
//
// The constructor performs defensive copying of all maps to ensure immutability.
// Nil maps are converted to empty maps. Keys are expected to be resource slugs.
//
// Example:
//
//	agents := map[string]*agentv1.Agent{"my-agent": myAgent}
//	desired := NewDesiredState(agents, nil, nil, nil)
//	// Modifying the original map doesn't affect the state
//	agents["other"] = otherAgent
//	desired.HasResource(...) // Still only has "my-agent"
func NewDesiredState(
	agents map[string]*agentv1.Agent,
	workflows map[string]*workflowv1.Workflow,
	mcpServers map[string]*mcpserverv1.McpServer,
	skills map[string]*skillv1.Skill,
) *DesiredState {
	return &DesiredState{
		agents:     cloneAgentMap(agents),
		workflows:  cloneWorkflowMap(workflows),
		mcpServers: cloneMcpServerMap(mcpServers),
		skills:     cloneSkillMap(skills),
	}
}

// EmptyDesiredState returns a singleton empty DesiredState.
//
// This is more efficient than creating new empty states repeatedly.
func EmptyDesiredState() *DesiredState {
	return emptyDesiredState
}

// IsEmpty returns true if there are no resources in the desired state.
func (s *DesiredState) IsEmpty() bool {
	return len(s.agents) == 0 && len(s.workflows) == 0 &&
		len(s.mcpServers) == 0 && len(s.skills) == 0
}

// ResourceCount returns the total count of all resources.
func (s *DesiredState) ResourceCount() int {
	return len(s.agents) + len(s.workflows) + len(s.mcpServers) + len(s.skills)
}

// AllResourceKeys returns all resource keys in deterministic order.
//
// Keys are sorted by kind (agents, workflows, mcp_servers, skills), then
// alphabetically by slug within each kind. This ensures reproducible
// test results and predictable reconciliation ordering.
func (s *DesiredState) AllResourceKeys() []ResourceKey {
	keys := make([]ResourceKey, 0, s.ResourceCount())

	// Agents (sorted by slug)
	agentSlugs := sortedKeys(s.agents)
	for _, slug := range agentSlugs {
		keys = append(keys, MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug))
	}

	// Workflows (sorted by slug)
	workflowSlugs := sortedKeys(s.workflows)
	for _, slug := range workflowSlugs {
		keys = append(keys, MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug))
	}

	// MCP Servers (sorted by slug)
	mcpServerSlugs := sortedKeys(s.mcpServers)
	for _, slug := range mcpServerSlugs {
		keys = append(keys, MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug))
	}

	// Skills (sorted by slug)
	skillSlugs := sortedKeys(s.skills)
	for _, slug := range skillSlugs {
		keys = append(keys, MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug))
	}

	return keys
}

// HasResource checks if a resource exists by its key.
//
// Returns true if a resource with the given kind and slug exists in the state.
func (s *DesiredState) HasResource(key ResourceKey) bool {
	switch key.Kind() {
	case apiresourcekind.ApiResourceKind_agent:
		_, ok := s.agents[key.Slug()]
		return ok
	case apiresourcekind.ApiResourceKind_workflow:
		_, ok := s.workflows[key.Slug()]
		return ok
	case apiresourcekind.ApiResourceKind_mcp_server:
		_, ok := s.mcpServers[key.Slug()]
		return ok
	case apiresourcekind.ApiResourceKind_skill:
		_, ok := s.skills[key.Slug()]
		return ok
	default:
		return false
	}
}

// GetResource returns a resource by its key, or nil if not found.
//
// This method returns proto.Message interface to support generic handling
// in the diff algorithm. Use the typed getters (GetAgent, GetWorkflow, etc.)
// when you know the resource type.
//
// Note: This method explicitly checks for nil before returning to avoid
// the Go interface nil gotcha where a nil pointer wrapped in an interface
// is not equal to nil.
//
// Example:
//
//	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
//	if resource := desired.GetResource(key); resource != nil {
//	    // Use resource
//	}
func (s *DesiredState) GetResource(key ResourceKey) proto.Message {
	switch key.Kind() {
	case apiresourcekind.ApiResourceKind_agent:
		if agent := s.agents[key.Slug()]; agent != nil {
			return agent
		}
	case apiresourcekind.ApiResourceKind_workflow:
		if workflow := s.workflows[key.Slug()]; workflow != nil {
			return workflow
		}
	case apiresourcekind.ApiResourceKind_mcp_server:
		if mcpServer := s.mcpServers[key.Slug()]; mcpServer != nil {
			return mcpServer
		}
	case apiresourcekind.ApiResourceKind_skill:
		if skill := s.skills[key.Slug()]; skill != nil {
			return skill
		}
	}
	return nil
}

// GetAgent returns an agent by slug, or nil if not found.
func (s *DesiredState) GetAgent(slug string) *agentv1.Agent {
	return s.agents[slug]
}

// GetWorkflow returns a workflow by slug, or nil if not found.
func (s *DesiredState) GetWorkflow(slug string) *workflowv1.Workflow {
	return s.workflows[slug]
}

// GetMcpServer returns an MCP server by slug, or nil if not found.
func (s *DesiredState) GetMcpServer(slug string) *mcpserverv1.McpServer {
	return s.mcpServers[slug]
}

// GetSkill returns a skill by slug, or nil if not found.
func (s *DesiredState) GetSkill(slug string) *skillv1.Skill {
	return s.skills[slug]
}

// Agents returns a defensive copy of the agents map.
//
// Callers can safely modify the returned map without affecting the state.
func (s *DesiredState) Agents() map[string]*agentv1.Agent {
	return maps.Clone(s.agents)
}

// Workflows returns a defensive copy of the workflows map.
//
// Callers can safely modify the returned map without affecting the state.
func (s *DesiredState) Workflows() map[string]*workflowv1.Workflow {
	return maps.Clone(s.workflows)
}

// McpServers returns a defensive copy of the MCP servers map.
//
// Callers can safely modify the returned map without affecting the state.
func (s *DesiredState) McpServers() map[string]*mcpserverv1.McpServer {
	return maps.Clone(s.mcpServers)
}

// Skills returns a defensive copy of the skills map.
//
// Callers can safely modify the returned map without affecting the state.
func (s *DesiredState) Skills() map[string]*skillv1.Skill {
	return maps.Clone(s.skills)
}

// Helper functions for defensive copying

func cloneAgentMap(m map[string]*agentv1.Agent) map[string]*agentv1.Agent {
	if m == nil {
		return make(map[string]*agentv1.Agent)
	}
	return maps.Clone(m)
}

func cloneWorkflowMap(m map[string]*workflowv1.Workflow) map[string]*workflowv1.Workflow {
	if m == nil {
		return make(map[string]*workflowv1.Workflow)
	}
	return maps.Clone(m)
}

func cloneMcpServerMap(m map[string]*mcpserverv1.McpServer) map[string]*mcpserverv1.McpServer {
	if m == nil {
		return make(map[string]*mcpserverv1.McpServer)
	}
	return maps.Clone(m)
}

func cloneSkillMap(m map[string]*skillv1.Skill) map[string]*skillv1.Skill {
	if m == nil {
		return make(map[string]*skillv1.Skill)
	}
	return maps.Clone(m)
}

// sortedKeys returns the keys of a map sorted alphabetically.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
