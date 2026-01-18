//go:build ignore

// Example 10: Workflow with Error Handling
//
// This example demonstrates error handling using TRY/CATCH tasks.
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
		maxRetries := ctx.SetInt("maxRetries", 3)
		
		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("resilient-workflows"),
			workflow.WithName("resilient-api-call"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Make API calls with error handling and retries"),
		)
		if err != nil {
			return err
		}

		// Task 1: Try to make API call with error handling
		tryTask := wf.Try("attemptAPICall",
			workflow.TryBlock(func() *workflow.Task {
				// Main operation that might fail
				return wf.HttpGet("callAPI",
					apiBase.Concat("/data"),
					workflow.Timeout(30),
				)
			}),
			workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
				// Error handler
				return wf.SetVars("handleError",
					"error", err.Message(),
					"timestamp", err.Timestamp(),
					"retryable", "true",
				)
			}),
			workflow.FinallyBlock(func() *workflow.Task {
				// Always executed (cleanup)
				return wf.SetVars("cleanup",
					"status", "attempted",
					"maxRetries", maxRetries,
				)
			}),
		)

		// Task 2: Check if retry is needed
		wf.Switch("checkRetry",
			workflow.SwitchOn(tryTask.Field("success")),
			workflow.Case(workflow.Equals(true), "processSuccess"),
			workflow.Case(workflow.Equals(false), "logFailure"),
		)

		// Task 3a: Process successful result
		wf.SetVars("processSuccess",
			"result", tryTask.Field("data"),
			"status", "completed",
		)

		// Task 3b: Log failure
		wf.SetVars("logFailure",
			"status", "failed",
			"reason", tryTask.Field("error"),
		)

		log.Printf("Created workflow with error handling: %s", wf)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with error handling created successfully!")
}
