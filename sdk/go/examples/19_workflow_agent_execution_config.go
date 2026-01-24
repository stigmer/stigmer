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
		// - Using workflow.Model() to override agent's default model
		// - Using workflow.AgentTimeout() for time-sensitive tasks
		// - Using workflow.Temperature() for creativity control
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
		categorizeTicket := wf.CallAgent("categorizeTicket", &workflow.AgentCallArgs{
			Agent:   workflow.AgentBySlug("support-categorizer").Slug(),
			Message: "Categorize this support ticket: 'My login is not working'",
			Config: map[string]interface{}{
				"model":       "claude-3-haiku", // Fast model for simple categorization
				"temperature": 0.1,               // Low temperature for consistent categorization
				"timeout":     30,                // Short timeout - categorization should be quick (30 seconds)
			},
		})
		log.Println("✅ Fast deterministic task: categorizeTicket")
		log.Println("   Model: claude-3-haiku (fast)")
		log.Println("   Temperature: 0.1 (deterministic)")
		log.Println("   Timeout: 30s (quick)")

		// ============================================================================
		// Scenario 2: Deep analysis task
		// Use case: Architectural review of complex system
		// ============================================================================
		architectureReview := wf.CallAgent("architectureReview", &workflow.AgentCallArgs{
			Agent: workflow.AgentBySlug("senior-architect").Slug(),
			Message: workflow.Interpolate(
				"Review the architecture of this microservices system:\n",
				categorizeTicket.Field("system_info"), // Uses output from previous task
			),
			Config: map[string]interface{}{
				"model":       "claude-3-5-sonnet", // Powerful model for complex reasoning
				"temperature": 0.5,                  // Medium temperature for balanced analysis
				"timeout":     600,                  // Long timeout for thorough analysis (10 minutes)
			},
		})
		log.Println("✅ Deep analysis task: architectureReview")
		log.Println("   Model: claude-3-5-sonnet (powerful)")
		log.Println("   Temperature: 0.5 (balanced)")
		log.Println("   Timeout: 600s (thorough)")
		_ = architectureReview // Used for demonstration purposes

		// ============================================================================
		// Scenario 3: Creative content generation
		// Use case: Write marketing copy
		// ============================================================================
		generateCopy := wf.CallAgent("generateCopy", &workflow.AgentCallArgs{
			Agent:   workflow.AgentBySlug("content-writer").Slug(),
			Message: "Write engaging marketing copy for a new AI code review tool",
			Config: map[string]interface{}{
				"model":       "claude-3-5-sonnet", // Creative model
				"temperature": 0.9,                  // High temperature for creative output
				"timeout":     120,                  // Moderate timeout (2 minutes)
			},
		})
		log.Println("✅ Creative task: generateCopy")
		log.Println("   Model: claude-3-5-sonnet")
		log.Println("   Temperature: 0.9 (creative)")
		log.Println("   Timeout: 120s")

		// ============================================================================
		// Scenario 4: Structured data extraction (deterministic)
		// Use case: Extract fields from unstructured text
		// ============================================================================
		extractData := wf.CallAgent("extractData", &workflow.AgentCallArgs{
			Agent: workflow.AgentBySlug("data-extractor").Slug(),
			Message: workflow.Interpolate(
				"Extract structured data from this marketing copy:\n",
				generateCopy.Field("content"), // Use output from creative task
			),
			Config: map[string]interface{}{
				"model":       "claude-3-haiku", // Fast model sufficient for extraction
				"temperature": 0.0,              // Very low temperature for consistent extraction (Maximum determinism)
				"timeout":     45,               // Quick extraction
			},
		})
		log.Println("✅ Structured extraction task: extractData")
		log.Println("   Model: claude-3-haiku (fast)")
		log.Println("   Temperature: 0.0 (maximum determinism)")
		log.Println("   Timeout: 45s")

		// ============================================================================
		// Scenario 5: Code generation with best practices
		// Use case: Generate implementation from spec
		// ============================================================================
		generateCode := wf.CallAgent("generateCode", &workflow.AgentCallArgs{
			Agent: workflow.AgentBySlug("code-generator").Slug(),
			Message: workflow.Interpolate(
				"Generate Go code implementation for these requirements:\n",
				extractData.Field("requirements"),
			),
			Config: map[string]interface{}{
				"model":       "claude-3-5-sonnet", // Powerful model for code generation
				"temperature": 0.3,                  // Low-medium temperature for good patterns
				"timeout":     300,                  // Longer timeout for code generation (5 minutes)
			},
		})
		log.Println("✅ Code generation task: generateCode")
		log.Println("   Model: claude-3-5-sonnet (powerful)")
		log.Println("   Temperature: 0.3 (good patterns)")
		log.Println("   Timeout: 300s")
		_ = generateCode // Used for demonstration purposes

		// ============================================================================
		// Scenario 6: Real-time customer support (fast response required)
		// Use case: Answer customer question in real-time
		// ============================================================================
		customerSupport := wf.CallAgent("customerSupport", &workflow.AgentCallArgs{
			Agent:   workflow.AgentBySlug("support-agent").Slug(),
			Message: workflow.RuntimeEnv("CUSTOMER_QUESTION"),
			Config: map[string]interface{}{
				"model":       "claude-3-haiku", // Fast model for quick response
				"temperature": 0.4,              // Medium temperature for helpful but consistent answers
				"timeout":     15,               // Very short timeout - customer is waiting! (15 seconds max)
			},
		})
		log.Println("✅ Real-time support task: customerSupport")
		log.Println("   Model: claude-3-haiku (fastest)")
		log.Println("   Temperature: 0.4 (helpful)")
		log.Println("   Timeout: 15s (customer waiting!)")
		_ = customerSupport // Used for demonstration purposes

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
