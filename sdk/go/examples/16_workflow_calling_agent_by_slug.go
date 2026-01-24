//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates calling an agent by slug instead of instance.
//
// Key learning points:
// - Using workflow.AgentBySlug() for loose coupling
// - Reference agents that exist in the platform/organization
// - No need to create the agent in the same context
// - Scope resolution (platform vs organization)
//
// This is useful when:
// - Referencing platform-provided agents
// - Separating agent and workflow definitions
// - Creating reusable workflows across organizations
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a workflow that references an agent by slug
		// The agent doesn't need to exist in this context
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("code-review"),
			workflow.WithName("review-by-slug"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Review workflow using agent slug reference"),
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Pattern 1: Reference organization-scoped agent (default)
		// ============================================================================
		// This looks for "code-reviewer" in the current organization
		orgReviewTask := wf.CallAgent("orgReview", &workflow.AgentCallArgs{
			Agent:   workflow.AgentBySlug("code-reviewer").Slug(), // Organization scope (default)
			Message: "Review this code for my organization's standards",
		})

		log.Printf("✅ Created org-scoped agent call: %s", orgReviewTask.Name)

		// ============================================================================
		// Pattern 2: Reference platform-scoped agent (public)
		// ============================================================================
		// This looks for "security-scanner" in platform-provided agents
		platformReviewTask := wf.CallAgent("platformReview", &workflow.AgentCallArgs{
			Agent:   workflow.AgentBySlug("security-scanner", "platform").Slug(), // Explicit platform scope
			Message: "Run security scan using platform-provided agent",
		})

		log.Printf("✅ Created platform-scoped agent call: %s", platformReviewTask.Name)

		// ============================================================================
		// Pattern 3: Chaining agent calls (sequential execution)
		// ============================================================================
		// Second task automatically depends on first when using output
		finalReviewTask := wf.CallAgent("finalReview", &workflow.AgentCallArgs{
			Agent:   workflow.AgentBySlug("senior-reviewer").Slug(),
			Message: "Final review completed. Org review and platform scan done.",
		})

		log.Printf("✅ Created final review task: %s", finalReviewTask.Name)
		log.Printf("📊 Total tasks: %d", len(wf.Tasks))

		return nil
	})

	if err != nil {
		log.Fatalf("❌ Error: %v", err)
	}

	log.Println("✅ Workflow manifest created with agent slug references!")
}
