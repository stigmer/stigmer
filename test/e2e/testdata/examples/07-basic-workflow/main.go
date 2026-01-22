//go:build ignore

// Package examples demonstrates how to create workflows using the Stigmer SDK with typed context.
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates creating a workflow with Pulumi-aligned patterns.
//
// The workflow:
// 1. Uses context ONLY for configuration (not internal data flow)
// 2. Makes an HTTP GET request using clean builders
// 3. Processes the response using clear task output references
// 4. Has implicit dependencies (no manual ThenRef needed!)
//
// Key features demonstrated:
// - stigmer.Run() pattern for automatic context management
// - Context used ONLY for config (like Pulumi's Config)
// - Clean HTTP builders: wf.HttpGet()
// - Clear task output references: fetchTask.Field("title")
// - Implicit dependencies through field references
// - No ExportAll() needed - outputs always available
// - Professional, Pulumi-like code style
func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Context: ONLY for shared configuration (like Pulumi's Config)
		apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
		orgName := ctx.SetString("org", "my-org")

		// Create environment variable for API token
		apiToken, err := environment.New(
			environment.WithName("API_TOKEN"),
			environment.WithSecret(true),
			environment.WithDescription("Authentication token for the API"),
		)
		if err != nil {
			return err
		}

		// Create workflow with context
		wf, err := workflow.New(ctx,
			// Required metadata
			workflow.WithNamespace("data-processing"),
			workflow.WithName("basic-data-fetch"),

			// Optional fields
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Fetch data from an external API using Pulumi-aligned patterns"),
			workflow.WithOrg(orgName), // Use context config
			workflow.WithEnvironmentVariable(apiToken),
		)
		if err != nil {
			return err
		}

		// Build endpoint URL using context config
		endpoint := apiBase.Concat("/posts/1")

		// Task 1: Fetch data from API (clean, one-liner!)
		// No ExportAll() needed - outputs are always available
		fetchTask := wf.HttpGet("fetchData", endpoint,
			workflow.Header("Content-Type", "application/json"),
			workflow.Timeout(30),
		)

		// Task 2: Process response using DIRECT task references
		// Dependencies are implicit - no ThenRef needed!
		// Clear origin: title and body come from fetchTask
		processTask := wf.Set("processResponse",
			workflow.SetVar("postTitle", fetchTask.Field("title")), // ✅ Clear: from fetchTask!
			workflow.SetVar("postBody", fetchTask.Field("body")),  // ✅ Clear: from fetchTask!
			workflow.SetVar("status", "success"),
		)

		// No manual dependency management needed!
		// processTask automatically depends on fetchTask because it uses fetchTask.Field()

		log.Printf("Created workflow: %s", wf)
		log.Printf("Tasks: %d", len(wf.Tasks))
		log.Printf("  - %s (HTTP GET)", fetchTask.Name)
		log.Printf("  - %s (depends on %s implicitly)", processTask.Name, fetchTask.Name)
		log.Println("Workflow will be synthesized automatically on completion")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow created and synthesized successfully!")
}
