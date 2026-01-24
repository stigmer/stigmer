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
		apiBase := ctx.SetString("apiBase", "https://api.example.com")
		_ = ctx.SetInt("maxRetries", 3) // Define max retries in context

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("resilient-workflows"),
			workflow.WithName("resilient-api-call"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Make API calls with error handling and retries"),
		)
		if err != nil {
			return err
		}

		// Task 1: Try to make API call with error handling
		tryTask := wf.Try("attemptAPICall", &workflow.TryArgs{
			Tasks: []map[string]interface{}{
				{
					"httpCall": map[string]interface{}{
						"method": "GET",
						"uri":    apiBase.Concat("/data").Expression(),
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

		// Task 3a: Process successful result
		wf.Set("processSuccess", &workflow.SetArgs{
			Variables: map[string]string{
				"result": tryTask.Field("data").Expression(),
				"status": "completed",
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
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with error handling created successfully!")
}
