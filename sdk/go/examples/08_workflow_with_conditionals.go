//go:build ignore

// Example 08: Workflow with Conditionals
//
// This example demonstrates conditional logic using SWITCH tasks.
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

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("deployments"),
			workflow.WithName("conditional-deployment"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Deploy based on environment conditions"),
		)
		if err != nil {
			return err
		}

		// Task 1: Check deployment environment
		checkTask := wf.HttpGet("checkEnvironment",
			apiBase.Concat("/status").Expression(),
			nil, // No custom headers
		)

		// Task 2: Switch based on status code
		statusCode := checkTask.Field("statusCode")
		switchTask := wf.Switch("routeByStatus", &workflow.SwitchArgs{
			Cases: []map[string]interface{}{
				{
					"condition": statusCode.Expression() + " == 200",
					"then":      "deployProduction",
				},
				{
					"condition": statusCode.Expression() + " == 202",
					"then":      "deployStaging",
				},
			},
			DefaultTask: "handleError",
		})

		// Task 3a: Production deployment
		wf.Set("deployProduction", &workflow.SetArgs{
			Variables: map[string]string{
				"environment": "production",
				"replicas":    "5",
			},
		}).DependsOn(switchTask)

		// Task 3b: Staging deployment
		wf.Set("deployStaging", &workflow.SetArgs{
			Variables: map[string]string{
				"environment": "staging",
				"replicas":    "2",
			},
		}).DependsOn(switchTask)

		// Task 3c: Error handler
		wf.Set("handleError", &workflow.SetArgs{
			Variables: map[string]string{
				"status": "failed",
				"reason": "Invalid status code",
			},
		}).DependsOn(switchTask)

		log.Printf("Created workflow with conditional logic: %s", wf)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with conditionals created successfully!")
}
