// Package subagent provides types and builders for defining sub-agents
// that can be delegated to within an agent.
//
// Sub-agents can be either:
//   - Inline: Defined directly with instructions, MCP servers, and skills
//   - Referenced: Reference to an existing AgentInstance resource
//
// # Inline Sub-Agents
//
// Inline sub-agents are defined directly within the parent agent:
//
//	sub := subagent.Inline(
//	    subagent.WithName("code-analyzer"),
//	    subagent.WithInstructions("Analyze code for bugs and security issues"),
//	    subagent.WithDescription("Static code analyzer"),
//	    subagent.WithMCPServer("github"),
//	    subagent.WithSkill(skill.Platform("code-analysis")),
//	)
//
// # Referenced Sub-Agents
//
// Referenced sub-agents point to existing AgentInstance resources:
//
//	sub := subagent.Reference("security-checker", "sec-checker-prod")
//
// # Integration with Agent
//
// Sub-agents are added to agents using the WithSubAgent option:
//
//	agent, err := agent.New(
//	    agent.WithName("main-agent"),
//	    agent.WithInstructions("Main agent instructions"),
//	    agent.WithSubAgent(subagent.Inline(
//	        subagent.WithName("helper"),
//	        subagent.WithInstructions("Helper instructions"),
//	    )),
//	)
package subagent
