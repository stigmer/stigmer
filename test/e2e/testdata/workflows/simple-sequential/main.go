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
		initTask := wf.Set("init",
			workflow.SetVar("url", "https://jsonplaceholder.typicode.com/posts/1"),
			workflow.SetVar("counter", "0"),
		)

		// Task 2: Make HTTP call using variable from Task 1
		// No ExportAll() needed - outputs are always available
		fetchTask := wf.HttpGet("fetch", initTask.Field("url"),
			workflow.Timeout(10),
		)

		// Task 3: Process response using direct field references
		// Dependencies are implicit through field references
		processTask := wf.Set("process",
			workflow.SetVar("title", fetchTask.Field("title")),      // Direct field reference
			workflow.SetVar("userId", fetchTask.Field("userId")),    // Direct field reference
			workflow.SetVar("status", "completed"),
			workflow.SetVar("counter", initTask.Field("counter")),   // Reference to initial counter
		)

		log.Printf("Created workflow: %s", wf)
		log.Printf("Tasks: %d", len(wf.Tasks))
		log.Printf("  - %s (Set)", initTask.Name)
		log.Printf("  - %s (HTTP GET, depends on %s)", fetchTask.Name, initTask.Name)
		log.Printf("  - %s (Set, depends on %s and %s)", processTask.Name, initTask.Name, fetchTask.Name)
		log.Println("Workflow will be synthesized automatically on completion")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}

	log.Println("✅ Workflow created and synthesized successfully!")
}
