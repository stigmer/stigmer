//go:build ignore

// Example 08: Workflow with Conditionals - Fluent API Demo
//
// This example demonstrates conditional logic using SWITCH tasks with the new
// fluent TaskFieldRef helper methods. Shows comparison operators, string operations,
// and clean condition building without string concatenation.
//
// Features demonstrated:
// - TaskFieldRef.Equals() for equality comparisons
// - TaskFieldRef.GreaterThan() for numeric comparisons
// - TaskFieldRef.Contains() for string operations
// - Clean, type-safe condition building
package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/types"
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
		// Using the new fluent API for building conditions
		statusCode := checkTask.Field("statusCode")
		switchTask := wf.Switch("routeByStatus", &workflow.SwitchArgs{
			Cases: []*types.SwitchCase{
				{
					Name: "production",
					When: statusCode.Equals(200), // ✅ Fluent API - Clear and type-safe!
					Then: "deployProduction",
				},
				{
					Name: "staging",
					When: statusCode.Equals(202), // Much better than string concatenation!
					Then: "deployStaging",
				},
				{
					Name: "default",
					// When left empty, this becomes the default case
					Then: "handleError",
				},
			},
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

		// ============================================================================
		// Additional examples demonstrating various TaskFieldRef helper methods
		// ============================================================================

		// Example 2: Numeric comparisons
		// Fetch some metrics
		metricsTask := wf.HttpGet("fetchMetrics",
			apiBase.Concat("/metrics").Expression(),
			nil,
		)

		// Use GreaterThan, LessThan for numeric comparisons
		errorRate := metricsTask.Field("errorRate")
		latency := metricsTask.Field("latency")

		wf.Switch("checkHealthMetrics", &workflow.SwitchArgs{
			Cases: []*types.SwitchCase{
				{
					Name: "critical",
					// ✅ Clean numeric comparison - much better than string concatenation!
					When: errorRate.GreaterThan(0.1), // Error rate > 10%
					Then: "alertCritical",
				},
				{
					Name: "degraded",
					// ✅ Shows LessThanOrEqual
					When: latency.GreaterThanOrEqual(500), // Latency >= 500ms
					Then: "alertWarning",
				},
				{
					Name: "healthy",
					// Default case - all metrics good
					Then: "continueNormal",
				},
			},
		})

		// Example 3: String operations
		// Fetch deployment status message
		statusTask := wf.HttpGet("fetchStatus",
			apiBase.Concat("/deployment/status").Expression(),
			nil,
		)

		// Use Contains, StartsWith for string matching
		message := statusTask.Field("message")
		deploymentType := statusTask.Field("type")

		wf.Switch("routeByMessage", &workflow.SwitchArgs{
			Cases: []*types.SwitchCase{
				{
					Name: "errorDetected",
					// ✅ String matching with Contains - no manual JQ syntax!
					When: message.Contains("error"),
					Then: "handleDeploymentError",
				},
				{
					Name: "rollbackNeeded",
					// ✅ String prefix matching
					When: message.StartsWith("ROLLBACK:"),
					Then: "initiateRollback",
				},
				{
					Name: "successMessage",
					// ✅ String suffix matching
					When: message.EndsWith("completed successfully"),
					Then: "markSuccess",
				},
				{
					Name: "unknownStatus",
					// Default case
					Then: "investigateStatus",
				},
			},
		})

		// Placeholder tasks for the additional examples
		wf.Set("alertCritical", &workflow.SetArgs{
			Variables: map[string]string{"alert": "critical"},
		})
		wf.Set("alertWarning", &workflow.SetArgs{
			Variables: map[string]string{"alert": "warning"},
		})
		wf.Set("continueNormal", &workflow.SetArgs{
			Variables: map[string]string{"status": "healthy"},
		})
		wf.Set("handleDeploymentError", &workflow.SetArgs{
			Variables: map[string]string{"action": "handle_error"},
		})
		wf.Set("initiateRollback", &workflow.SetArgs{
			Variables: map[string]string{"action": "rollback"},
		})
		wf.Set("markSuccess", &workflow.SetArgs{
			Variables: map[string]string{"status": "success"},
		})
		wf.Set("investigateStatus", &workflow.SetArgs{
			Variables: map[string]string{"action": "investigate"},
		})

		log.Printf("Created workflow with conditional logic demonstrating fluent API: %s", wf)
		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Workflow with conditionals created successfully!")
	log.Println("   Demonstrated helper methods:")
	log.Println("   - Equals() for exact matching")
	log.Println("   - GreaterThan() and GreaterThanOrEqual() for numeric comparisons")
	log.Println("   - Contains(), StartsWith(), EndsWith() for string operations")
	log.Println("   All without error-prone string concatenation!")
}
