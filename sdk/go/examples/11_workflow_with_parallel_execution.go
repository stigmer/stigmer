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
		timeout := ctx.SetInt("timeout", 60)
		
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
		forkTask := wf.Fork("fetchAllData",
			workflow.ParallelBranches(
				// Branch 1: Fetch user data
				workflow.BranchBuilder("fetchUsers", func() *workflow.Task {
					return wf.HttpGet("getUsers",
						apiBase.Concat("/users"),
						workflow.Timeout(int32(timeout.Value())),
					)
				}),
				
				// Branch 2: Fetch product data
				workflow.BranchBuilder("fetchProducts", func() *workflow.Task {
					return wf.HttpGet("getProducts",
						apiBase.Concat("/products"),
						workflow.Timeout(int32(timeout.Value())),
					)
				}),
				
				// Branch 3: Fetch orders data
				workflow.BranchBuilder("fetchOrders", func() *workflow.Task {
					return wf.HttpGet("getOrders",
						apiBase.Concat("/orders"),
						workflow.Timeout(int32(timeout.Value())),
					)
				}),
			),
			workflow.WaitForAll(), // Wait for all branches to complete
		)

	// Task 2: Merge results from all parallel branches
	wf.Set("mergeResults",
		workflow.SetVar("users", forkTask.Branch("fetchUsers").Field("data")),
		workflow.SetVar("products", forkTask.Branch("fetchProducts").Field("data")),
		workflow.SetVar("orders", forkTask.Branch("fetchOrders").Field("data")),
		workflow.SetVar("status", "merged"),
	)

	// Task 3: Process merged data
	wf.Set("processMerged",
		workflow.SetVar("totalRecords", "${users.length + products.length + orders.length}"),
		workflow.SetVar("completedAt", "${now()}"),
	)

		log.Printf("Created workflow with parallel execution: %s", wf)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with parallel execution created successfully!")
}
