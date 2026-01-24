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
		apiBase := ctx.SetString("apiBase", "https://api.github.com")
		batchSize := ctx.SetInt("batchSize", 10)

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("batch-processing"),
			workflow.WithName("batch-processor"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Process GitHub commits in batches using loops"),
		)
		if err != nil {
			return err
		}

		// Task 1: Get list of commits from hello-stigmer repository
		fetchTask := wf.HttpGet("fetchCommits",
			apiBase.Concat("/repos/stigmer/hello-stigmer/commits"),
			map[string]string{
				"Accept":     "application/vnd.github.v3+json",
				"User-Agent": "Stigmer-SDK-Example",
			},
		)

		// Task 2: Loop over commits
		// For each commit in the collection, execute the tasks defined in the Do array
		// Using LoopBody for type-safe access to loop variables
		loopTask := wf.ForEach("processEachCommit", &workflow.ForArgs{
			In: fetchTask, // ✅ GitHub API returns array directly - no .Field("items") needed!
			Do: workflow.LoopBody(func(commit workflow.LoopVar) []*workflow.Task {
				return []*workflow.Task{
					wf.Set("analyzeCommit",
						&workflow.SetArgs{
							Variables: map[string]string{
								"sha":     commit.Field("sha"),                   // ✅ Type-safe reference!
								"message": commit.Field("commit.message"),        // ✅ Commit message
								"author":  commit.Field("commit.author.name"),    // ✅ Author name
								"date":    commit.Field("commit.author.date"),    // ✅ Commit date
								"url":     commit.Field("html_url"),              // ✅ GitHub URL
							},
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
		log.Println("\nNote: This example fetches real commits from stigmer/hello-stigmer")
		log.Println("      Loops over each commit to extract SHA, message, author, and date")
		log.Println("      No authentication required - works as an E2E test!")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with loops created successfully!")
	log.Println("   Demonstrates batch processing of real GitHub commit data")
}
