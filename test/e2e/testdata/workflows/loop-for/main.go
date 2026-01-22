//go:build ignore

// Test fixture: Loop execution with For
// Tests: Iteration over collections
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Context for configuration
		items := ctx.SetString("items", "[1, 2, 3, 4, 5]")

		// Create a workflow with loop execution
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("test"),
			workflow.WithName("loop-for"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Workflow with for-loop iteration"),
		)
		if err != nil {
			return err
		}

		// Task 1: Loop over items using ForEach
		forTask := wf.ForEach("process-items",
			workflow.IterateOver(items),
			workflow.WithLoopBody(func(item workflow.LoopVar) *workflow.Task {
				// Process each item
				return wf.Set("process-item",
					workflow.SetVar("current", item),
					workflow.SetVar("iteration", "Processing item"),
				)
			}),
		)

		// Task 2: Calculate final result
		// Use direct field reference to the for task results
		wf.Set("calculate-result",
			workflow.SetVar("totalIterations", forTask.Field("count")),
			workflow.SetVar("status", "completed"),
		)

		log.Printf("Created workflow: %s with loop iteration", wf)
		log.Printf("Tasks: %d (for-loop + result)", len(wf.Tasks))

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}

	log.Println("✅ Workflow created and synthesized successfully!")
}
