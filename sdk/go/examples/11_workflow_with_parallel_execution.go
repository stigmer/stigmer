//go:build ignore

// Example 11: Workflow with Parallel Execution
//
// This example demonstrates parallel execution using FORK tasks.
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
		_ = ctx.SetInt("timeout", 60) // Define timeout in context
		
		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("parallel-processing"),
			workflow.WithName("parallel-data-fetch"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Fetch data from multiple sources in parallel"),
		)
		if err != nil {
			return err
		}

		// Task 1: Fork to execute multiple tasks in parallel
		_ = wf.Fork("fetchAllData", &workflow.ForkArgs{
			Branches: []map[string]interface{}{
				{
					"name": "fetchUsers",
					"tasks": []interface{}{
						map[string]interface{}{
							"httpCall": map[string]interface{}{
								"method": "GET",
								"uri":    apiBase.Concat("/users").Expression(),
							},
						},
					},
				},
				{
					"name": "fetchProducts",
					"tasks": []interface{}{
						map[string]interface{}{
							"httpCall": map[string]interface{}{
								"method": "GET",
								"uri":    apiBase.Concat("/products").Expression(),
							},
						},
					},
				},
				{
					"name": "fetchOrders",
					"tasks": []interface{}{
						map[string]interface{}{
							"httpCall": map[string]interface{}{
								"method": "GET",
								"uri":    apiBase.Concat("/orders").Expression(),
							},
						},
					},
				},
			},
		})

		// Task 2: Merge results from all parallel branches
		wf.Set("mergeResults", &workflow.SetArgs{
			Variables: map[string]string{
				"users":    "${ $context[\"fetchAllData\"].branches.fetchUsers.data }",
				"products": "${ $context[\"fetchAllData\"].branches.fetchProducts.data }",
				"orders":   "${ $context[\"fetchAllData\"].branches.fetchOrders.data }",
				"status":   "merged",
			},
		})

		// Task 3: Process merged data
		wf.Set("processMerged", &workflow.SetArgs{
			Variables: map[string]string{
				"totalRecords": "${users.length + products.length + orders.length}",
				"completedAt":  "${now()}",
			},
		})

		log.Printf("Created workflow with parallel execution: %s", wf)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with parallel execution created successfully!")
}
