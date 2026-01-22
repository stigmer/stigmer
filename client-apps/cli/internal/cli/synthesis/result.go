package synthesis

import (
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// Result contains all resources synthesized from SDK code execution.
//
// The SDK writes individual .pb files and a dependencies.json file.
// The CLI reads these files and constructs a Result for deployment.
type Result struct {
	// Skills are inline skill definitions (skill-0.pb, skill-1.pb, ...)
	Skills []*skillv1.Skill

	// Agents are agent definitions (agent-0.pb, agent-1.pb, ...)
	Agents []*agentv1.Agent

	// Workflows are workflow definitions (workflow-0.pb, workflow-1.pb, ...)
	Workflows []*workflowv1.Workflow

	// Dependencies maps resource IDs to their dependencies
	// Format: {"agent:reviewer": ["skill:code-analysis"], ...}
	Dependencies map[string][]string
}

// TotalResources returns the total count of all resources
func (r *Result) TotalResources() int {
	return len(r.Skills) + len(r.Agents) + len(r.Workflows)
}

// AgentCount returns the number of agents
func (r *Result) AgentCount() int {
	return len(r.Agents)
}

// SkillCount returns the number of skills
func (r *Result) SkillCount() int {
	return len(r.Skills)
}

// WorkflowCount returns the number of workflows
func (r *Result) WorkflowCount() int {
	return len(r.Workflows)
}
