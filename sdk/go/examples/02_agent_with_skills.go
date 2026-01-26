//go:build ignore

// Example 02: Agent with Skill References
//
// This example demonstrates how to add skill references to an agent.
// Skills provide knowledge and capabilities to agents.
//
// IMPORTANT: The SDK references skills - it doesn't create them.
// Skills are managed separately (created via CLI or UI) and referenced here.
//
// There are two scopes for skill references:
//  1. Platform: Shared across all users (referenced by slug)
//  2. Organization: Private to your org (referenced by org + slug)
//
// Skills are added using builder methods (AddSkillRef, AddSkillRefs) after agent creation.
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/skillref"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Agent with Skill References Example ===\n")

		// =============================================================================
		// Example 1: Agent with platform skill references
		// =============================================================================
		// Platform skills are shared across all users on the platform.
		// Reference them by slug - the skill must exist on the platform.
		platformAgent, err := agent.New(ctx, "security-reviewer", &agent.AgentArgs{
			Instructions: "Review code for security vulnerabilities using security best practices",
			Description:  "AI security reviewer with platform skills",
		})
		if err != nil {
			return fmt.Errorf("failed to create platform agent: %w", err)
		}

		// Add platform skill references using builder pattern
		platformAgent.
			AddSkillRef(skillref.Platform("coding-best-practices")).
			AddSkillRef(skillref.Platform("security-analysis"))

		fmt.Println("Created agent with platform skill references:")
		fmt.Printf("   Name: %s\n", platformAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(platformAgent.SkillRefs))
		for i, ref := range platformAgent.SkillRefs {
			fmt.Printf("     %d. %s (scope: %s)\n", i+1, ref.Slug, ref.Scope)
		}

		// =============================================================================
		// Example 2: Agent with organization skill references
		// =============================================================================
		// Organization skills are private to your org.
		// Reference them by org + slug - the skill must exist in your organization.
		orgAgent, err := agent.New(ctx, "internal-reviewer", &agent.AgentArgs{
			Instructions: "Review code according to internal guidelines and proprietary frameworks",
			Description:  "Internal code reviewer with org-specific skills",
		})
		if err != nil {
			return fmt.Errorf("failed to create org agent: %w", err)
		}

		// Add organization skill references
		orgAgent.
			AddSkillRef(skillref.Organization("my-org", "internal-coding-standards")).
			AddSkillRef(skillref.Organization("my-org", "proprietary-frameworks"))

		fmt.Println("\nCreated agent with organization skill references:")
		fmt.Printf("   Name: %s\n", orgAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(orgAgent.SkillRefs))
		for i, ref := range orgAgent.SkillRefs {
			fmt.Printf("     %d. %s (org: %s, scope: %s)\n", i+1, ref.Slug, ref.Org, ref.Scope)
		}

		// =============================================================================
		// Example 3: Agent with mixed skill references (platform + organization)
		// =============================================================================
		// Combine platform and organization skills for comprehensive knowledge.
		mixedAgent, err := agent.New(ctx, "enterprise-reviewer", &agent.AgentArgs{
			Instructions: "Review code using both platform best practices and internal guidelines",
			Description:  "Enterprise code reviewer with mixed skill references",
		})
		if err != nil {
			return fmt.Errorf("failed to create mixed agent: %w", err)
		}

		// Use builder pattern to add skill refs after creation
		mixedAgent.
			AddSkillRef(skillref.Platform("coding-best-practices")).
			AddSkillRef(skillref.Platform("security-analysis")).
			AddSkillRef(skillref.Organization("my-org", "internal-security-guidelines"))

		fmt.Println("\nCreated agent with mixed skill references:")
		fmt.Printf("   Name: %s\n", mixedAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(mixedAgent.SkillRefs))
		for i, ref := range mixedAgent.SkillRefs {
			scopeInfo := string(ref.Scope)
			if ref.Org != "" {
				scopeInfo = fmt.Sprintf("%s, org: %s", ref.Scope, ref.Org)
			}
			fmt.Printf("     %d. %s (%s)\n", i+1, ref.Slug, scopeInfo)
		}

		// =============================================================================
		// Example 4: Bulk add skill references using AddSkillRefs()
		// =============================================================================
		// Use AddSkillRefs() to add multiple skill references at once.
		bulkAgent, err := agent.New(ctx, "comprehensive-reviewer", &agent.AgentArgs{
			Instructions: "Review code comprehensively using multiple knowledge sources",
			Description:  "Code reviewer with many skill references",
		})
		if err != nil {
			return fmt.Errorf("failed to create bulk agent: %w", err)
		}

		// Add multiple skill refs in one call
		bulkAgent.AddSkillRefs(
			skillref.Platform("coding-best-practices"),
			skillref.Platform("security-analysis"),
			skillref.Platform("performance-optimization"),
			skillref.Organization("my-org", "compliance-requirements"),
			skillref.Organization("my-org", "api-design-guidelines"),
		)

		fmt.Println("\nCreated agent with bulk skill references:")
		fmt.Printf("   Name: %s\n", bulkAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(bulkAgent.SkillRefs))

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

		versionedAgent.AddSkillRefs(
			skillref.Platform("coding-best-practices"),              // Latest version (default)
			skillref.Platform("security-analysis", "v2.0"),          // Specific tag version
			skillref.Platform("performance-optimization", "stable"), // Stable tag
			skillref.Organization("my-org", "internal-standards", "v1.5"),
		)

		fmt.Println("\nCreated agent with versioned skill references:")
		fmt.Printf("   Name: %s\n", versionedAgent.Name)
		fmt.Printf("   Skill Refs: %d\n", len(versionedAgent.SkillRefs))
		for i, ref := range versionedAgent.SkillRefs {
			version := ref.Version
			if version == "" {
				version = "latest"
			}
			fmt.Printf("     %d. %s (version: %s)\n", i+1, ref.Slug, version)
		}

		// =============================================================================
		// Summary
		// =============================================================================
		fmt.Println("\n=== Summary ===")
		fmt.Println("Created 5 agents demonstrating skill reference patterns:")
		fmt.Println("  1. Platform skill references (shared across platform)")
		fmt.Println("  2. Organization skill references (private to org)")
		fmt.Println("  3. Mixed skill references (platform + org)")
		fmt.Println("  4. Bulk skill references (AddSkillRefs)")
		fmt.Println("  5. Versioned skill references (pinned versions)")
		fmt.Println()
		fmt.Println("Key concepts:")
		fmt.Println("  - SDK references skills, doesn't create them")
		fmt.Println("  - Skills are managed via CLI: stigmer skill push")
		fmt.Println("  - Use skillref.Platform() for platform-scoped skills")
		fmt.Println("  - Use skillref.Organization() for org-scoped skills")
		fmt.Println("  - Optional version parameter for reproducibility")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
