//go:build ignore

// Test fixture: Error handling with Try/Catch
// Tests: Error detection and recovery
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Context for configuration
		endpoint := ctx.SetString("endpoint", "https://jsonplaceholder.typicode.com/posts/999999") // Non-existent post
		fallback := ctx.SetString("fallback", "https://jsonplaceholder.typicode.com/posts/1")      // Valid fallback

		// Create a workflow with error handling
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("test"),
			workflow.WithName("error-handling"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Workflow with try-catch error handling"),
		)
		if err != nil {
			return err
		}

		// Task 1: Try to fetch data with error handling
		tryTask := wf.Try("try-fetch",
			// Try block: attempt the HTTP call
			workflow.TryBlock(func() *workflow.Task {
				return wf.HttpGet("risky-fetch", endpoint,
					workflow.Timeout(5),
				)
			}),
			// Catch block: handle errors by using fallback endpoint
			workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
				return wf.HttpGet("fallback-fetch", fallback,
					workflow.Timeout(5),
				)
			}),
		)

		// Task 2: Process result (regardless of try/catch path)
		// The try-catch task automatically provides the result from whichever branch succeeded
		wf.Set("process-result",
			workflow.SetVar("status", "completed"),
			workflow.SetVar("processed", "true"),
		)

		log.Printf("Created workflow: %s with error handling", wf)
		log.Printf("Tasks: %d (try-catch + result)", len(wf.Tasks))

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}

	log.Println("✅ Workflow created and synthesized successfully!")
}
