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

		// Task 1: Initialize data for parallel processing
		initTask := workflow.SetTask("init", map[string]string{
			"baseUrl": "https://jsonplaceholder.typicode.com",
			"userId":  "1",
		})
		wf.AddTask(initTask)

		// Task 2: Fork to execute multiple HTTP calls in parallel
		forkTask := workflow.Fork("parallel-fetch",
			workflow.ParallelBranches(
				workflow.BranchBuilder("fetch-posts", func() *workflow.Task {
					return workflow.HttpCall("fetch-posts-http",
						workflow.HTTPMethod("GET"),
						workflow.URI("${.baseUrl}/posts?userId=${.userId}"),
						workflow.Timeout(10),
					).ExportAll()
				}),
				workflow.BranchBuilder("fetch-todos", func() *workflow.Task {
					return workflow.HttpCall("fetch-todos-http",
						workflow.HTTPMethod("GET"),
						workflow.URI("${.baseUrl}/todos?userId=${.userId}"),
						workflow.Timeout(10),
					).ExportAll()
				}),
				workflow.BranchBuilder("fetch-albums", func() *workflow.Task {
					return workflow.HttpCall("fetch-albums-http",
						workflow.HTTPMethod("GET"),
						workflow.URI("${.baseUrl}/albums?userId=${.userId}"),
						workflow.Timeout(10),
					).ExportAll()
				}),
			),
			workflow.WaitForAll(), // All branches execute in parallel
		)
		wf.AddTask(forkTask)

		// Task 3: Merge results from parallel branches
		mergeTask := workflow.SetTask("merge-results", map[string]string{
			"postsCount":  "${.parallel-fetch.fetch-posts | length}",
			"todosCount":  "${.parallel-fetch.fetch-todos | length}",
			"albumsCount": "${.parallel-fetch.fetch-albums | length}",
			"status":      "completed",
		})
		wf.AddTask(mergeTask)

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize workflow: %v", err)
	}
}
