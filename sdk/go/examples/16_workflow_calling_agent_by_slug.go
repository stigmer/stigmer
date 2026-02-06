//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/context"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates calling an agent by org/slug reference.
//
// Key learning points:
// - Using "org/slug" string format for agent references
// - Reference agents that exist in any organization
// - No need to create the agent in the same context
// - All agents belong to an organization
//
// This is useful when:
// - Referencing public agents from other organizations (e.g., stigmer/code-reviewer)
// - Separating agent and workflow definitions
// - Creating reusable workflows across organizations
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a workflow that references an agent by org/slug
		// The agent doesn't need to exist in this context
		wf, err := workflow.New(ctx, "code-review/review-by-slug", &workflow.WorkflowArgs{
			Description: "Review workflow using agent slug reference",
		})
		if err != nil {
			return err
		}

		// ============================================================================
		// Pattern 1: Reference agent from your organization
		// ============================================================================
		// Use "org/slug" string format directly
		orgReviewTask := wf.CallAgent("orgReview", &workflow.AgentCallArgs{
			Agent:   "my-org/code-reviewer", // Direct org/slug string
			Message: "Review this code for my organization's standards",
		})

		log.Printf("Created org agent call: %s", orgReviewTask.Name)

		// ============================================================================
		// Pattern 2: Reference public agent from stigmer organization
		// ============================================================================
		// This references "security-scanner" from the stigmer organization (public)
		publicReviewTask := wf.CallAgent("publicReview", &workflow.AgentCallArgs{
			Agent:   "stigmer/security-scanner", // Direct org/slug string
			Message: "Run security scan using public agent",
		})

		log.Printf("Created public agent call: %s", publicReviewTask.Name)

		// ============================================================================
		// Pattern 3: Using explicit org/slug format
		// ============================================================================
		// Simply use "org/slug" string when you have separate values
		explicitTask := wf.CallAgent("explicitReview", &workflow.AgentCallArgs{
			Agent:   "acme-corp/senior-reviewer", // Format: "org/slug"
			Message: "Review using explicitly specified org and slug",
		})

		log.Printf("Created explicit agent call: %s", explicitTask.Name)

		// ============================================================================
		// Pattern 4: Chaining agent calls (sequential execution)
		// ============================================================================
		// Second task automatically depends on first when using output
		finalReviewTask := wf.CallAgent("finalReview", &workflow.AgentCallArgs{
			Agent:   "my-org/senior-reviewer", // Direct org/slug string
			Message: "Final review completed. All scans done.",
		})

		log.Printf("Created final review task: %s", finalReviewTask.Name)
		log.Printf("Total tasks: %d", len(wf.Args.Tasks))

		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	log.Println("Workflow manifest created with agent org/slug references!")
}
