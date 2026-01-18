//go:build ignore

// Example 09: Workflow with Loops
//
// This example demonstrates iteration using FOR tasks.
// Uses the new stigmer.Run() API with typed context.
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Context for configuration
		apiBase := ctx.SetString("apiBase", "https://api.example.com")
		batchSize := ctx.SetInt("batchSize", 10)
		
		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("batch-processing"),
			workflow.WithName("batch-processor"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Process items in batches using loops"),
		)
		if err != nil {
			return err
		}

		// Task 1: Get list of items to process
		fetchTask := wf.HttpGet("fetchItems",
			apiBase.Concat("/items"),
		)

		// Task 2: Loop over items
		loopTask := wf.ForEach("processEachItem",
			workflow.IterateOver(fetchTask.Field("items")),
			workflow.WithLoopBody(func(item workflow.LoopVar) *workflow.Task {
				// Process each item
				return wf.HttpPost("processItem",
					apiBase.Concat("/process"),
					workflow.Body(map[string]interface{}{
						"itemId": item.Field("id"),
						"data":   item.Field("data"),
					}),
				)
			}),
		)

		// Task 3: Collect results
		wf.SetVars("collectResults",
			"processed", loopTask.Field("results"),
			"count", loopTask.Field("count"),
			"status", "completed",
		)

		log.Printf("Created workflow with loops: %s", wf)
		log.Printf("Batch size: %v", batchSize)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with loops created successfully!")
}
