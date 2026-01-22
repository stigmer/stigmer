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
		initTask := workflow.SetTask("init", map[string]string{
			"status": "pending",
			"value":  "42",
		})
		wf.AddTask(initTask)

		// Task 2: Switch based on status
		switchTask := workflow.Switch("check-status",
			workflow.Case("${.status == \"pending\"}", "handle-pending"),
			workflow.Case("${.status == \"approved\"}", "handle-approved"),
			workflow.Case("${.status == \"rejected\"}", "handle-rejected"),
			workflow.DefaultCase("handle-unknown"),
		)
		wf.AddTask(switchTask)

		// Task 3: Handle pending status
		pendingTask := workflow.SetTask("handle-pending", map[string]string{
			"result": "Processing pending request",
			"action": "review_required",
		})
		wf.AddTask(pendingTask)

		// Task 4: Handle approved status
		approvedTask := workflow.SetTask("handle-approved", map[string]string{
			"result": "Request approved",
			"action": "proceed",
		})
		wf.AddTask(approvedTask)

		// Task 5: Handle rejected status
		rejectedTask := workflow.SetTask("handle-rejected", map[string]string{
			"result": "Request rejected",
			"action": "notify_user",
		})
		wf.AddTask(rejectedTask)

		// Task 6: Handle unknown status (default)
		unknownTask := workflow.SetTask("handle-unknown", map[string]string{
			"result": "Unknown status",
			"action": "log_error",
		})
		wf.AddTask(unknownTask)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}
}
