//go:build ignore

// Package examples demonstrates workflow and agent sharing the same typed context.
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
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
		
		// Create shared environment variable
		apiToken, err := environment.New(
			environment.WithName("API_TOKEN"),
			environment.WithSecret(true),
			environment.WithDescription("API authentication token"),
		)
		if err != nil {
			return err
		}

		// Create a workflow that uses the shared context
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("data-processing"),
			workflow.WithName("fetch-and-analyze"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Fetch data from API and analyze with agent"),
			workflow.WithOrg(orgName),  // Shared typed reference
			workflow.WithEnvironmentVariable(apiToken),
		)
		if err != nil {
			return err
		}

	// Add workflow tasks using shared context variables
	endpoint := apiURL.Concat("/data")
	
	// Task 1: Fetch data using HTTP GET
	_ = wf.HttpGet("fetchData", endpoint,
		workflow.Header("Content-Type", "application/json"),
		workflow.Timeout(30),
	)
	
	// Task 2: Process data
	_ = wf.Set("processData",
		workflow.SetVar("status", "processing"),
		workflow.SetVar("retries", retryCount),  // Uses shared retryCount
	)

		// Create an agent that uses the SAME shared context
		ag, err := agent.New(ctx,
			agent.WithName("data-analyzer"),
			agent.WithInstructions("Analyze data from the API and provide insights"),
			agent.WithDescription("AI data analyst"),
			agent.WithOrg(orgName),  // Same shared typed reference as workflow!
			agent.WithEnvironmentVariable(apiToken),  // Same environment variable
		)
		if err != nil {
			return err
		}

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
