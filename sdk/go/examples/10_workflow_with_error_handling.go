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
		apiBase := ctx.SetString("apiBase", "https://api.github.com")
		_ = ctx.SetInt("maxRetries", 3) // Define max retries in context

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("resilient-workflows"),
			workflow.WithName("resilient-api-call"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Make GitHub API calls with error handling and retries"),
		)
		if err != nil {
			return err
		}

		// Task 1: Try to fetch pull request with error handling
		tryTask := wf.Try("attemptGitHubCall", &workflow.TryArgs{
			Tasks: []map[string]interface{}{
					{
						"httpCall": map[string]interface{}{
							"method": "GET",
							"uri":    apiBase.Concat("/repos/stigmer/hello-stigmer/pulls/1"),
							"headers": map[string]string{
								"Accept":     "application/vnd.github.v3+json",
								"User-Agent": "Stigmer-SDK-Example",
							},
						},
					},
			},
			Catch: []map[string]interface{}{
				{
					"errors": []string{"NetworkError", "TimeoutError"},
					"as":     "error",
					"tasks": []interface{}{
						map[string]interface{}{
							"set": map[string]interface{}{
								"error":     "${.error.message}",
								"timestamp": "${.error.timestamp}",
								"retryable": "true",
							},
						},
					},
				},
			},
		})

	// Task 2: Check if retry is needed
	success := tryTask.Field("success")
	wf.Switch("checkRetry", &workflow.SwitchArgs{
		Cases: []map[string]interface{}{
			{
				"condition": success.Expression() + " == true",
				"then":      "processSuccess",
			},
			{
				"condition": success.Expression() + " == false",
				"then":      "logFailure",
			},
		},
	})

	// Task 3a: Process successful result from GitHub API
	// Note: Map values require .Expression() (smart conversion only works for top-level fields)
	wf.Set("processSuccess", &workflow.SetArgs{
		Variables: map[string]string{
			"pr_title":  tryTask.Field("title").Expression(),
			"pr_state":  tryTask.Field("state").Expression(),
			"pr_author": tryTask.Field("user.login").Expression(),
			"status":    "completed",
		},
	})

	// Task 3b: Log failure
	wf.Set("logFailure", &workflow.SetArgs{
		Variables: map[string]string{
			"status": "failed",
			"reason": tryTask.Field("error").Expression(),
		},
	})

		log.Printf("Created workflow with error handling: %s", wf)
		log.Println("\nNote: This example demonstrates error handling with real GitHub API")
		log.Println("      Try/catch handles network errors, 404s, and timeouts")
		log.Println("      No authentication required - works as an E2E test!")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with error handling created successfully!")
	log.Println("   Demonstrates resilient API calls with try/catch blocks")
}
