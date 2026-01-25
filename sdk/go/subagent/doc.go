// Package subagent provides types and builders for defining sub-agents
// that can be delegated to within an agent.
//
// Sub-agents can be either:
//   - Inline: Defined directly with instructions, MCP servers, and skills
//   - Referenced: Reference to an existing AgentInstance resource
//
// # Inline Sub-Agents (Struct Args Pattern)
//
// Inline sub-agents are defined using the struct args pattern (Pulumi-aligned):
//
//	sub, err := subagent.Inline("code-analyzer", &subagent.InlineArgs{
//	    Instructions: "Analyze code for bugs and security issues",
//	    Description:  "Static code analyzer",
//	    McpServers:   []string{"github"},
//	    SkillRefs: []*types.ApiResourceReference{
//	        {Slug: "code-analysis"},
//	    },
//	})
//
// # Referenced Sub-Agents
//
// Referenced sub-agents point to existing AgentInstance resources:
//
//	sub := subagent.Reference("security-checker", "sec-checker-prod")
//
// # Integration with Agent
//
// Sub-agents are added to agents using the AddSubAgent method:
//
//	ag, err := agent.New(ctx, "main-agent", &agent.AgentArgs{
//	    Instructions: "Main agent instructions",
//	})
//	sub, _ := subagent.Inline("helper", &subagent.InlineArgs{
//	    Instructions: "Helper instructions for the sub-agent",
//	})
//	ag.AddSubAgent(sub)
package subagent
