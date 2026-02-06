//go:build ignore

// Example 04: Agent with Sub-Agents
//
// This example demonstrates how to create agents with sub-agents.
// Sub-agents are defined inline within the parent agent spec and have
// restricted access to the parent's MCP servers via McpAccess grants.
//
// Key concepts:
//   - Sub-agents are stored in Args.SubAgents (single source of truth)
//   - Sub-agents can only access MCP servers that the parent has declared
//   - Sub-agent tools must be a subset of parent's enabled tools (can restrict, not expand)
//   - Sub-agents can have their own skill references independent of parent
//   - Use NewSubAgent() for simple cases, BuildSubAgent() for complex configurations
//
// Run: go run examples/04_agent_with_subagents.go
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/ref"
	"github.com/stigmer/stigmer/sdk/go/context"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Example 04: Agent with Sub-Agents ===\n")

		// Example 1: Simple inline sub-agent
		simpleAgent, err := createSimpleAgentWithSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("1. Simple Agent with Sub-Agent", simpleAgent)

		// Example 2: Complex agent with multiple sub-agents
		complexAgent, err := createComplexAgentWithMultipleSubAgents(ctx)
		if err != nil {
			return err
		}
		printAgent("2. Complex Agent with Multiple Sub-Agents", complexAgent)

		// Example 3: Sub-agent with MCP access grants
		agentWithMCPSubAgent, err := createAgentWithMCPSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("3. Agent with Sub-Agent Using MCP Access", agentWithMCPSubAgent)

		// Example 4: Sub-agent with skills
		agentWithSkilledSubAgent, err := createAgentWithSkilledSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("4. Agent with Sub-Agent Using Skills", agentWithSkilledSubAgent)

		// Example 5: Sub-agent with restricted tool access
		agentWithSelectiveSubAgent, err := createAgentWithSelectiveSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("5. Agent with Sub-Agent Using Restricted Tools", agentWithSelectiveSubAgent)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}

// Example 1: Simple sub-agent using NewSubAgent helper
func createSimpleAgentWithSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
		Instructions: "Review code changes and coordinate with specialized sub-agents for deeper analysis",
		Description:  "Main code review orchestrator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Create and add sub-agent using NewSubAgent helper
	securityScanner := agent.NewSubAgentWithDescription(
		"security-scanner",
		"Scan code for security vulnerabilities and provide detailed security reports",
		"Security-focused code analyzer",
	)
	ag.AddSubAgent(securityScanner)

	return ag, nil
}

