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

		// Task 1: Initialize with potentially failing URL
		initTask := workflow.SetTask("init", map[string]string{
			"endpoint": "https://jsonplaceholder.typicode.com/posts/999999", // Non-existent post
			"fallback": "https://jsonplaceholder.typicode.com/posts/1",     // Valid fallback
			"retries":  "0",
		})
		wf.AddTask(initTask)

		// Task 2: Try to fetch data with error handling
		tryTask := workflow.Try("try-fetch",
			// Try block: attempt the HTTP call
			workflow.TryBlock(func() *workflow.Task {
				return workflow.HttpCall("risky-fetch",
					workflow.HTTPMethod("GET"),
					workflow.URI(initTask.Field("endpoint")),
					workflow.Timeout(5),
				).ExportAll()
			}),
			// Catch block: handle errors by using fallback endpoint
			workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
				return workflow.HttpCall("fallback-fetch",
					workflow.HTTPMethod("GET"),
					workflow.URI(initTask.Field("fallback")),
					workflow.Timeout(5),
				).ExportAll()
			}),
		)
		wf.AddTask(tryTask)

		// Task 3: Process result (regardless of try/catch path)
		resultTask := workflow.SetTask("process-result", map[string]string{
			"status":     "completed",
			"hasError":   "${.handle-error != null}",
			"dataSource": "${if .handle-error != null then \"fallback\" else \"primary\" end}",
		})
		wf.AddTask(resultTask)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}
}
