//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates passing runtime secrets to agents.
//
// Key learning points:
// - Using workflow.RuntimeSecret() for sensitive data
// - Passing environment variables to agent execution
// - Interpolating secrets in agent messages
// - Security: secrets appear as placeholders in manifest
//
// SECURITY CRITICAL:
// Runtime secrets are NEVER stored in manifests. They are resolved
// just-in-time during agent execution.
//
// Run with:
//
//	stigmer run github-pr-review \
//	  --runtime-env secret:GITHUB_TOKEN=ghp_abc123 \
//	  --runtime-env secret:SLACK_WEBHOOK=https://hooks.slack.com/xyz \
//	  --runtime-env PR_NUMBER=42
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("github"),
			workflow.WithName("github-pr-review"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Automated PR review with GitHub integration"),
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Step 1: Fetch PR details from GitHub API
		// ============================================================================
		// Use runtime secret for GitHub authentication
		fetchPR := wf.HttpGet(
			"fetchPR",
			workflow.Interpolate("https://api.github.com/repos/myorg/myrepo/pulls/", workflow.RuntimeEnv("PR_NUMBER")),
			workflow.Header("Authorization", workflow.Interpolate("token ", workflow.RuntimeSecret("GITHUB_TOKEN"))),
			workflow.Header("Accept", "application/vnd.github.v3+json"),
		)

		log.Printf("✅ Created fetchPR task")

		// ============================================================================
		// Step 2: Call agent to review the PR
		// ============================================================================
		// Pass GitHub token to agent via environment variable
		// Agent can use it to fetch additional context or post comments
		reviewTask := wf.CallAgent(
			"reviewPR",
			workflow.AgentOption(workflow.AgentBySlug("code-reviewer")),
			// Message uses PR data from previous task
			workflow.Message(workflow.Interpolate(
				"Review this PR:\n",
				"Title: ", fetchPR.Field("title"), "\n",
				"Description: ", fetchPR.Field("body"), "\n",
				"Changed files: ", fetchPR.Field("changed_files"), "\n",
			)),
			// Pass runtime secrets to agent environment
			workflow.WithEnv(map[string]string{
				"GITHUB_TOKEN": workflow.RuntimeSecret("GITHUB_TOKEN").Expression(), // Agent can fetch more context
				"PR_NUMBER":    workflow.RuntimeEnv("PR_NUMBER").Expression(),       // Pass PR number
				"REPO_OWNER":   "myorg",                                             // Static config
				"REPO_NAME":    "myrepo",                                            // Static config
			}),
			workflow.AgentTimeout(600), // 10 minutes for thorough review
		)

		log.Printf("✅ Created reviewPR agent task with environment variables")

		// ============================================================================
		// Step 3: Post review to Slack
		// ============================================================================
		// Use agent output and another runtime secret
		notifySlack := wf.HttpPost(
			"notifySlack",
			workflow.RuntimeSecret("SLACK_WEBHOOK"), // Webhook URL from runtime
			workflow.WithBody(map[string]any{
				"text": workflow.Interpolate(
					"PR #", workflow.RuntimeEnv("PR_NUMBER"),
					" Review Complete!\n\n",
					reviewTask.Field("summary"), // Agent's review summary
				).Expression(),
				"attachments": []map[string]any{
					{
						"color": "good",
						"fields": []map[string]any{
							{
								"title": "Review Status",
								"value": reviewTask.Field("status").Expression(),
								"short": true,
							},
							{
								"title": "Issues Found",
								"value": reviewTask.Field("issues_count").Expression(),
								"short": true,
							},
						},
					},
				},
			}),
		)

		log.Printf("✅ Created notifySlack task")
		log.Printf("📊 Total tasks: %d", len(wf.Tasks))
		log.Printf("🔐 Runtime secrets used: GITHUB_TOKEN, SLACK_WEBHOOK")
		log.Printf("🌍 Runtime env vars used: PR_NUMBER")

		return nil
	})

	if err != nil {
		log.Fatalf("❌ Error: %v", err)
	}

	log.Println("✅ Workflow manifest created!")
	log.Println("📝 Check manifest - secrets should appear as placeholders:")
	log.Println("   - ${.secrets.GITHUB_TOKEN} ✅")
	log.Println("   - ${.secrets.SLACK_WEBHOOK} ✅")
	log.Println("   NOT actual secret values! ❌")
}
