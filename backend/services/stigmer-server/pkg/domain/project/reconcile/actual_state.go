package reconcile

import (
	"maps"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// emptyActualState is a singleton empty state for reuse.
var emptyActualState = &ActualState{
	agents:     make(map[string]*agentv1.Agent),
	workflows:  make(map[string]*workflowv1.Workflow),
	mcpServers: make(map[string]*mcpserverv1.McpServer),
	skills:     make(map[string]*skillv1.Skill),
}

// ActualState is an immutable value object representing resources fetched from repositories.
//
// ActualState represents the "what currently exists" side of the reconciliation equation.
// It contains all resources currently owned by a project, fetched from the database.
// Resources are keyed by slug for O(1) lookup during diff operations.
//
// Ownership is determined by the "stigmer.ai/sdk.project" annotation in each
// resource's metadata.
//
// This is an immutable value object:
//   - All fields are unexported
//   - Construction is only through factory functions
//   - Getters return defensive copies to prevent external mutation
//   - There are no setters
//
// Example:
//
//	actual := NewActualState(
//	    agentRepo.FindByProjectID(projectID),
//	    workflowRepo.FindByProjectID(projectID),
//	    mcpServerRepo.FindByProjectID(projectID),
//	    skillRepo.FindByProjectID(projectID),
//	)
//	agent := actual.GetAgent("my-agent")
type ActualState struct {
	agents     map[string]*agentv1.Agent
	workflows  map[string]*workflowv1.Workflow
	mcpServers map[string]*mcpserverv1.McpServer
	skills     map[string]*skillv1.Skill
}

// NewActualState creates a new ActualState with the given resource maps.
//
// The constructor performs defensive copying of all maps to ensure immutability.
// Nil maps are converted to empty maps. Keys are expected to be resource slugs.
func NewActualState(
	agents map[string]*agentv1.Agent,
	workflows map[string]*workflowv1.Workflow,
	mcpServers map[string]*mcpserverv1.McpServer,
	skills map[string]*skillv1.Skill,
) *ActualState {
	return &ActualState{
		agents:     cloneAgentMap(agents),
		workflows:  cloneWorkflowMap(workflows),
		mcpServers: cloneMcpServerMap(mcpServers),
		skills:     cloneSkillMap(skills),
	}
}

// EmptyActualState returns a singleton empty ActualState.
//
// This is more efficient than creating new empty states repeatedly.
func EmptyActualState() *ActualState {
	return emptyActualState
}

// IsEmpty returns true if there are no resources in the actual state.
func (s *ActualState) IsEmpty() bool {
	return len(s.agents) == 0 && len(s.workflows) == 0 &&
		len(s.mcpServers) == 0 && len(s.skills) == 0
}

// ResourceCount returns the total count of all resources.
func (s *ActualState) ResourceCount() int {
	return len(s.agents) + len(s.workflows) + len(s.mcpServers) + len(s.skills)
}

// AllResourceKeys returns all resource keys in deterministic order.
//
// Keys are sorted by kind (agents, workflows, mcp_servers, skills), then
// alphabetically by slug within each kind.
func (s *ActualState) AllResourceKeys() []ResourceKey {
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
func (s *ActualState) HasResource(key ResourceKey) bool {
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
func (s *ActualState) GetResource(key ResourceKey) proto.Message {
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

// GetResourceID extracts the metadata.id from a resource, or returns empty string.
//
// This is useful for update operations where you need the existing resource's ID
// to preserve it during reconciliation.
func (s *ActualState) GetResourceID(key ResourceKey) string {
	switch key.Kind() {
	case apiresourcekind.ApiResourceKind_agent:
		agent := s.agents[key.Slug()]
		if agent != nil && agent.Metadata != nil {
			return agent.Metadata.Id
		}
	case apiresourcekind.ApiResourceKind_workflow:
		workflow := s.workflows[key.Slug()]
		if workflow != nil && workflow.Metadata != nil {
			return workflow.Metadata.Id
		}
	case apiresourcekind.ApiResourceKind_mcp_server:
		mcpServer := s.mcpServers[key.Slug()]
		if mcpServer != nil && mcpServer.Metadata != nil {
			return mcpServer.Metadata.Id
		}
	case apiresourcekind.ApiResourceKind_skill:
		skill := s.skills[key.Slug()]
		if skill != nil && skill.Metadata != nil {
			return skill.Metadata.Id
		}
	}
	return ""
}

// GetAgent returns an agent by slug, or nil if not found.
func (s *ActualState) GetAgent(slug string) *agentv1.Agent {
	return s.agents[slug]
}

// GetWorkflow returns a workflow by slug, or nil if not found.
func (s *ActualState) GetWorkflow(slug string) *workflowv1.Workflow {
	return s.workflows[slug]
}

// GetMcpServer returns an MCP server by slug, or nil if not found.
func (s *ActualState) GetMcpServer(slug string) *mcpserverv1.McpServer {
	return s.mcpServers[slug]
}

// GetSkill returns a skill by slug, or nil if not found.
func (s *ActualState) GetSkill(slug string) *skillv1.Skill {
	return s.skills[slug]
}

// Agents returns a defensive copy of the agents map.
func (s *ActualState) Agents() map[string]*agentv1.Agent {
	return maps.Clone(s.agents)
}

// Workflows returns a defensive copy of the workflows map.
func (s *ActualState) Workflows() map[string]*workflowv1.Workflow {
	return maps.Clone(s.workflows)
}

// McpServers returns a defensive copy of the MCP servers map.
func (s *ActualState) McpServers() map[string]*mcpserverv1.McpServer {
	return maps.Clone(s.mcpServers)
}

// Skills returns a defensive copy of the skills map.
func (s *ActualState) Skills() map[string]*skillv1.Skill {
	return maps.Clone(s.skills)
}
