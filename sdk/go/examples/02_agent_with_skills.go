//go:build ignore

// Example 02: Agent with Skills
//
// This example demonstrates how to add skills to an agent using the new generated options API.
// Skills provide knowledge and capabilities to agents.
// There are three types:
// 1. Inline: Created in your repository with name, description, and markdown content
// 2. Platform: Shared across all users (referenced by slug)
// 3. Organization: Private to your org (referenced by org + slug)
//
// Note: Skills are added using builder methods (AddSkill, AddSkills) after agent creation.
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/agent/gen"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Agent with Skills Example ===\n")

		// Example 1: Inline skill (created in your repository)
		// The CLI will create this skill on the platform before creating the agent
		inlineSkill, err := skill.New(
			skill.WithName("code-analyzer"),
			skill.WithDescription("Analyzes code quality and suggests improvements"),
			skill.WithMarkdown("# Code Analysis\n\nThis skill analyzes code for best practices..."),
		)
		if err != nil {
			return fmt.Errorf("failed to create inline skill: %w", err)
		}

		// Example 2: Create agent with inline skill using builder pattern
		agentWithInline, err := agent.New(ctx, "code-reviewer",
			gen.AgentInstructions("Review code and suggest improvements based on best practices"),
			gen.AgentDescription("AI code reviewer with custom inline skill"),
		)
		if err != nil {
			return fmt.Errorf("failed to create agent with inline skill: %w", err)
		}
		agentWithInline.AddSkill(*inlineSkill)

		fmt.Println("✅ Created agent with inline skill:")
		fmt.Printf("   Name: %s\n", agentWithInline.Name)
		fmt.Printf("   Skills: %d\n", len(agentWithInline.Skills))
		for i, s := range agentWithInline.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 3: Agent with platform skills (referenced)
		platformAgent, err := agent.New(ctx, "security-reviewer",
			gen.AgentInstructions("Review code for security vulnerabilities"),
			gen.AgentDescription("AI security reviewer with platform skills"),
		)
		if err != nil {
			return fmt.Errorf("failed to create platform agent: %w", err)
		}
		// Add platform skills (shared across all users) using builder pattern
		platformAgent.
			AddSkill(skill.Platform("coding-best-practices")).
			AddSkill(skill.Platform("security-analysis"))

		fmt.Println("\n✅ Created agent with platform skills:")
		fmt.Printf("   Name: %s\n", platformAgent.Name)
		fmt.Printf("   Skills: %d platform skills\n", len(platformAgent.Skills))
		for i, s := range platformAgent.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 4: Agent with organization skills (referenced)
		orgAgent, err := agent.New(ctx, "internal-reviewer",
			gen.AgentInstructions("Review code according to internal guidelines"),
			gen.AgentDescription("Internal code reviewer with org-specific skills"),
		)
		if err != nil {
			return fmt.Errorf("failed to create org agent: %w", err)
		}
		// Add organization-specific skills (private to your org)
		orgAgent.
			AddSkill(skill.Organization("my-org", "internal-coding-standards")).
			AddSkill(skill.Organization("my-org", "proprietary-frameworks"))

		fmt.Println("\n✅ Created agent with organization skills:")
		fmt.Printf("   Name: %s\n", orgAgent.Name)
		fmt.Printf("   Skills: %d organization skills\n", len(orgAgent.Skills))
		for i, s := range orgAgent.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 5: Agent with mixed skills (inline + platform + org)
		// Demonstrates builder pattern with AddSkill()
		mixedAgent, err := agent.New(ctx, "enterprise-reviewer",
			gen.AgentInstructions("Review code using all available knowledge"),
			gen.AgentDescription("Enterprise code reviewer with mixed skills"),
		)
		if err != nil {
			return fmt.Errorf("failed to create mixed agent: %w", err)
		}

		// Use builder pattern to add skills after creation
		mixedAgent.
			AddSkill(*inlineSkill).
			AddSkill(skill.Platform("coding-best-practices")).
			AddSkill(skill.Organization("my-org", "internal-security-guidelines"))

		fmt.Println("\n✅ Created agent with mixed skills (using builder pattern):")
		fmt.Printf("   Name: %s\n", mixedAgent.Name)
		fmt.Printf("   Skills:\n")
		for i, s := range mixedAgent.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 6: Bulk add skills using AddSkills()
		bulkAgent, err := agent.New(ctx, "bulk-reviewer",
			gen.AgentInstructions("Review code with many skills"),
		)
		if err != nil {
			return fmt.Errorf("failed to create bulk agent: %w", err)
		}

		bulkAgent.AddSkills(
			*inlineSkill,
			skill.Platform("security-analysis"),
			skill.Platform("performance-optimization"),
			skill.Organization("my-org", "compliance-requirements"),
		)

		fmt.Println("\n✅ Created agent with bulk added skills:")
		fmt.Printf("   Name: %s\n", bulkAgent.Name)
		fmt.Printf("   Skills: %d\n", len(bulkAgent.Skills))

		fmt.Println("\n✅ Example completed successfully!")
		fmt.Println("\nNote: When you run `stigmer deploy`, the CLI will:")
		fmt.Println("  1. Create inline skills on the platform")
		fmt.Println("  2. Convert all skills to ApiResourceReference")
		fmt.Println("  3. Create the agent with skill references")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
