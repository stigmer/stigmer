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
		apiBase := ctx.SetString("apiBase", "https://api.github.com/repos/stigmer/hello-stigmer")
		_ = ctx.SetInt("timeout", 60) // Define timeout in context

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("parallel-processing"),
			workflow.WithName("parallel-data-fetch"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Fetch GitHub data from multiple endpoints in parallel"),
		)
		if err != nil {
			return err
		}

		// Task 1: Fork to execute multiple GitHub API calls in parallel
		// Note: For inline task definitions in Fork branches, we use map[string]interface{}
		// This is the current pattern for defining tasks within Fork/Try blocks.
		// When using raw maps, .Expression() is needed to convert StringRef to JQ expression.
		_ = wf.Fork("fetchAllGitHubData", &workflow.ForkArgs{
			Branches: []map[string]interface{}{
				{
					"name": "fetchPullRequests",
					"tasks": []interface{}{
						map[string]interface{}{
							"httpCall": map[string]interface{}{
								"method": "GET",
								"uri":    apiBase.Concat("/pulls").Expression(), // Raw maps need .Expression()
								"headers": map[string]string{
									"Accept":     "application/vnd.github.v3+json",
									"User-Agent": "Stigmer-SDK-Example",
								},
							},
						},
					},
				},
				{
					"name": "fetchIssues",
					"tasks": []interface{}{
						map[string]interface{}{
							"httpCall": map[string]interface{}{
								"method": "GET",
								"uri":    apiBase.Concat("/issues").Expression(), // Raw maps need .Expression()
								"headers": map[string]string{
									"Accept":     "application/vnd.github.v3+json",
									"User-Agent": "Stigmer-SDK-Example",
								},
							},
						},
					},
				},
				{
					"name": "fetchCommits",
					"tasks": []interface{}{
						map[string]interface{}{
							"httpCall": map[string]interface{}{
								"method": "GET",
								"uri":    apiBase.Concat("/commits").Expression(), // Raw maps need .Expression()
								"headers": map[string]string{
									"Accept":     "application/vnd.github.v3+json",
									"User-Agent": "Stigmer-SDK-Example",
								},
							},
						},
					},
				},
			},
		})

		// Task 2: Merge results from all parallel GitHub API calls
		wf.Set("mergeResults", &workflow.SetArgs{
			Variables: map[string]string{
				"pulls":   "${ $context[\"fetchAllGitHubData\"].branches.fetchPullRequests.data }",
				"issues":  "${ $context[\"fetchAllGitHubData\"].branches.fetchIssues.data }",
				"commits": "${ $context[\"fetchAllGitHubData\"].branches.fetchCommits.data }",
				"status":  "merged",
			},
		})

		// Task 3: Process merged GitHub data
		wf.Set("processMerged", &workflow.SetArgs{
			Variables: map[string]string{
				"totalRecords": "${pulls.length + issues.length + commits.length}",
				"completedAt":  "${now()}",
				"repository":   "stigmer/hello-stigmer",
			},
		})

		log.Printf("Created workflow with parallel execution: %s", wf)
		log.Println("\nNote: This example fetches PRs, issues, and commits in parallel")
		log.Println("      from the stigmer/hello-stigmer repository")
		log.Println("      No authentication required - works as an E2E test!")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with parallel execution created successfully!")
	log.Println("   Demonstrates real-world parallel API calls to GitHub")
}
