//go:build ignore

// Example 06: Agent with Organized Content
//
// This example demonstrates:
//  1. Organizing large instructions as Go variables (better code organization)
//  2. Referencing skills that are managed separately
//  3. Using multi-line strings for complex agent instructions
//
// IMPORTANT: The SDK references skills - it doesn't create them.
// To use custom skills:
//  1. Create skill content files (e.g., security-guidelines.md)
//  2. Push skills via CLI: stigmer skill push security-guidelines.md
//  3. Reference skills in your agent using skillref.Platform() or skillref.Organization()
//
// For better organization in larger projects, define instructions
// as variables in separate Go files (e.g., instructions.go).
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/skillref"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// =============================================================================
// Organized Content: Define instructions as variables
// =============================================================================
// In larger projects, move these to separate files like:
//   - instructions/code_review.go
//   - instructions/security.go

var (
	// codeReviewInstructions defines the core behavior for the code reviewer agent.
	// Using a variable allows for:
	//   - Better code organization
	//   - Easier testing and modification
	//   - Reuse across multiple agents
	codeReviewInstructions = `You are a professional code reviewer.

Your responsibilities:
1. Review code for correctness, efficiency, and maintainability
2. Check for security vulnerabilities
3. Ensure coding standards are followed
4. Provide constructive feedback
5. Suggest improvements and best practices

Always be respectful and educational in your reviews.`

	// seniorReviewerInstructions extends the basic instructions with more context.
	seniorReviewerInstructions = `You are a senior code reviewer with expertise in security and testing.

Your responsibilities:
1. Perform comprehensive code reviews
2. Apply security best practices (use your security-guidelines skill)
3. Verify testing coverage (use your testing-best-practices skill)
4. Mentor junior developers through constructive feedback
5. Ensure architectural consistency

Leverage your skill references for detailed guidelines on security and testing.
Always explain the "why" behind your recommendations.`
)

// =============================================================================
// Skill Content (for reference - created via CLI)
// =============================================================================
// These markdown strings show what the skill content might look like.
// In practice, save these to .md files and push via: stigmer skill push <file>

var (
	// This would be saved to security-guidelines.md and pushed as a skill
	_ = `# Security Review Guidelines

## Key Security Checks

1. **Input Validation**
   - Validate all user inputs
   - Use parameterized queries
   - Sanitize data before output

2. **Authentication & Authorization**
   - Verify proper access controls
   - Check session management
   - Review credential handling

3. **Data Protection**
   - Ensure encryption at rest and in transit
   - Check for sensitive data exposure
   - Verify secure communication`

	// This would be saved to testing-best-practices.md and pushed as a skill
	_ = `# Testing Best Practices

## Testing Standards

1. **Unit Tests**
   - Test each function in isolation
   - Use meaningful test names
   - Cover edge cases

2. **Integration Tests**
   - Test component interactions
   - Verify data flow
   - Test error scenarios

3. **Code Coverage**
   - Aim for 80%+ coverage
   - Focus on critical paths
   - Don't just chase numbers`
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Example 06: Agent with Organized Content ===\n")

		// =============================================================================
		// Example 1: Basic agent with organized instructions
		// =============================================================================
		basicAgent, err := createBasicAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("1. Basic Agent with Organized Instructions", basicAgent)

		// =============================================================================
		// Example 2: Agent with skill references
		// =============================================================================
		// Skills are managed separately (via CLI) and referenced here.
		// The skill content is defined elsewhere and pushed to the platform.
		agentWithSkills, err := createAgentWithSkillRefs(ctx)
		if err != nil {
			return err
		}
		printAgent("2. Agent with Skill References", agentWithSkills)

		// =============================================================================
		// Summary
		// =============================================================================
		fmt.Println("\n=== Summary ===")
		fmt.Println("This example demonstrates:")
		fmt.Println("  1. Organizing instructions as Go variables (code organization)")
		fmt.Println("  2. Referencing skills that are managed separately")
		fmt.Println()
		fmt.Println("Skill management workflow:")
		fmt.Println("  1. Create skill content as .md files")
		fmt.Println("  2. Push skills: stigmer skill push security-guidelines.md")
		fmt.Println("  3. Reference skills: skillref.Platform(\"security-guidelines\")")
		fmt.Println()
		fmt.Println("Benefits of this pattern:")
		fmt.Println("  - Instructions are version-controlled with your code")
		fmt.Println("  - Skills are reusable across multiple agents")
		fmt.Println("  - Clear separation of concerns")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}

// createBasicAgent creates an agent with instructions from a variable.
// This pattern helps organize large instruction sets.
func createBasicAgent(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
		Instructions: codeReviewInstructions,
		Description:  "AI code reviewer with comprehensive guidelines",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}
	return ag, nil
}

// createAgentWithSkillRefs creates an agent that references platform skills.
// The skills must exist on the platform (created via CLI).
func createAgentWithSkillRefs(ctx *stigmer.Context) (*agent.Agent, error) {
	ag, err := agent.New(ctx, "senior-reviewer", &agent.AgentArgs{
		Instructions: seniorReviewerInstructions,
		Description:  "Senior code reviewer with security and testing expertise",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Reference skills that were created via CLI
	// These skills must exist on the platform before the agent can use them
	ag.AddSkillRefs(
		skillref.Platform("security-guidelines"),
		skillref.Platform("testing-best-practices"),
		skillref.Platform("coding-best-practices"),
	)

	return ag, nil
}

// printAgent displays agent information for demonstration.
func printAgent(title string, ag *agent.Agent) {
	fmt.Printf("\n%s\n", title)
	fmt.Println("=" + string(make([]byte, len(title))))
	fmt.Printf("Agent Name: %s\n", ag.Name)
	fmt.Printf("Description: %s\n", ag.Description)
	fmt.Printf("Instructions Length: %d characters\n", len(ag.Instructions))
	fmt.Printf("Skill Refs: %d\n", len(ag.SkillRefs))

	// Show skill refs if any
	if len(ag.SkillRefs) > 0 {
		fmt.Println("Referenced Skills:")
		for i, ref := range ag.SkillRefs {
			fmt.Printf("  %d. %s (scope: %s)\n", i+1, ref.Slug, ref.Scope)
		}
	}

	// Show first 100 chars of instructions
	if len(ag.Instructions) > 0 {
		preview := ag.Instructions
		if len(preview) > 100 {
			preview = preview[:100] + "..."
		}
		fmt.Printf("Instructions Preview: %s\n", preview)
	}

	fmt.Println("\nAgent created successfully!")
}
