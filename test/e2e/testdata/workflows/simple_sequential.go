//go:build ignore

// Test fixture: Simple sequential workflow
// Tests: Basic task chaining (Set → HTTP Call → Set)
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a simple sequential workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("test"),
			workflow.WithName("simple-sequential"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Simple sequential workflow for E2E testing"),
		)
		if err != nil {
			return err
		}

		// Task 1: Initialize variables
		initTask := workflow.SetTask("init", map[string]string{
			"url":     "https://jsonplaceholder.typicode.com/posts/1",
			"counter": "0",
		})
		wf.AddTask(initTask)

		// Task 2: Make HTTP call using variable from Task 1
		fetchTask := workflow.HttpCall("fetch",
			workflow.HTTPMethod("GET"),
			workflow.URI(initTask.Field("url")), // Use field reference for dependency tracking
			workflow.Timeout(10),
		).ExportAll() // Export entire response

		wf.AddTask(fetchTask)

		// Task 3: Process response
		processTask := workflow.SetTask("process", map[string]string{
			"title":    fetchTask.Field("title").Expression(),    // Access title from response
			"userId":   fetchTask.Field("userId").Expression(),   // Access userId
			"status":   "completed",
			"attempts": "${.counter + 1}", // Increment counter
		})
		wf.AddTask(processTask)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}
}
