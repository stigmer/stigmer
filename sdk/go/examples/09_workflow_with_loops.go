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
			apiBase.Concat("/items").Expression(),
			nil, // No custom headers
		)

		// Task 2: Loop over items
		// For each item in the collection, execute the tasks defined in the Do array
		loopTask := wf.ForEach("processEachItem", &workflow.ForArgs{
			In: fetchTask.Field("items").Expression(),
			Do: []map[string]interface{}{
				{
					"httpCall": map[string]interface{}{
						"method": "POST",
						"uri":    apiBase.Concat("/process").Expression(),
						"body": map[string]interface{}{
							"itemId": "${.item.id}",   // Reference current loop item
							"data":   "${.item.data}", // Reference current loop item
						},
					},
				},
			},
		})

		// Task 3: Collect results
		wf.Set("collectResults", &workflow.SetArgs{
			Variables: map[string]string{
				"processed": loopTask.Field("results").Expression(),
				"count":     loopTask.Field("count").Expression(),
				"status":    "completed",
			},
		})

		log.Printf("Created workflow with loops: %s", wf)
		log.Printf("Batch size: %v", batchSize)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with loops created successfully!")
}
