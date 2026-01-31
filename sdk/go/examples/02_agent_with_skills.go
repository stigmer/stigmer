//go:build ignore

// Example 02: Agent with Skill References
//
// This example demonstrates how to add skill references to an agent.
// Skills provide knowledge and capabilities to agents.
//
// IMPORTANT: The SDK references skills - it doesn't create them.
// Skills are managed separately (created via CLI or UI) and referenced here.
//
// All skills belong to an organization and are referenced using the org/slug format.
// - Public skills (e.g., stigmer/coding-best-practices) are available to all users
// - Private skills (e.g., my-org/internal-docs) are only visible to org members
//
// Skills are added using builder methods (AddSkill, AddSkills) after agent creation.
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Agent with Skill References Example ===\n")

		// =============================================================================
		// Example 1: Agent with public skill references (from stigmer org)
		// =============================================================================
		// Public skills are available to all users on the platform.
		// Reference them using the org/slug format.
		publicAgent, err := agent.New(ctx, "security-reviewer", &agent.AgentArgs{
			Instructions: "Review code for security vulnerabilities using security best practices",
			Description:  "AI security reviewer with public skills",
		})
		if err != nil {
			return fmt.Errorf("failed to create public agent: %w", err)
		}

		// Add public skill references using smart parsing
		publicAgent.
			AddSkill("stigmer/coding-best-practices").
			AddSkill("stigmer/security-analysis")

		fmt.Println("Created agent with public skill references:")
		fmt.Printf("   Name: %s\n", publicAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(publicAgent.SkillRefs))
		for i, ref := range publicAgent.SkillRefs {
			fmt.Printf("     %d. %s/%s\n", i+1, ref.Org, ref.Slug)
		}

		// =============================================================================
		// Example 2: Agent with private organization skill references
		// =============================================================================
		// Private skills are only visible to your organization.
		// Reference them using the org/slug format.
		orgAgent, err := agent.New(ctx, "internal-reviewer", &agent.AgentArgs{
			Instructions: "Review code according to internal guidelines and proprietary frameworks",
			Description:  "Internal code reviewer with org-specific skills",
		})
		if err != nil {
			return fmt.Errorf("failed to create org agent: %w", err)
		}

		// Add private organization skill references
		orgAgent.
			AddSkill("my-org/internal-coding-standards").
			AddSkill("my-org/proprietary-frameworks")

		fmt.Println("\nCreated agent with private organization skill references:")
		fmt.Printf("   Name: %s\n", orgAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(orgAgent.SkillRefs))
		for i, ref := range orgAgent.SkillRefs {
			fmt.Printf("     %d. %s/%s\n", i+1, ref.Org, ref.Slug)
		}

		// =============================================================================
		// Example 3: Agent with mixed skill references (public + private)
		// =============================================================================
		// Combine public and private skills for comprehensive knowledge.
		mixedAgent, err := agent.New(ctx, "enterprise-reviewer", &agent.AgentArgs{
			Instructions: "Review code using both public best practices and internal guidelines",
			Description:  "Enterprise code reviewer with mixed skill references",
		})
		if err != nil {
			return fmt.Errorf("failed to create mixed agent: %w", err)
		}

		// Use AddSkills for batch addition
		mixedAgent.AddSkills(
			"stigmer/coding-best-practices",
			"stigmer/security-analysis",
			"my-org/internal-security-guidelines",
		)

		fmt.Println("\nCreated agent with mixed skill references:")
		fmt.Printf("   Name: %s\n", mixedAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(mixedAgent.SkillRefs))
		for i, ref := range mixedAgent.SkillRefs {
			fmt.Printf("     %d. %s/%s\n", i+1, ref.Org, ref.Slug)
		}

		// =============================================================================
		// Example 4: Agent using agent.Org for slug-only references
		// =============================================================================
		// When agent.Org is set, you can use slug-only references
		// which will automatically use the agent's org.
		autoOrgAgent, err := agent.New(ctx, "my-org-reviewer", &agent.AgentArgs{
			Instructions: "Review code using organization-specific guidelines",
			Description:  "Organization code reviewer with smart org resolution",
		})
		if err != nil {
			return fmt.Errorf("failed to create auto-org agent: %w", err)
		}

		// Set the agent's org for slug-only references
		autoOrgAgent.Org = "my-org"

		// Now slug-only references will use "my-org" as the org
		autoOrgAgent.
			AddSkill("internal-coding-standards"). // Resolves to my-org/internal-coding-standards
			AddSkill("proprietary-frameworks").    // Resolves to my-org/proprietary-frameworks
			AddSkill("stigmer/security-analysis")  // Explicit org still works

		fmt.Println("\nCreated agent with auto-resolved org references:")
		fmt.Printf("   Name: %s\n", autoOrgAgent.Name)
		fmt.Printf("   Agent Org: %s\n", autoOrgAgent.Org)
		fmt.Printf("   Skill Refs: %d\n", len(autoOrgAgent.SkillRefs))
		for i, ref := range autoOrgAgent.SkillRefs {
			fmt.Printf("     %d. %s/%s\n", i+1, ref.Org, ref.Slug)
		}

		// =============================================================================
		// Example 5: Skill references with versions
		// =============================================================================
		// You can optionally specify a version for skill references.
		// Versions can be: empty (latest), tag name (e.g., "v1.0"), or exact hash.
		versionedAgent, err := agent.New(ctx, "versioned-reviewer", &agent.AgentArgs{
			Instructions: "Review code using specific skill versions for reproducibility",
			Description:  "Code reviewer with versioned skill references",
		})
		if err != nil {
			return fmt.Errorf("failed to create versioned agent: %w", err)
		}

		versionedAgent.
			AddSkill("stigmer/coding-best-practices").                          // Latest version (default)
			AddSkill("stigmer/security-analysis@v2.0").                         // Specific tag version
			AddSkill("stigmer/performance-optimization@stable").                // Stable tag
			AddSkill("my-org/internal-standards@v1.5", agent.AtVersion("v1.5")) // Using option

		fmt.Println("\nCreated agent with versioned skill references:")
		fmt.Printf("   Name: %s\n", versionedAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(versionedAgent.SkillRefs))
		for i, ref := range versionedAgent.SkillRefs {
			version := ref.Version
			if version == "" {
				version = "latest"
			}
			fmt.Printf("     %d. %s/%s (version: %s)\n", i+1, ref.Org, ref.Slug, version)
		}

		// =============================================================================
		// Summary
		// =============================================================================
		fmt.Println("\n=== Summary ===")
		fmt.Println("Created 5 agents demonstrating skill reference patterns:")
		fmt.Println("  1. Public skill references (stigmer/skill-name)")
		fmt.Println("  2. Private organization skill references (my-org/skill-name)")
		fmt.Println("  3. Mixed skill references (public + private)")
		fmt.Println("  4. Auto-resolved org references (agent.Org + slug)")
		fmt.Println("  5. Versioned skill references (pinned versions)")
		fmt.Println()
		fmt.Println("Key concepts:")
		fmt.Println("  - SDK references skills, doesn't create them")
		fmt.Println("  - Skills are managed via CLI: stigmer skill push")
		fmt.Println("  - Use org/slug format for all skill references")
		fmt.Println("  - Set agent.Org for slug-only references")
		fmt.Println("  - Optional @version suffix or AtVersion() option")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
