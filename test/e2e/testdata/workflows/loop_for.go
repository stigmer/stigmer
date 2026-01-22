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

		// Task 1: Initialize array of items to process
		initTask := workflow.SetTask("init", map[string]string{
			"items": "[1, 2, 3, 4, 5]",
			"sum":   "0",
		})
		wf.AddTask(initTask)

		// Task 2: Loop over items
		forTask := workflow.For("process-items",
			workflow.IterateOver("${.items}"),
			workflow.DoTasks([]map[string]interface{}{
				{
					"set": map[string]interface{}{
						"variables": map[string]string{
							"current":   "${.item}",
							"squared":   "${.item * .item}",
							"iteration": "Processing item",
						},
					},
				},
			}),
		)
		wf.AddTask(forTask)

		// Task 3: Calculate final result
		resultTask := workflow.SetTask("calculate-result", map[string]string{
			"totalIterations": "${.process-items | length}",
			"status":          "completed",
		})
		wf.AddTask(resultTask)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}
}
