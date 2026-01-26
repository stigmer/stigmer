//go:build ignore

// Example 04: Agent with Sub-Agents
//
// This example demonstrates how to create agents with sub-agents.
// Sub-agents are defined inline within the parent agent spec.
//
// Run: go run examples/04_agent_with_subagents.go
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
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

		// Example 3: Sub-agent with MCP server references
		agentWithMCPSubAgent, err := createAgentWithMCPSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("3. Agent with Sub-Agent Using MCP Servers", agentWithMCPSubAgent)

		// Example 4: Sub-agent with skills
		agentWithSkilledSubAgent, err := createAgentWithSkilledSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("4. Agent with Sub-Agent Using Skills", agentWithSkilledSubAgent)

		// Example 5: Sub-agent with tool selections
		agentWithSelectiveSubAgent, err := createAgentWithSelectiveSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("5. Agent with Sub-Agent Using Tool Selections", agentWithSelectiveSubAgent)

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

// Example 3: Sub-agent with MCP server references
func createAgentWithMCPSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create MCP servers for the main agent using struct-args pattern
	github, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
		Command: "npx",
		Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		EnvPlaceholders: map[string]string{
			"GITHUB_TOKEN": "${GITHUB_TOKEN}",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create GitHub MCP server: %w", err)
	}

	gitlab, err := mcpserver.Stdio(ctx, "gitlab", &mcpserver.StdioArgs{
		Command: "npx",
		Args:    []string{"-y", "@modelcontextprotocol/server-gitlab"},
		EnvPlaceholders: map[string]string{
			"GITLAB_TOKEN": "${GITLAB_TOKEN}",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create GitLab MCP server: %w", err)
	}

	// Create sub-agents that reference the parent's MCP servers
	githubSpecialist, err := subagent.New("github-specialist", &subagent.Args{
		Instructions: "Handle all GitHub-specific operations",
		Description:  "GitHub operations specialist",
		McpServers:   []string{"github"}, // References the parent's MCP server
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create github specialist: %w", err)
	}

	crossPlatformSync, err := subagent.New("cross-platform-sync", &subagent.Args{
		Instructions: "Sync changes across GitHub and GitLab",
		Description:  "Cross-platform synchronization",
		McpServers:   []string{"github", "gitlab"}, // Uses multiple MCP servers
	})
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

// Example 4: Sub-agent with skills
func createAgentWithSkilledSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create sub-agent with skill references
	codingExpert, err := subagent.New("coding-expert", &subagent.Args{
		Instructions: "Provide coding guidance using best practices and internal documentation",
		Description:  "Coding expert with knowledge base",
		SkillRefs: []*types.ApiResourceReference{
			{Slug: "coding-best-practices", Scope: "platform"},
			{Slug: "design-patterns", Scope: "platform"},
			{Slug: "internal-apis", Scope: "organization", Org: "my-org"},
			{Slug: "architecture-guidelines", Scope: "organization", Org: "my-org"},
		},
	})
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

// Example 5: Sub-agent with tool selections
func createAgentWithSelectiveSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create MCP server using struct-args pattern
	github, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
		Command: "npx",
		Args:    []string{"-y", "@modelcontextprotocol/server-github"},
		EnvPlaceholders: map[string]string{
			"GITHUB_TOKEN": "${GITHUB_TOKEN}",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create GitHub MCP server: %w", err)
	}

	// Create sub-agents with tool selections
	issueManager, err := subagent.New("issue-manager", &subagent.Args{
		Instructions: "Manage GitHub issues only, cannot access other GitHub features",
		Description:  "Issue management specialist",
		McpServers:   []string{"github"},
		McpToolSelections: map[string]*types.McpToolSelection{
			"github": {EnabledTools: []string{"create_issue", "update_issue", "list_issues"}},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create issue manager: %w", err)
	}

	prReviewer, err := subagent.New("pr-reviewer", &subagent.Args{
		Instructions: "Review pull requests only, cannot modify issues or repositories",
		Description:  "Pull request reviewer",
		McpServers:   []string{"github"},
		McpToolSelections: map[string]*types.McpToolSelection{
			"github": {EnabledTools: []string{"list_pull_requests", "review_pull_request", "comment_on_pr"}},
		},
	})
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
		fmt.Printf("  [%d] %s: %s\n", i+1, sub.Name(), sub.Description())
	}

	fmt.Println("\nNote: When you run `stigmer deploy`, the CLI will convert this to proto and deploy to Stigmer.")
}
