//go:build ignore

// Example 06: Agent with Inline Content
//
// This example demonstrates:
// 1. Creating agents with inline instructions and skills
// 2. Organizing large content in separate Go variables
// 3. Automatic synthesis using stigmer.Run()
//
// For better organization, define your instructions and skill content
// as variables in separate Go files (e.g., instructions.go, skills.go)
// and reference them here.
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Define instructions as variables (can be in separate files)
var (
	codeReviewInstructions = `You are a professional code reviewer.

Your responsibilities:
1. Review code for correctness, efficiency, and maintainability
2. Check for security vulnerabilities
3. Ensure coding standards are followed
4. Provide constructive feedback
5. Suggest improvements and best practices

Always be respectful and educational in your reviews.`

	securityGuidelinesMarkdown = `# Security Review Guidelines

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

	testingBestPracticesMarkdown = `# Testing Best Practices

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
		fmt.Println("=== Example 06: Agent with Inline Content ===\n")

		// Example 1: Basic agent with inline instructions
		basicAgent, err := createBasicAgent(ctx)
		if err != nil {
			return err
		}
		printAgent("1. Basic Agent", basicAgent)

		// Example 2: Agent with inline skills
		agentWithSkills, err := createAgentWithSkills(ctx)
		if err != nil {
			return err
		}
		printAgent("2. Agent with Inline Skills", agentWithSkills)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}

// Example 1: Basic agent with instructions from variable
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

// Example 2: Agent with inline skills using variables
func createAgentWithSkills(ctx *stigmer.Context) (*agent.Agent, error) {
	// Create inline skills with content from variables
	securitySkill, err := skill.New("security-guidelines", &skill.SkillArgs{
		Description:     "Comprehensive security review guidelines",
		MarkdownContent: securityGuidelinesMarkdown,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create security skill: %w", err)
	}

	testingSkill, err := skill.New("testing-best-practices", &skill.SkillArgs{
		Description:     "Testing standards and best practices",
		MarkdownContent: testingBestPracticesMarkdown,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create testing skill: %w", err)
	}

	ag, err := agent.New(ctx, "senior-reviewer", &agent.AgentArgs{
		Instructions: codeReviewInstructions,
		Description:  "Senior code reviewer with security and testing expertise",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	// Add skills using builder method
	ag.AddSkills(*securitySkill, *testingSkill)

	// Also add platform skills
	ag.AddSkill(skill.Platform("coding-best-practices"))

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

	// Show first 100 chars of instructions
	if len(ag.Instructions) > 0 {
		preview := ag.Instructions
		if len(preview) > 100 {
			preview = preview[:100] + "..."
		}
		fmt.Printf("Instructions Preview: %s\n", preview)
	}

	fmt.Println("\n✅ Agent created successfully!")
}
