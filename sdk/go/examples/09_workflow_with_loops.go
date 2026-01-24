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
			apiBase.Concat("/items"), // ✅ No .Expression() needed - smart conversion!
			nil,                      // No custom headers
		)

		// Task 2: Loop over items
		// For each item in the collection, execute the tasks defined in the Do array
		// Using LoopBody for type-safe access to loop variables
		loopTask := wf.ForEach("processEachItem", &workflow.ForArgs{
			In: fetchTask.Field("items"), // ✅ No .Expression() needed - smart conversion!
			Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
				return []*workflow.Task{
					wf.HttpPost("processItem",
						apiBase.Concat("/process"), // ✅ No .Expression() needed!
						nil,                        // No custom headers
						map[string]interface{}{
							"itemId": item.Field("id"),   // ✅ Type-safe reference!
							"data":   item.Field("data"), // ✅ No magic strings!
						},
					),
				}
			}),
		})

		// Task 3: Collect results
		// The loopTask itself represents the completion of the loop
		wf.Set("collectResults", &workflow.SetArgs{
			Variables: map[string]string{
				"loopCompleted": "true",
				"status":        "completed",
			},
		}).DependsOn(loopTask) // Explicit dependency to ensure loop completes first

		log.Printf("Created workflow with loops: %s", wf)
		log.Printf("Batch size: %v", batchSize)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with loops created successfully!")
}
