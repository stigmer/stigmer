// Package embedded provides templates for project scaffolding.
package embedded

// AgentAndWorkflow returns a combined example with both agent and workflow.
// This is the default template used by `stigmer new` to demonstrate both
// major SDK capabilities in a single project with zero configuration.
func AgentAndWorkflow() string {
	return `package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// ============================================
		// PART 1: Define AI Agent
		// ============================================
		// This agent analyzes pull requests - just describe what you want in plain English!

		reviewer, err := agent.New(ctx, "pr-reviewer", &agent.AgentArgs{
			Instructions: ` + "`" + `You are an expert code reviewer.

Analyze the provided pull request and give:
1. Overall assessment (looks good / needs work / has issues)
2. Key findings (bugs, improvements, security concerns)
3. Actionable suggestions

Be concise and helpful.` + "`" + `,
			Description: "AI code reviewer that analyzes pull requests",
		})
		if err != nil {
			return err
		}

		log.Println("✅ Created PR reviewer agent:")
		log.Printf("   Name: %s\n", reviewer.Name)

		// ============================================
		// PART 2: Define Workflow
		// ============================================
		// This workflow fetches a real PR from GitHub and asks the agent to review it

		pipeline, err := workflow.New(ctx, "quickstart/review-demo-pr", &workflow.WorkflowArgs{
			Description: "Analyzes a demo pull request with AI",
		})
		if err != nil {
			return err
		}

		// Step 1: Fetch PR from Stigmer's public demo repository
		// No authentication needed - it's a public repo!
		fetchPR := pipeline.HttpGet("fetch-pr",
			"https://api.github.com/repos/stigmer/hello-stigmer/pulls/1",
			map[string]string{
				"Accept":     "application/vnd.github.v3+json",
				"User-Agent": "Stigmer-Demo",
			},
		)

		// Step 2: Get the PR diff to analyze the actual code changes
		fetchDiff := pipeline.HttpGet("fetch-diff",
			fetchPR.Field("diff_url").Expression(),
			map[string]string{
				"Accept": "application/vnd.github.v3.diff",
			},
		)

		// Step 3: Send to AI agent for review
		analyze := pipeline.CallAgent("analyze-pr", &workflow.AgentCallArgs{
			Agent: reviewer.Name,
			Message: "PR Title: " + fetchPR.Field("title").Expression() + "\n" +
				"PR Description: " + fetchPR.Field("body").Expression() + "\n" +
				"Code Changes:\n" + fetchDiff.Field("body").Expression(),
			Config: &types.AgentExecutionConfig{
				Model:   "claude-3-5-sonnet",
				Timeout: 60,
			},
		})

		// Step 4: Store the results
		_ = pipeline.Set("store-results", &workflow.SetArgs{
			Variables: map[string]string{
				"prTitle":    fetchPR.Field("title").Expression(),
				"prNumber":   fetchPR.Field("number").Expression(),
				"review":     analyze.Field("response").Expression(),
				"reviewedAt": "${.context.timestamp}",
			},
		})

		// ============================================
		// SUMMARY: Show what was created
		// ============================================
		log.Println("\n✅ Created PR review pipeline:")
		log.Printf("   Workflow: %s\n", pipeline.Name)
		log.Printf("   Agent: %s\n", reviewer.Name)
		log.Println("\n   What it does:")
		log.Println("     1. Fetches PR from github.com/stigmer/hello-stigmer")
		log.Println("     2. Gets the code diff")
		log.Println("     3. AI agent reviews the changes ✨")
		log.Println("     4. Outputs the review")

		log.Println("\n🚀 Ready to run!")
		log.Println("\n   Try it:")
		log.Println("     stigmer run")
		log.Println("\n   💡 This demonstrates:")
		log.Println("      • AI agents with natural language instructions")
		log.Println("      • Real-world API integration (GitHub)")
		log.Println("      • Workflows calling agents")
		log.Println("      • Zero configuration required!")

		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("\n✅ Resources synthesized successfully!")
}
`
}
