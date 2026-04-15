package synthesis

import (
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
)

// Result contains all resources synthesized from SDK code execution.
//
// The SDK writes individual .pb files and a dependencies.json file.
// The CLI reads these files and constructs a Result for deployment.
//
// Resource Types:
//   - SkillSynths: Skill synthesis inputs (CLI processes these to create skill artifacts)
//   - MCP Servers: External tool integrations (no dependencies)
//   - Agents: May depend on skills and MCP servers
//   - Workflows: May depend on agents
type Result struct {
	// SkillSynths are skill synthesis inputs (skill-0.pb, skill-1.pb, ...)
	// These contain source location (local dir or git) and tag.
	// CLI processes these to create artifact ZIPs and push to backend.
	SkillSynths []*skillv1.SkillSynth

	// McpServers are MCP server definitions (mcpserver-0.pb, mcpserver-1.pb, ...)
	McpServers []*mcpserverv1.McpServer

	// Agents are agent definitions (agent-0.pb, agent-1.pb, ...)
	Agents []*agentv1.Agent

	// Workflows are workflow definitions (workflow-0.pb, workflow-1.pb, ...)
	Workflows []*workflowv1.Workflow

	// Dependencies maps resource IDs to their dependencies.
	// Format: {"agent:reviewer": ["skill:code-analysis", "mcp_server:github"], ...}
	//
	// IMPORTANT: This is for LOCAL CLI validation only (dry-run preview, cycle detection).
	// Dependencies are NOT sent to the backend - the backend derives the dependency graph
	// from ApiResourceReference fields via proto reflection. See Phase 5 architecture docs.
	Dependencies map[string][]string
}

// TotalResources returns the total count of all resources.
func (r *Result) TotalResources() int {
	return len(r.SkillSynths) + len(r.McpServers) + len(r.Agents) + len(r.Workflows)
}

// SkillSynthCount returns the number of skill synths.
func (r *Result) SkillSynthCount() int {
	return len(r.SkillSynths)
}

// McpServerCount returns the number of MCP servers.
func (r *Result) McpServerCount() int {
	return len(r.McpServers)
}

// AgentCount returns the number of agents.
func (r *Result) AgentCount() int {
	return len(r.Agents)
}

// WorkflowCount returns the number of workflows.
func (r *Result) WorkflowCount() int {
	return len(r.Workflows)
}
