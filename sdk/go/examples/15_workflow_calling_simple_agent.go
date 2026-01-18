//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates the simplest agent call pattern:
// A workflow calling a single agent with a static message.
//
// Key learning points:
// - Creating an agent in the same context
// - Referencing the agent from a workflow
// - Using workflow.Agent() for direct instance references
// - Basic agent call with a simple message
//
// This is the "Hello World" of agent-workflow integration.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// ============================================================================
		// Step 1: Create a simple agent
		// ============================================================================
		codeReviewer, err := agent.New(ctx,
			agent.WithName("code-reviewer"),
			agent.WithInstructions(`You are a code reviewer. Analyze code for:
- Best practices
- Potential bugs
- Security vulnerabilities
- Performance issues

Provide constructive feedback in a friendly tone.`),
			agent.WithDescription("AI code reviewer for pull requests"),
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Step 2: Create a workflow that calls the agent
		// ============================================================================
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("code-review"),
			workflow.WithName("simple-review"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Simple code review workflow"),
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Step 3: Call the agent with a static message
		// ============================================================================
		// Using workflow.Agent() to reference the agent instance
		reviewTask := wf.CallAgent(
			"reviewCode",
			workflow.AgentOption(workflow.Agent(codeReviewer)), // Direct instance reference
			workflow.Message("Please review this function:\n\n```go\nfunc divide(a, b int) int {\n    return a / b\n}\n```"),
		)

		log.Printf("✅ Created workflow: %s", wf.Document.Name)
		log.Printf("✅ Created agent call task: %s", reviewTask.Name)
		log.Printf("   - Agent: %s", codeReviewer.Name)
		log.Printf("   - Task kind: %s", reviewTask.Kind)

		return nil
	})

	if err != nil {
		log.Fatalf("❌ Error: %v", err)
	}

	log.Println("✅ Agent and workflow manifests created successfully!")
}
