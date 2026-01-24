// Package templates provides canonical code templates used by the Stigmer CLI
// and documentation. These templates demonstrate proper SDK usage patterns and
// serve as the single source of truth for generated code.
//
// The CLI's `stigmer init` command imports and uses these templates to ensure
// generated code stays in sync with SDK capabilities and best practices.
package templates

// BasicAgent returns a complete, minimal example of creating an agent.
// This template demonstrates the simplest possible agent configuration with
// only required fields.
//
// Used by: stigmer init (when --template=agent flag is used)
// Demonstrates: agent.New(), stigmer.Run(), minimal configuration
func BasicAgent() string {
	return `package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a basic agent with required fields only
		jokeAgent, err := agent.New(ctx, "joke-buddy", &agent.AgentArgs{
			Instructions: ` + "`" + `You are a friendly AI that tells programming jokes and puns.
When someone interacts with you, respond with a light-hearted programming joke or pun.
Keep it fun, simple, and appropriate for all audiences.

Examples:
- Why do programmers prefer dark mode? Because light attracts bugs!
- How many programmers does it take to change a light bulb? None, that's a hardware problem.
- A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"` + "`" + `,
			Description: "A friendly AI that tells programming jokes",
		})
		if err != nil {
			return err
		}

		log.Println("✅ Created joke-telling agent:")
		log.Printf("   Name: %s\n", jokeAgent.Name)
		log.Printf("   Description: %s\n", jokeAgent.Description)
		log.Println("\n🚀 Agent created successfully!")
		log.Println("   Deploy with: stigmer apply")

		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Resources synthesized successfully!")
}
`
}

// BasicWorkflow returns a complete, minimal example of creating a workflow.
// This template demonstrates a simple HTTP GET workflow with task dependencies.
//
// Used by: stigmer init (when --template=workflow flag is used)
// Demonstrates: workflow.New(), context config, HttpGet, SetVars, implicit dependencies
func BasicWorkflow() string {
	return `package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Use context for shared configuration (Pulumi-aligned pattern)
		apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")

		// Create workflow with context
		wf, err := workflow.New(ctx,
			workflow.WithNamespace("demo"),
			workflow.WithName("basic-data-fetch"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("A simple workflow that fetches data from an API"),
		)
		if err != nil {
			return err
		}

		// Build endpoint URL using context config
		endpoint := apiBase.Concat("/posts/1")

		// Task 1: Fetch data from API (clean, one-liner!)
		// Dependencies are implicit - no ThenRef needed!
		fetchTask := wf.HttpGet("fetchData", endpoint,
			workflow.Header("Content-Type", "application/json"),
			workflow.Timeout(30),
		)

		// Task 2: Process response using direct task references
		// Dependencies are automatic through field references!
		processTask := wf.SetVars("processResponse",
			"postTitle", fetchTask.Field("title"),
			"postBody", fetchTask.Field("body"),
			"status", "completed",
		)

		log.Println("✅ Created data-fetching workflow:")
		log.Printf("   Name: %s\n", wf.Document.Name)
		log.Printf("   Description: %s\n", wf.Description)
		log.Printf("   Tasks: %d\n", len(wf.Tasks))
		log.Printf("     - %s (HTTP GET)\n", fetchTask.Name)
		log.Printf("     - %s (depends on %s implicitly)\n", processTask.Name, fetchTask.Name)
		log.Println("\n🚀 Workflow created successfully!")
		log.Println("   Deploy with: stigmer apply")

		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("✅ Resources synthesized successfully!")
}
`
}

// AgentAndWorkflow returns a combined example with both agent and workflow.
// This is the default template used by `stigmer new` to demonstrate both
// major SDK capabilities in a single project with zero configuration.
//
// Used by: stigmer new (default template)
// Demonstrates: agent.New(), workflow.New(), workflow.CallAgent(), real GitHub PR analysis
func AgentAndWorkflow() string {
	return `package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
	// Use stigmer.Run() for automatic context and synthesis management
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// ============================================
		// PART 1: Define AI Agent
		// ============================================
		// This agent analyzes pull requests - just describe what you want in plain English!

		reviewer, err := agent.New(ctx,
			agent.WithName("pr-reviewer"),
			agent.WithDescription("AI code reviewer that analyzes pull requests"),
			agent.WithInstructions(` + "`" + `You are an expert code reviewer.

Analyze the provided pull request and give:
1. Overall assessment (looks good / needs work / has issues)
2. Key findings (bugs, improvements, security concerns)
3. Actionable suggestions

Be concise and helpful.` + "`" + `),
		)
		if err != nil {
			return err
		}

		log.Println("✅ Created PR reviewer agent:")
		log.Printf("   Name: %s\n", reviewer.Name)

		// ============================================
		// PART 2: Define Workflow
		// ============================================
		// This workflow fetches a real PR from GitHub and asks the agent to review it

		pipeline, err := workflow.New(ctx,
			workflow.WithNamespace("quickstart"),
			workflow.WithName("review-demo-pr"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Analyzes a demo pull request with AI"),
		)
		if err != nil {
			return err
		}

		// Step 1: Fetch PR from Stigmer's public demo repository
		// No authentication needed - it's a public repo!
		fetchPR := pipeline.HttpGet("fetch-pr",
			"https://api.github.com/repos/stigmer/hello-stigmer/pulls/1",
			workflow.Header("Accept", "application/vnd.github.v3+json"),
			workflow.Header("User-Agent", "Stigmer-Demo"),
		)

		// Step 2: Get the PR diff to analyze the actual code changes
		fetchDiff := pipeline.HttpGet("fetch-diff",
			fetchPR.Field("diff_url").Expression(),
			workflow.Header("Accept", "application/vnd.github.v3.diff"),
		)

		// Step 3: Send to AI agent for review
		analyze := pipeline.CallAgent(
			"analyze-pr",
			workflow.AgentOption(workflow.Agent(reviewer)),
			workflow.Message(
				"PR Title: "+fetchPR.Field("title").Expression()+"\n"+
					"PR Description: "+fetchPR.Field("body").Expression()+"\n"+
					"Code Changes:\n"+fetchDiff.Field("body").Expression(),
			),
			workflow.AgentModel("claude-3-5-sonnet"),
			workflow.AgentTimeout(60),
		)

		// Step 4: Store the results
		results := pipeline.SetVars("store-results",
			"prTitle", fetchPR.Field("title"),
			"prNumber", fetchPR.Field("number"),
			"review", analyze.Field("response"),
			"reviewedAt", "${.context.timestamp}",
		)
		results.ExportAs = "pr-review-result"

		// ============================================
		// SUMMARY: Show what was created
		// ============================================
		log.Println("\n✅ Created PR review pipeline:")
		log.Printf("   Workflow: %s\n", pipeline.Document.Name)
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
