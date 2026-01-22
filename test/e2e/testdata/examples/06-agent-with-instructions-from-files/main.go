//go:build ignore
// Example 06: Agent with Instructions from Files
//
// This example demonstrates:
// 1. Loading agent instructions and skill content from external files
// 2. Automatic synthesis using stigmer.Run()
//
// Benefits of loading from files:
// 1. Better organization - keep large instructions separate from code
// 2. Easy to edit - use your favorite markdown editor
// 3. Version control - track instruction changes independently
// 4. Reusability - share instruction files across multiple agents
// 5. Maintainability - easier to review and update long instructions
//
// Directory structure:
//
//	examples/
//	├── 06_agent_with_instructions_from_files.go
//	└── instructions/
//	    ├── code-reviewer.md          (agent instructions)
//	    ├── security-guidelines.md    (skill content)
//	    └── testing-best-practices.md (skill content)
//
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
		fmt.Println("=== Example 06: Agent with Instructions from Files ===\n")

		// Example 1: Basic agent with instructions from file
		basicAgent, err := createBasicAgentFromFile(ctx)
		if err != nil {
			return err
		}
		printAgent("1. Basic Agent with Instructions from File", basicAgent)

		// Example 2: Agent with inline skills loading markdown from files
		agentWithFileSkills, err := createAgentWithFileSkills(ctx)
		if err != nil {
			return err
		}
		printAgent("2. Agent with Skills Loaded from Files", agentWithFileSkills)

		// Example 3: Complex agent with everything from files
		complexAgent, err := createComplexAgentFromFiles(ctx)
		if err != nil {
			return err
		}
		printAgent("3. Complex Agent with All Content from Files", complexAgent)

		// Example 4: Sub-agent with instructions from file
		agentWithFileSubAgent, err := createAgentWithFileSubAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("4. Agent with Sub-Agent Instructions from File", agentWithFileSubAgent)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}

// Example 1: Basic agent with instructions from file
func createBasicAgentFromFile(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		// Load instructions from external file instead of inline string
		agent.WithInstructionsFromFile("instructions/code-reviewer.md"),
		agent.WithDescription("AI code reviewer with comprehensive guidelines"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}
	return ag, nil
}

// Example 2: Agent with inline skills loading markdown from files
func createAgentWithFileSkills(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create inline skills with content loaded from files
	securitySkill, err := skill.New(
		skill.WithName("security-guidelines"),
		skill.WithDescription("Comprehensive security review guidelines"),
		// Load skill markdown from external file
		skill.WithMarkdownFromFile("instructions/security-guidelines.md"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create security skill: %w", err)
	}

	testingSkill, err := skill.New(
		skill.WithName("testing-best-practices"),
		skill.WithDescription("Testing standards and best practices"),
		// Load skill markdown from external file
		skill.WithMarkdownFromFile("instructions/testing-best-practices.md"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create testing skill: %w", err)
	}

	ag, err := agent.New(ctx,
		agent.WithName("senior-reviewer"),
		agent.WithInstructionsFromFile("instructions/code-reviewer.md"),
		agent.WithDescription("Senior code reviewer with security and testing expertise"),
		agent.WithSkills(*securitySkill, *testingSkill),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}
	return ag, nil
}

// Example 3: Complex agent with everything from files
func createComplexAgentFromFiles(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create MCP server
	github, err := mcpserver.Stdio(
		mcpserver.WithName("github"),
		mcpserver.WithCommand("npx"),
		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create GitHub MCP server: %w", err)
	}

	// Create skills from files
	securitySkill, err := skill.New(
		skill.WithName("security-guidelines"),
		skill.WithDescription("Security review guidelines"),
		skill.WithMarkdownFromFile("instructions/security-guidelines.md"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create security skill: %w", err)
	}

	testingSkill, err := skill.New(
		skill.WithName("testing-best-practices"),
		skill.WithDescription("Testing best practices"),
		skill.WithMarkdownFromFile("instructions/testing-best-practices.md"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create testing skill: %w", err)
	}

	// Create agent with everything from files
	ag, err := agent.New(ctx,
		agent.WithName("github-reviewer"),
		agent.WithInstructionsFromFile("instructions/code-reviewer.md"),
		agent.WithDescription("GitHub PR reviewer with comprehensive guidelines"),
		agent.WithMCPServer(github),
		agent.WithSkills(*securitySkill, *testingSkill),
		// Also reference platform skills
		agent.WithSkill(skill.Platform("coding-best-practices")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}
	return ag, nil
}

// Example 4: Sub-agent with instructions from file
func createAgentWithFileSubAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create sub-agent with instructions loaded from file
	securitySpecialist, err := subagent.Inline(
		subagent.WithName("security-specialist"),
		subagent.WithInstructionsFromFile("instructions/security-guidelines.md"),
		subagent.WithDescription("Security-focused code analyzer"),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create security specialist: %w", err)
	}

	ag, err := agent.New(ctx,
		agent.WithName("orchestrator"),
		agent.WithInstructionsFromFile("instructions/code-reviewer.md"),
		agent.WithDescription("Main orchestrator with specialized sub-agents"),
		agent.WithSubAgent(securitySpecialist),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}
	return ag, nil
}

// Helper function to print agent information
func printAgent(title string, ag *agent.Agent) {
	fmt.Printf("\n%s\n", title)
	fmt.Println("=" + string(make([]byte, len(title))))
	fmt.Printf("Agent Name: %s\n", ag.Name)
	fmt.Printf("Description: %s\n", ag.Description)
	fmt.Printf("Instructions Length: %d characters\n", len(ag.Instructions))
	fmt.Printf("Skills: %d\n", len(ag.Skills))
	fmt.Printf("MCP Servers: %d\n", len(ag.MCPServers))
	fmt.Printf("Sub-Agents: %d\n", len(ag.SubAgents))

	// Show first 100 chars of instructions to verify they were loaded
	if len(ag.Instructions) > 0 {
		preview := ag.Instructions
		if len(preview) > 100 {
			preview = preview[:100] + "..."
		}
		fmt.Printf("Instructions Preview: %s\n", preview)
	}

	fmt.Println("\n✅ Files loaded successfully!")
}
