//go:build ignore

// Package examples demonstrates workflow and agent sharing the same typed context.
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates how workflows and agents can share the same typed context.
//
// This enables:
// 1. Shared configuration between workflows and agents
// 2. Type-safe references across both
// 3. Consistent variable management
// 4. Compile-time safety for all references
//
// Use case: A workflow that processes data and delegates complex analysis to an agent,
// both using the same API configuration.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create shared context variables
		// These can be used by BOTH workflows and agents!
		apiURL := ctx.SetString("apiURL", "https://api.example.com")
		orgName := ctx.SetString("orgName", "data-processing-team")
		retryCount := ctx.SetInt("retryCount", 3)

		// Create shared environment variable using struct-args pattern
		apiToken, err := environment.New(ctx, "API_TOKEN", &environment.VariableArgs{
			IsSecret:    true,
			Description: "API authentication token",
		})
		if err != nil {
			return err
		}

		// Create a workflow that uses the shared context using struct-args pattern
		wf, err := workflow.New(ctx, "data-processing/fetch-and-analyze", &workflow.WorkflowArgs{
			Namespace:   "data-processing",
			Version:     "1.0.0",
			Description: "Fetch data from API and analyze with agent",
			Org:         orgName.Value(),
		})
		if err != nil {
			return err
		}

		// Add environment variable using builder method
		wf.AddEnvironmentVariable(*apiToken)

		// Add workflow tasks using shared context variables
		// Use workflow.Interpolate() to build URL from context variable and literal path
		endpoint := workflow.Interpolate(apiURL, "/data")

		// Task 1: Fetch data using HTTP GET
		_ = wf.HttpGet("fetchData", endpoint, map[string]string{
			"Content-Type": "application/json",
		})

		// Task 2: Process data
		_ = wf.Set("processData", &workflow.SetArgs{
			Variables: map[string]string{
				"status":  "processing",
				"retries": retryCount.Expression(), // Uses shared retryCount
			},
		})

		// Create an agent that uses the SAME shared context
		ag, err := agent.New(ctx, "data-analyzer", &agent.AgentArgs{
			Instructions: "Analyze data from the API and provide insights",
			Description:  "AI data analyst",
		})
		if err != nil {
			return err
		}

		// Set Org field directly (same shared typed reference as workflow!)
		ag.Org = orgName.Value()

		// Add environment variable using builder method (dereference pointer)
		ag.AddEnvironmentVariable(*apiToken) // Same environment variable as workflow!

		log.Printf("Created workflow: %s", wf)
		log.Printf("Created agent: %s", ag)
		log.Println("Both workflow and agent share the same typed context!")
		log.Println("Variables like 'apiURL', 'orgName', and 'retryCount' are type-safe and shared")
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow and agent created with shared context!")
}
