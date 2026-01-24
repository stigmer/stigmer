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

	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Context for configuration
		apiBase := ctx.SetString("apiBase", "https://api.github.com")

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("deployments"),
			workflow.WithName("conditional-deployment"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Deploy based on pull request status from GitHub"),
		)
		if err != nil {
			return err
		}

		// Task 1: Check pull request status from hello-stigmer repository
		checkTask := wf.HttpGet("checkPullRequest",
			apiBase.Concat("/repos/stigmer/hello-stigmer/pulls/1"),
			map[string]string{
				"Accept":     "application/vnd.github.v3+json",
				"User-Agent": "Stigmer-SDK-Example",
			},
		)

		// Task 2: Switch based on PR state
		// Using the new fluent API for building conditions
		state := checkTask.Field("state")
		switchTask := wf.Switch("deploymentDecision", &workflow.SwitchArgs{
			Cases: []*types.SwitchCase{
				{
					Name: "production",
					When: state.Equals("closed"), // ✅ Fluent API - PR is merged/closed
					Then: "deployProduction",
				},
				{
					Name: "staging",
					When: state.Equals("open"), // PR is still open
					Then: "deployStaging",
				},
				{
					Name: "default",
					// When left empty, this becomes the default case
					Then: "handleError",
				},
			},
		})

		// Task 3a: Production deployment (PR is closed/merged)
		// Note: Map values require .Expression() (smart conversion only works for top-level fields)
		wf.Set("deployProduction", &workflow.SetArgs{
			Variables: map[string]string{
				"environment": "production",
				"replicas":    "5",
				"pr_title":    checkTask.Field("title").Expression(),
				"pr_merged":   checkTask.Field("merged").Expression(),
			},
		}).DependsOn(switchTask)

		// Task 3b: Staging deployment (PR is open)
		wf.Set("deployStaging", &workflow.SetArgs{
			Variables: map[string]string{
				"environment": "staging",
				"replicas":    "2",
				"pr_title":    checkTask.Field("title").Expression(),
				"pr_state":    checkTask.Field("state").Expression(),
			},
		}).DependsOn(switchTask)

		// Task 3c: Error handler
		wf.Set("handleError", &workflow.SetArgs{
			Variables: map[string]string{
				"status": "failed",
				"reason": "Unable to determine deployment status",
			},
		}).DependsOn(switchTask)

		// ============================================================================
		// Additional examples demonstrating various TaskFieldRef helper methods
		// ============================================================================

		// Example 2: Numeric comparisons
		// Fetch repository statistics from GitHub
		metricsTask := wf.HttpGet("fetchRepoStats",
			apiBase.Concat("/repos/stigmer/hello-stigmer"),
			map[string]string{
				"Accept":     "application/vnd.github.v3+json",
				"User-Agent": "Stigmer-SDK-Example",
			},
		)

		// Use GreaterThan for numeric comparisons on real GitHub data
		openIssues := metricsTask.Field("open_issues_count")
		stargazers := metricsTask.Field("stargazers_count")

		wf.Switch("checkRepoHealth", &workflow.SwitchArgs{
			Cases: []*types.SwitchCase{
				{
					Name: "needsAttention",
					// ✅ Clean numeric comparison - much better than string concatenation!
					When: openIssues.GreaterThan(10), // Too many open issues
					Then: "alertCritical",
				},
				{
					Name: "popular",
					// ✅ Shows GreaterThanOrEqual
					When: stargazers.GreaterThanOrEqual(100), // Popular repo
					Then: "alertWarning",
				},
				{
					Name: "healthy",
					// Default case - repo is healthy
					Then: "continueNormal",
				},
			},
		})

		// Example 3: String operations
		// Fetch pull request for string matching demonstrations
		statusTask := wf.HttpGet("fetchPRForStringMatch",
			apiBase.Concat("/repos/stigmer/hello-stigmer/pulls/1"),
			map[string]string{
				"Accept":     "application/vnd.github.v3+json",
				"User-Agent": "Stigmer-SDK-Example",
			},
		)

		// Use Contains, StartsWith for string matching on PR title and body
		prTitle := statusTask.Field("title")
		prBody := statusTask.Field("body")

		wf.Switch("routeByPRContent", &workflow.SwitchArgs{
			Cases: []*types.SwitchCase{
				{
					Name: "bugFix",
					// ✅ String matching with Contains - no manual JQ syntax!
					When: prTitle.Contains("fix"),
					Then: "handleDeploymentError",
				},
				{
					Name: "feature",
					// ✅ String prefix matching
					When: prTitle.StartsWith("feat:"),
					Then: "initiateRollback",
				},
				{
					Name: "hotfix",
					// ✅ String matching in body
					When: prBody.Contains("urgent"),
					Then: "markSuccess",
				},
				{
					Name: "regularPR",
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
	log.Println("   - Equals() for exact matching (PR state)")
	log.Println("   - GreaterThan() and GreaterThanOrEqual() for numeric comparisons (issues, stars)")
	log.Println("   - Contains(), StartsWith() for string operations (PR title/body)")
	log.Println("   All without error-prone string concatenation!")
	log.Println("\nNote: This example uses real GitHub API data from stigmer/hello-stigmer")
	log.Println("      No authentication required - works as an E2E test!")
}
