// Package subagent provides types and builders for defining sub-agents
// that can be delegated to within an agent.
//
// Sub-agents are defined inline within the parent agent spec using the
// struct args pattern (Pulumi-aligned).
//
// # Creating Sub-Agents
//
// Sub-agents are created using the New function with struct args:
//
//	sub, err := subagent.New("code-analyzer", &subagent.Args{
//	    Instructions: "Analyze code for bugs and security issues",
//	    Description:  "Static code analyzer",
//	    McpServers:   []string{"github"},
//	    SkillRefs: []*types.ApiResourceReference{
//	        {Slug: "code-analysis"},
//	    },
//	})
//
// # Integration with Agent
//
// Sub-agents are added to agents using the AddSubAgent method:
//
//	ag, err := agent.New(ctx, "main-agent", &agent.AgentArgs{
//	    Instructions: "Main agent instructions",
//	})
//	sub, _ := subagent.New("helper", &subagent.Args{
//	    Instructions: "Helper instructions for the sub-agent",
//	})
//	ag.AddSubAgent(sub)
package subagent
