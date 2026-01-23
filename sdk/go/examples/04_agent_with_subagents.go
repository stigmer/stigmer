//go:build ignore
// Example 04: Agent with Sub-Agents
//
// This example demonstrates how to create agents with sub-agents.
// Sub-agents can be:
// - Inline: Defined directly with their own instructions, MCP servers, and skills
// - Referenced: References to existing AgentInstance resources
//
// Run: go run examples/04_agent_with_subagents.go
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Example 04: Agent with Sub-Agents ===\n")

		// Example 1: Simple inline sub-agent
		simpleAgent, err := createSimpleAgentWithSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("1. Simple Agent with Inline Sub-Agent", simpleAgent)

		// Example 2: Referenced sub-agent
		agentWithReference, err := createAgentWithReferencedSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("2. Agent with Referenced Sub-Agent", agentWithReference)

		// Example 3: Complex agent with multiple sub-agents
		complexAgent, err := createComplexAgentWithMultipleSubAgents(ctx)
		if err != nil {
			return err
		}
		printAgent("3. Complex Agent with Multiple Sub-Agents", complexAgent)

		// Example 4: Inline sub-agent with MCP server references
		agentWithMCPSubAgent, err := createAgentWithMCPSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("4. Agent with Sub-Agent Using MCP Servers", agentWithMCPSubAgent)

		// Example 5: Inline sub-agent with skills
		agentWithSkilledSubAgent, err := createAgentWithSkilledSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("5. Agent with Sub-Agent Using Skills", agentWithSkilledSubAgent)

		// Example 6: Inline sub-agent with tool selections
		agentWithSelectiveSubAgent, err := createAgentWithSelectiveSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("6. Agent with Sub-Agent Using Tool Selections", agentWithSelectiveSubAgent)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}

// Example 1: Simple inline sub-agent
func createSimpleAgentWithSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create inline sub-agent
	securityScanner, err := subagent.Inline(
		subagent.WithName("security-scanner"),
		subagent.WithInstructions("Scan code for security vulnerabilities and provide detailed security reports"),
		subagent.WithDescription("Security-focused code analyzer"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create sub-agent: %w", err)
	}

	ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
		Instructions: "Review code changes and coordinate with specialized sub-agents for deeper analysis",
		Description:  "Main code review orchestrator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add sub-agent using builder method
	ag.AddSubAgent(securityScanner)
	return ag, nil
}

// Example 2: Referenced sub-agent
func createAgentWithReferencedSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "deployment-orchestrator", &agent.AgentArgs{
		Instructions: "Orchestrate deployment process by delegating to specialized agents",
		Description:  "Main deployment coordinator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add referenced sub-agent using builder method
	ag.AddSubAgent(subagent.Reference(
		"security-checker",
		"sec-checker-prod", // References an existing AgentInstance
	))
	return ag, nil
}

