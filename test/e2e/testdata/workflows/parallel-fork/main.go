//go:build ignore

// Test fixture: Parallel execution with Fork
// Tests: Concurrent task execution and result merging
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Context for configuration
		apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
		userId := ctx.SetString("userId", "1")

		// Create a workflow with parallel execution
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("test"),
			workflow.WithName("parallel-fork"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Workflow with parallel task execution using fork"),
		)
		if err != nil {
			return err
		}

		// Task 1: Fork to execute multiple HTTP calls in parallel
		// No ExportAll() needed - outputs are always available
		forkTask := wf.Fork("parallel-fetch",
			workflow.ParallelBranches(
				workflow.BranchBuilder("fetch-posts", func() *workflow.Task {
					// Build URL using context variables
					postsUrl := apiBase.Concat("/posts?userId=").Concat(userId)
					return wf.HttpGet("fetch-posts-http", postsUrl,
						workflow.Timeout(10),
					)
				}),
				workflow.BranchBuilder("fetch-todos", func() *workflow.Task {
					// Build URL using context variables
					todosUrl := apiBase.Concat("/todos?userId=").Concat(userId)
					return wf.HttpGet("fetch-todos-http", todosUrl,
						workflow.Timeout(10),
					)
				}),
				workflow.BranchBuilder("fetch-albums", func() *workflow.Task {
					// Build URL using context variables
					albumsUrl := apiBase.Concat("/albums?userId=").Concat(userId)
					return wf.HttpGet("fetch-albums-http", albumsUrl,
						workflow.Timeout(10),
					)
				}),
			),
			workflow.WaitForAll(), // All branches execute in parallel
		)

		// Task 2: Merge results from parallel branches
		// Use Branch() method to access fork branch results
		wf.Set("merge-results",
			workflow.SetVar("postsData", forkTask.Branch("fetch-posts").Field("data")),
			workflow.SetVar("todosData", forkTask.Branch("fetch-todos").Field("data")),
			workflow.SetVar("albumsData", forkTask.Branch("fetch-albums").Field("data")),
			workflow.SetVar("status", "completed"),
		)

		log.Printf("Created workflow: %s with parallel execution", wf)
		log.Printf("Tasks: %d (fork + merge)", len(wf.Tasks))

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}

	log.Println("✅ Workflow created and synthesized successfully!")
}
