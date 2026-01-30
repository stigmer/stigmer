//go:build ignore

// Example 04: Agent with Sub-Agents
//
// This example demonstrates how to create agents with sub-agents.
// Sub-agents are defined inline within the parent agent spec and have
// restricted access to the parent's MCP servers via McpAccess grants.
//
// Key concepts:
//   - Sub-agents can only access MCP servers that the parent has declared
//   - Sub-agent tools must be a subset of parent's enabled tools (can restrict, not expand)
//   - Sub-agents can have their own skill references independent of parent
//
// Run: go run examples/04_agent_with_subagents.go
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserverref"
	"github.com/stigmer/stigmer/sdk/go/skillref"
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

// Example 1: Simple sub-agent
func createSimpleAgentWithSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create sub-agent using struct args pattern
	securityScanner, err := subagent.New("security-scanner", &subagent.Args{
		Instructions: "Scan code for security vulnerabilities and provide detailed security reports",
		Description:  "Security-focused code analyzer",
	})
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

// Example 2: Complex agent with multiple sub-agents
func createComplexAgentWithMultipleSubAgents(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create multiple sub-agents
	codeQualityChecker, err := subagent.New("code-quality-checker", &subagent.Args{
		Instructions: "Run linting, formatting checks, and code quality metrics",
		Description:  "Code quality analyzer",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create code quality checker: %w", err)
	}

	testRunner, err := subagent.New("test-runner", &subagent.Args{
		Instructions: "Execute all test suites and report results",
		Description:  "Test execution coordinator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create test runner: %w", err)
	}

	securityScanner, err := subagent.New("security-scanner", &subagent.Args{
		Instructions: "Scan for security vulnerabilities in code and dependencies",
		Description:  "Security vulnerability scanner",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create security scanner: %w", err)
	}

	deployer, err := subagent.New("deployer", &subagent.Args{
		Instructions: "Handle deployment tasks after all checks pass",
		Description:  "Deployment automation agent",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create deployer: %w", err)
	}

	ag, err := agent.New(ctx, "ci-cd-orchestrator", &agent.AgentArgs{
		Instructions: "Manage the entire CI/CD pipeline by delegating to specialized agents",
		Description:  "Complete CI/CD pipeline orchestrator",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add all sub-agents using builder method
	ag.AddSubAgents(codeQualityChecker, testRunner, securityScanner, deployer)
	return ag, nil
}

// Example 3: Sub-agent with MCP access grants
func createAgentWithMCPSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create agent that references MCP servers
	ag, err := agent.New(ctx, "multi-repo-manager", &agent.AgentArgs{
		Instructions: "Manage repositories across multiple platforms",
		Description:  "Multi-platform repository manager",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add MCP server references to the parent agent
	ag.AddMcpServerUsage(mcpserverref.Platform("github"))
	ag.AddMcpServerUsage(mcpserverref.Platform("gitlab"))

	// Create sub-agents that have access to parent's MCP servers
	githubSpecialist, err := subagent.New("github-specialist", &subagent.Args{
		Instructions: "Handle all GitHub-specific operations",
		Description:  "GitHub operations specialist",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create github specialist: %w", err)
	}
	// Grant access to github MCP server (inherits all tools from parent)
	githubSpecialist.GrantMcpAccess("github")

	crossPlatformSync, err := subagent.New("cross-platform-sync", &subagent.Args{
		Instructions: "Sync changes across GitHub and GitLab",
		Description:  "Cross-platform synchronization",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create cross-platform sync: %w", err)
	}
	// Grant access to both MCP servers
	crossPlatformSync.GrantMcpAccess("github").GrantMcpAccess("gitlab")

	// Add sub-agents
	ag.AddSubAgents(githubSpecialist, crossPlatformSync)
	return ag, nil
}

// Example 4: Sub-agent with skills
func createAgentWithSkilledSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create sub-agent with skill references
	codingExpert, err := subagent.New("coding-expert", &subagent.Args{
		Instructions: "Provide coding guidance using best practices and internal documentation",
		Description:  "Coding expert with knowledge base",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create coding expert: %w", err)
	}

	// Add skills to the sub-agent using builder methods
	codingExpert.AddSkillRefs(
		skillref.Platform("coding-best-practices"),
		skillref.Platform("design-patterns"),
	)
	codingExpert.AddOrgSkillRef("my-org", "internal-apis")
	codingExpert.AddOrgSkillRef("my-org", "architecture-guidelines")

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

// Example 5: Sub-agent with restricted tool access
func createAgentWithSelectiveSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create agent with MCP server reference
	ag, err := agent.New(ctx, "selective-github-bot", &agent.AgentArgs{
		Instructions: "Manage GitHub operations with specialized sub-agents",
		Description:  "GitHub bot with selective tool access",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Parent agent has access to all GitHub tools
	ag.AddMcpServerUsage(
		mcpserverref.Platform("github"),
		// Parent enables all these tools
		"create_issue", "update_issue", "list_issues",
		"list_pull_requests", "review_pull_request", "comment_on_pr",
		"create_repository", "delete_repository",
	)

	// Create sub-agents with restricted tool access
	issueManager, err := subagent.New("issue-manager", &subagent.Args{
		Instructions: "Manage GitHub issues only, cannot access other GitHub features",
		Description:  "Issue management specialist",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create issue manager: %w", err)
	}
	// Grant access with restricted tools (subset of parent's tools)
	issueManager.GrantMcpAccess("github", "create_issue", "update_issue", "list_issues")

	prReviewer, err := subagent.New("pr-reviewer", &subagent.Args{
		Instructions: "Review pull requests only, cannot modify issues or repositories",
		Description:  "Pull request reviewer",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create PR reviewer: %w", err)
	}
	// Grant access with different restricted tools
	prReviewer.GrantMcpAccess("github", "list_pull_requests", "review_pull_request", "comment_on_pr")

	// Add sub-agents
	ag.AddSubAgents(issueManager, prReviewer)
	return ag, nil
}

// Helper function to print agent and its proto representation
func printAgent(title string, ag *agent.Agent) {
	fmt.Printf("\n%s\n", title)
	fmt.Println("=" + string(make([]byte, len(title))))
	fmt.Printf("Agent Name: %s\n", ag.Name)
	fmt.Printf("Instructions: %s\n", ag.Instructions)
	fmt.Printf("MCP Server Usages: %d\n", len(ag.McpServerUsages))
	fmt.Printf("Sub-Agents: %d\n", len(ag.SubAgents))

	for i, sub := range ag.SubAgents {
		fmt.Printf("  [%d] %s: %s\n", i+1, sub.Name(), sub.Description())
		if len(sub.McpAccess()) > 0 {
			fmt.Printf("      MCP Access: ")
			for _, access := range sub.McpAccess() {
				if len(access.EnabledTools) > 0 {
					fmt.Printf("%s (tools: %v) ", access.McpServer, access.EnabledTools)
				} else {
					fmt.Printf("%s (all tools) ", access.McpServer)
				}
			}
			fmt.Println()
		}
		if len(sub.SkillRefs()) > 0 {
			fmt.Printf("      Skills: %d references\n", len(sub.SkillRefs()))
		}
	}

	fmt.Println("\nNote: When you run `stigmer deploy`, the CLI will convert this to proto and deploy to Stigmer.")
}
