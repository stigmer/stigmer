//go:build ignore
// Example 02: Agent with Skills
//
// This example demonstrates how to add skills to an agent.
// Skills provide knowledge and capabilities to agents.
// There are three types:
// 1. Inline: Created in your repository with name, description, and markdown content
// 2. Platform: Shared across all users (referenced by slug)
// 3. Organization: Private to your org (referenced by org + slug)
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
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

		// Example 2: Create agent with inline skill
		agentWithInline, err := agent.New(ctx,
			agent.WithName("code-reviewer"),
			agent.WithInstructions("Review code and suggest improvements based on best practices"),
			agent.WithDescription("AI code reviewer with custom inline skill"),
			agent.WithSkill(*inlineSkill),
		)
		if err != nil {
			return fmt.Errorf("failed to create agent with inline skill: %w", err)
		}

		fmt.Println("✅ Created agent with inline skill:")
		fmt.Printf("   Name: %s\n", agentWithInline.Name)
		fmt.Printf("   Skills: %d\n", len(agentWithInline.Skills))
		for i, s := range agentWithInline.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 3: Agent with platform skills (referenced)
		platformAgent, err := agent.New(ctx,
			agent.WithName("security-reviewer"),
			agent.WithInstructions("Review code for security vulnerabilities"),
			agent.WithDescription("AI security reviewer with platform skills"),
			// Add platform skills (shared across all users)
			agent.WithSkill(skill.Platform("coding-best-practices")),
			agent.WithSkill(skill.Platform("security-analysis")),
		)
		if err != nil {
			return fmt.Errorf("failed to create platform agent: %w", err)
		}

		fmt.Println("\n✅ Created agent with platform skills:")
		fmt.Printf("   Name: %s\n", platformAgent.Name)
		fmt.Printf("   Skills: %d platform skills\n", len(platformAgent.Skills))
		for i, s := range platformAgent.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 4: Agent with organization skills (referenced)
		orgAgent, err := agent.New(ctx,
			agent.WithName("internal-reviewer"),
			agent.WithInstructions("Review code according to internal guidelines"),
			agent.WithDescription("Internal code reviewer with org-specific skills"),
			// Add organization-specific skills (private to your org)
			agent.WithSkill(skill.Organization("my-org", "internal-coding-standards")),
			agent.WithSkill(skill.Organization("my-org", "proprietary-frameworks")),
		)
		if err != nil {
			return fmt.Errorf("failed to create org agent: %w", err)
		}

		fmt.Println("\n✅ Created agent with organization skills:")
		fmt.Printf("   Name: %s\n", orgAgent.Name)
		fmt.Printf("   Skills: %d organization skills\n", len(orgAgent.Skills))
		for i, s := range orgAgent.Skills {
			fmt.Printf("     %d. %s\n", i+1, s)
		}

		// Example 5: Agent with mixed skills (inline + platform + org)
		// Also demonstrates builder pattern with AddSkill()
		mixedAgent, err := agent.New(ctx,
			agent.WithName("enterprise-reviewer"),
			agent.WithInstructions("Review code using all available knowledge"),
			agent.WithDescription("Enterprise code reviewer with mixed skills"),
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
		bulkAgent, err := agent.New(ctx,
			agent.WithName("bulk-reviewer"),
			agent.WithInstructions("Review code with many skills"),
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
