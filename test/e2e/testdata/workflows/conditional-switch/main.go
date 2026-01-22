//go:build ignore

// Test fixture: Conditional workflow with Switch
// Tests: Conditional branching based on values
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a workflow with conditional logic
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("test"),
			workflow.WithName("conditional-switch"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Workflow with switch-based conditional logic"),
		)
		if err != nil {
			return err
		}

		// Task 1: Set initial status
		initTask := wf.Set("init",
			workflow.SetVar("status", "pending"),
			workflow.SetVar("value", "42"),
		)

		// Task 2: Switch based on status
		switchTask := wf.Switch("check-status",
			workflow.SwitchOn(initTask.Field("status")),
			workflow.Case(workflow.Equals("pending"), "handle-pending"),
			workflow.Case(workflow.Equals("approved"), "handle-approved"),
			workflow.Case(workflow.Equals("rejected"), "handle-rejected"),
			workflow.DefaultCase("handle-unknown"),
		)

		// Task 3a: Handle pending status
		wf.Set("handle-pending",
			workflow.SetVar("result", "Processing pending request"),
			workflow.SetVar("action", "review_required"),
		).DependsOn(switchTask)

		// Task 3b: Handle approved status
		wf.Set("handle-approved",
			workflow.SetVar("result", "Request approved"),
			workflow.SetVar("action", "proceed"),
		).DependsOn(switchTask)

		// Task 3c: Handle rejected status
		wf.Set("handle-rejected",
			workflow.SetVar("result", "Request rejected"),
			workflow.SetVar("action", "notify_user"),
		).DependsOn(switchTask)

		// Task 3d: Handle unknown status (default)
		wf.Set("handle-unknown",
			workflow.SetVar("result", "Unknown status"),
			workflow.SetVar("action", "log_error"),
		).DependsOn(switchTask)

		log.Printf("Created workflow: %s with conditional branching", wf)
		log.Printf("Tasks: %d (init + switch + 4 handlers)", len(wf.Tasks))

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}

	log.Println("✅ Workflow created and synthesized successfully!")
}
