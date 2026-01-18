//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates configuring agent execution parameters:
// - Model override (use different LLM model)
// - Timeout control (task-specific execution limits)
// - Temperature tuning (control randomness/creativity)
//
// Key learning points:
// - Using workflow.AgentModel() to override agent's default model
// - Using workflow.AgentTimeout() for time-sensitive tasks
// - Using workflow.AgentTemperature() for creativity control
// - Different configs for different use cases
//
// Real-world scenarios:
// - Fast model for simple tasks, powerful model for complex tasks
// - Low temperature for deterministic output, high for creative tasks
// - Short timeout for quick checks, long timeout for deep analysis
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("execution-config"),
			workflow.WithName("agent-config-demo"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Demonstrates agent execution configuration"),
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Scenario 1: Fast, deterministic task
		// Use case: Categorize support tickets
		// ============================================================================
		categorizeTicket := wf.CallAgent(
			"categorizeTicket",
			workflow.AgentOption(workflow.AgentBySlug("support-categorizer")),
			workflow.Message("Categorize this support ticket: 'My login is not working'"),
			// Fast model for simple categorization
			workflow.AgentModel("claude-3-haiku"),
			// Low temperature for consistent categorization
			workflow.AgentTemperature(0.1),
			// Short timeout - categorization should be quick
			workflow.AgentTimeout(30), // 30 seconds
		)
		log.Println("✅ Fast deterministic task: categorizeTicket")
		log.Println("   Model: claude-3-haiku (fast)")
		log.Println("   Temperature: 0.1 (deterministic)")
		log.Println("   Timeout: 30s (quick)")

		// ============================================================================
		// Scenario 2: Deep analysis task
		// Use case: Architectural review of complex system
		// ============================================================================
		architectureReview := wf.CallAgent(
			"architectureReview",
			workflow.AgentOption(workflow.AgentBySlug("senior-architect")),
			workflow.Message(workflow.Interpolate(
				"Review the architecture of this microservices system:\n",
				categorizeTicket.Field("system_info"), // Uses output from previous task
			)),
			// Powerful model for complex reasoning
			workflow.AgentModel("claude-3-5-sonnet"),
			// Medium temperature for balanced analysis
			workflow.AgentTemperature(0.5),
			// Long timeout for thorough analysis
			workflow.AgentTimeout(600), // 10 minutes
		)
		log.Println("✅ Deep analysis task: architectureReview")
		log.Println("   Model: claude-3-5-sonnet (powerful)")
		log.Println("   Temperature: 0.5 (balanced)")
		log.Println("   Timeout: 600s (thorough)")

		// ============================================================================
		// Scenario 3: Creative content generation
		// Use case: Write marketing copy
		// ============================================================================
		generateCopy := wf.CallAgent(
			"generateCopy",
			workflow.AgentOption(workflow.AgentBySlug("content-writer")),
			workflow.Message("Write engaging marketing copy for a new AI code review tool"),
			// Creative model
			workflow.AgentModel("claude-3-5-sonnet"),
			// High temperature for creative output
			workflow.AgentTemperature(0.9),
			// Moderate timeout
			workflow.AgentTimeout(120), // 2 minutes
		)
		log.Println("✅ Creative task: generateCopy")
		log.Println("   Model: claude-3-5-sonnet")
		log.Println("   Temperature: 0.9 (creative)")
		log.Println("   Timeout: 120s")

		// ============================================================================
		// Scenario 4: Structured data extraction (deterministic)
		// Use case: Extract fields from unstructured text
		// ============================================================================
		extractData := wf.CallAgent(
			"extractData",
			workflow.AgentOption(workflow.AgentBySlug("data-extractor")),
			workflow.Message(workflow.Interpolate(
				"Extract structured data from this marketing copy:\n",
				generateCopy.Field("content"), // Use output from creative task
			)),
			// Fast model sufficient for extraction
			workflow.AgentModel("claude-3-haiku"),
			// Very low temperature for consistent extraction
			workflow.AgentTemperature(0.0), // Maximum determinism
			// Quick extraction
			workflow.AgentTimeout(45),
		)
		log.Println("✅ Structured extraction task: extractData")
		log.Println("   Model: claude-3-haiku (fast)")
		log.Println("   Temperature: 0.0 (maximum determinism)")
		log.Println("   Timeout: 45s")

		// ============================================================================
		// Scenario 5: Code generation with best practices
		// Use case: Generate implementation from spec
		// ============================================================================
		generateCode := wf.CallAgent(
			"generateCode",
			workflow.AgentOption(workflow.AgentBySlug("code-generator")),
			workflow.Message(workflow.Interpolate(
				"Generate Go code implementation for these requirements:\n",
				extractData.Field("requirements"),
			)),
			// Powerful model for code generation
			workflow.AgentModel("claude-3-5-sonnet"),
			// Low-medium temperature for good patterns
			workflow.AgentTemperature(0.3),
			// Longer timeout for code generation
			workflow.AgentTimeout(300), // 5 minutes
		)
		log.Println("✅ Code generation task: generateCode")
		log.Println("   Model: claude-3-5-sonnet (powerful)")
		log.Println("   Temperature: 0.3 (good patterns)")
		log.Println("   Timeout: 300s")

		// ============================================================================
		// Scenario 6: Real-time customer support (fast response required)
		// Use case: Answer customer question in real-time
		// ============================================================================
		customerSupport := wf.CallAgent(
			"customerSupport",
			workflow.AgentOption(workflow.AgentBySlug("support-agent")),
			workflow.Message(workflow.RuntimeEnv("CUSTOMER_QUESTION")),
			// Fast model for quick response
			workflow.AgentModel("claude-3-haiku"),
			// Medium temperature for helpful but consistent answers
			workflow.AgentTemperature(0.4),
			// Very short timeout - customer is waiting!
			workflow.AgentTimeout(15), // 15 seconds max
		)
		log.Println("✅ Real-time support task: customerSupport")
		log.Println("   Model: claude-3-haiku (fastest)")
		log.Println("   Temperature: 0.4 (helpful)")
		log.Println("   Timeout: 15s (customer waiting!)")

		// ============================================================================
		// Summary
		// ============================================================================
		log.Println("\n📊 Execution Configuration Summary:")
		log.Printf("   Total tasks: %d\n", len(wf.Tasks))
		log.Println("\n   Model selection strategy:")
		log.Println("   - claude-3-haiku: Fast, simple tasks (categorization, extraction, support)")
		log.Println("   - claude-3-5-sonnet: Complex tasks (architecture, code gen, content)")
		log.Println("\n   Temperature strategy:")
		log.Println("   - 0.0-0.1: Maximum determinism (extraction, categorization)")
		log.Println("   - 0.3-0.5: Balanced (code gen, analysis)")
		log.Println("   - 0.9: High creativity (marketing copy)")
		log.Println("\n   Timeout strategy:")
		log.Println("   - 15-45s: Real-time/quick tasks")
		log.Println("   - 120-300s: Normal tasks")
		log.Println("   - 600s: Deep analysis tasks")

		return nil
	})

	if err != nil {
		log.Fatalf("❌ Error: %v", err)
	}

	log.Println("\n✅ Agent execution configuration workflow created!")
	log.Println("🎯 Key takeaways:")
	log.Println("   - Choose model based on task complexity")
	log.Println("   - Tune temperature for desired randomness")
	log.Println("   - Set timeout based on user expectations")
	log.Println("   - Different configs for different use cases!")
}