// Example 2: Complex agent with multiple sub-agents
func createComplexAgentWithMultipleSubAgents(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "ci-cd-orchestrator", &agent.AgentArgs{
		Instructions: "Manage the entire CI/CD pipeline by delegating to specialized agents",
		Description:  "Complete CI/CD pipeline orchestrator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Create multiple sub-agents using NewSubAgentWithDescription
	ag.AddSubAgents(
		agent.NewSubAgentWithDescription(
			"code-quality-checker",
			"Run linting, formatting checks, and code quality metrics",
			"Code quality analyzer",
		),
		agent.NewSubAgentWithDescription(
			"test-runner",
			"Execute all test suites and report results",
			"Test execution coordinator",
		),
		agent.NewSubAgentWithDescription(
			"security-scanner",
			"Scan for security vulnerabilities in code and dependencies",
			"Security vulnerability scanner",
		),
		agent.NewSubAgentWithDescription(
			"deployer",
			"Handle deployment tasks after all checks pass",
			"Deployment automation agent",
		),
	)

	return ag, nil
}

// Example 3: Sub-agent with MCP access grants using BuildSubAgent
func createAgentWithMCPSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "multi-repo-manager", &agent.AgentArgs{
		Instructions: "Manage repositories across multiple platforms",
		Description:  "Multi-platform repository manager",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add MCP server references to the parent agent
	ag.UseMCP("stigmer/github")
	ag.UseMCP("stigmer/gitlab")

	// Create sub-agents with MCP access using BuildSubAgent
	githubSpecialist := agent.BuildSubAgent(
		"github-specialist",
		"Handle all GitHub-specific operations",
	).
		Description("GitHub operations specialist").
		GrantMcpAccess("github"). // Inherits all tools from parent
		Build()

	crossPlatformSync := agent.BuildSubAgent(
		"cross-platform-sync",
		"Sync changes across GitHub and GitLab",
	).
		Description("Cross-platform synchronization").
		GrantMcpAccess("github").
		GrantMcpAccess("gitlab").
		Build()

	ag.AddSubAgents(githubSpecialist, crossPlatformSync)
	return ag, nil
}

// Example 4: Sub-agent with skills using BuildSubAgent
func createAgentWithSkilledSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "development-assistant", &agent.AgentArgs{
		Instructions: "Assist with software development tasks by leveraging specialized knowledge",
		Description:  "Intelligent development assistant",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Create sub-agent with skills using BuildSubAgent
	codingExpert := agent.BuildSubAgent(
		"coding-expert",
		"Provide coding guidance using best practices and internal documentation",
	).
		Description("Coding expert with knowledge base").
		AddSkillRef(ref.Skill("stigmer", "coding-best-practices")).
		AddSkillRef(ref.Skill("stigmer", "design-patterns")).
		AddSkillRef(ref.Skill("my-org", "internal-apis")).
		AddSkillRef(ref.Skill("my-org", "architecture-guidelines")).
		Build()

	ag.AddSubAgent(codingExpert)
	return ag, nil
}

// Example 5: Sub-agent with restricted tool access
func createAgentWithSelectiveSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "selective-github-bot", &agent.AgentArgs{
		Instructions: "Manage GitHub operations with specialized sub-agents",
		Description:  "GitHub bot with selective tool access",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Parent agent has access to all GitHub tools
	ag.UseMCP("stigmer/github",
		"create_issue", "update_issue", "list_issues",
		"list_pull_requests", "review_pull_request", "comment_on_pr",
		"create_repository", "delete_repository",
	)

	// Create sub-agents with restricted tool access
	issueManager := agent.BuildSubAgent(
		"issue-manager",
		"Manage GitHub issues only, cannot access other GitHub features",
	).
		Description("Issue management specialist").
		GrantMcpAccess("github", "create_issue", "update_issue", "list_issues"). // Restricted tools
		Build()

	prReviewer := agent.BuildSubAgent(
		"pr-reviewer",
		"Review pull requests only, cannot modify issues or repositories",
	).
		Description("Pull request reviewer").
		GrantMcpAccess("github", "list_pull_requests", "review_pull_request", "comment_on_pr"). // Different restricted tools
		Build()

	ag.AddSubAgents(issueManager, prReviewer)
	return ag, nil
}

// Helper function to print agent and its proto representation
func printAgent(title string, ag *agent.Agent) {
	fmt.Printf("\n%s\n", title)
	fmt.Println("=" + string(make([]byte, len(title))))
	fmt.Printf("Agent Name: %s\n", ag.Name)
	fmt.Printf("Instructions: %s\n", ag.Args.Instructions)
	fmt.Printf("MCP Server Usages: %d\n", len(ag.Args.McpServerUsages))
	fmt.Printf("Sub-Agents: %d\n", len(ag.Args.SubAgents))

	for i, sub := range ag.Args.SubAgents {
		fmt.Printf("  [%d] %s: %s\n", i+1, sub.Name, sub.Description)
		if len(sub.McpAccess) > 0 {
			fmt.Printf("      MCP Access: ")
			for _, access := range sub.McpAccess {
				if len(access.EnabledTools) > 0 {
					fmt.Printf("%s (tools: %v) ", access.McpServer, access.EnabledTools)
				} else {
					fmt.Printf("%s (all tools) ", access.McpServer)
				}
			}
			fmt.Println()
		}
		if len(sub.SkillRefs) > 0 {
			fmt.Printf("      Skills: %d references\n", len(sub.SkillRefs))
		}
	}

	fmt.Println("\nNote: When you run `stigmer deploy`, the CLI will convert this to proto and deploy to Stigmer.")
}