// Example 3: Complex agent with multiple sub-agents (inline and referenced)
func createComplexAgentWithMultipleSubAgents(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create inline sub-agents
	codeQualityChecker, err := subagent.Inline(
		subagent.WithName("code-quality-checker"),
		subagent.WithInstructions("Run linting, formatting checks, and code quality metrics"),
		subagent.WithDescription("Code quality analyzer"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create code quality checker: %w", err)
	}

	testRunner, err := subagent.Inline(
		subagent.WithName("test-runner"),
		subagent.WithInstructions("Execute all test suites and report results"),
		subagent.WithDescription("Test execution coordinator"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create test runner: %w", err)
	}

	ag, err := agent.New(ctx, "ci-cd-orchestrator", &agent.AgentArgs{
		Instructions: "Manage the entire CI/CD pipeline by delegating to specialized agents",
		Description:  "Complete CI/CD pipeline orchestrator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add sub-agents using builder method
	ag.AddSubAgents(
		// Inline sub-agents
		codeQualityChecker,
		testRunner,
		// Referenced sub-agents
		subagent.Reference("security-scanner", "sec-scanner-prod"),
		subagent.Reference("deployer", "deployer-prod"),
	)
	return ag, nil
}

// Example 4: Inline sub-agent with MCP server references
func createAgentWithMCPSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create MCP servers for the main agent
	github, err := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create GitHub MCP server: %w", err)
	}

	gitlab, err := mcpserver.Stdio(
		mcpserver.WithName("gitlab"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-gitlab"),
		mcpserver.WithEnvPlaceholder("GITLAB_TOKEN", "${GITLAB_TOKEN}"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create GitLab MCP server: %w", err)
	}

	// Create inline sub-agents
	githubSpecialist, err := subagent.Inline(
		subagent.WithName("github-specialist"),
		subagent.WithInstructions("Handle all GitHub-specific operations"),
		subagent.WithDescription("GitHub operations specialist"),
		subagent.WithMCPServer("github"), // References the parent's MCP server
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create github specialist: %w", err)
	}

	crossPlatformSync, err := subagent.Inline(
		subagent.WithName("cross-platform-sync"),
		subagent.WithInstructions("Sync changes across GitHub and GitLab"),
		subagent.WithDescription("Cross-platform synchronization"),
		subagent.WithMCPServers("github", "gitlab"), // Uses multiple MCP servers
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create cross-platform sync: %w", err)
	}

	// Create agent with sub-agents that use the MCP servers
	ag, err := agent.New(ctx, "multi-repo-manager", &agent.AgentArgs{
		Instructions: "Manage repositories across multiple platforms",
		Description:  "Multi-platform repository manager",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add MCP servers and sub-agents using builder methods
	ag.AddMCPServers(github, gitlab)
	ag.AddSubAgents(githubSpecialist, crossPlatformSync)
	return ag, nil
}

// Example 5: Inline sub-agent with skills
func createAgentWithSkilledSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create inline sub-agent with skills
	codingExpert, err := subagent.Inline(
		subagent.WithName("coding-expert"),
		subagent.WithInstructions("Provide coding guidance using best practices and internal documentation"),
		subagent.WithDescription("Coding expert with knowledge base"),
		subagent.WithSkills(
			skill.Platform("coding-best-practices"),
			skill.Platform("design-patterns"),
			skill.Organization("my-org", "internal-apis"),
			skill.Organization("my-org", "architecture-guidelines"),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create coding expert: %w", err)
	}

	ag, err := agent.New(ctx, "development-assistant", &agent.AgentArgs{
		Instructions: "Assist with software development tasks by leveraging specialized knowledge",
		Description:  "Intelligent development assistant",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add sub-agent using builder method
	ag.AddSubAgent(codingExpert)
	return ag, nil
}

// Example 6: Inline sub-agent with tool selections
func createAgentWithSelectiveSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	github, err := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create GitHub MCP server: %w", err)
	}

	// Create inline sub-agents with tool selections
	issueManager, err := subagent.Inline(
		subagent.WithName("issue-manager"),
		subagent.WithInstructions("Manage GitHub issues only, cannot access other GitHub features"),
		subagent.WithDescription("Issue management specialist"),
		subagent.WithMCPServer("github"),
		subagent.WithToolSelection("github", "create_issue", "update_issue", "list_issues"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create issue manager: %w", err)
	}

	prReviewer, err := subagent.Inline(
		subagent.WithName("pr-reviewer"),
		subagent.WithInstructions("Review pull requests only, cannot modify issues or repositories"),
		subagent.WithDescription("Pull request reviewer"),
		subagent.WithMCPServer("github"),
		subagent.WithToolSelection("github", "list_pull_requests", "review_pull_request", "comment_on_pr"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create PR reviewer: %w", err)
	}

	ag, err := agent.New(ctx, "selective-github-bot", &agent.AgentArgs{
		Instructions: "Manage GitHub operations with specialized sub-agents",
		Description:  "GitHub bot with selective tool access",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add MCP server and sub-agents using builder methods
	ag.AddMCPServer(github)
	ag.AddSubAgents(issueManager, prReviewer)
	return ag, nil
}

// Helper function to print agent and its proto representation
func printAgent(title string, ag *agent.Agent) {
	fmt.Printf("\n%s\n", title)
	fmt.Println("=" + string(make([]byte, len(title))))
	fmt.Printf("Agent Name: %s\n", ag.Name)
	fmt.Printf("Instructions: %s\n", ag.Instructions)
	fmt.Printf("Sub-Agents: %d\n", len(ag.SubAgents))

	for i, sub := range ag.SubAgents {
		if sub.IsInline() {
			fmt.Printf("  [%d] Inline: %s\n", i+1, sub.Name())
		} else {
			fmt.Printf("  [%d] Reference: %s\n", i+1, sub.String())
		}
	}

	fmt.Println("\nNote: When you run `stigmer deploy`, the CLI will convert this to proto and deploy to Stigmer.")
}
