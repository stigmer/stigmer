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
		jokeAgent, err := agent.New(ctx,
			agent.WithName("joke-buddy"),
			agent.WithInstructions(` + "`" + `You are a friendly AI that tells programming jokes and puns.
When someone interacts with you, respond with a light-hearted programming joke or pun.
Keep it fun, simple, and appropriate for all audiences.

Examples:
- Why do programmers prefer dark mode? Because light attracts bugs!
- How many programmers does it take to change a light bulb? None, that's a hardware problem.
- A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"` + "`" + `),
			agent.WithDescription("A friendly AI that tells programming jokes"),
		)
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
// This is the default template used by `stigmer init` to demonstrate both
// major SDK capabilities in a single project.
//
// Used by: stigmer init (default template)
// Demonstrates: agent.New(), workflow.New(), workflow.CallAgent(), context variables, task chaining
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
		// CONFIGURATION: Set up context variables
		// ============================================
		// Context variables are shared across all resources and can be used
		// for configuration, making your workflows parameterized and reusable
		apiBase := ctx.SetString("apiBase", "https://api.github.com")
		repoPath := ctx.SetString("repoPath", "/repos/leftbin/stigmer")
		summaryLength := ctx.SetString("summaryLength", "3-4 sentences")

		// ============================================
		// AGENT: Create a repository analyzer agent
		// ============================================
		// This agent analyzes GitHub repository data and provides insights
		analyzer, err := agent.New(ctx,
			agent.WithName("repo-analyzer"),
			agent.WithDescription("AI agent that analyzes GitHub repositories"),
			agent.WithInstructions(` + "`" + `You are a software engineering analyst who reviews GitHub repositories.

When you receive repository data, analyze it and create a summary with:
1. **Project Overview**: What the project does based on description and language
2. **Activity Level**: Based on stars, forks, and recent updates
3. **Key Insights**: 2-3 interesting observations about the repository

The summary length should be: ` + "`" + ` + "${.env.SUMMARY_LENGTH}" + ` + "`" + `

Format your response as plain text with clear sections.` + "`" + `),
		)
		if err != nil {
			return err
		}

		log.Println("✅ Created repository analyzer agent:")
		log.Printf("   Name: %s\n", analyzer.Name)

		// ============================================
		// WORKFLOW: Repository analysis pipeline
		// ============================================
		// This workflow demonstrates:
		// 1. Fetching data from GitHub API (real-world API)
		// 2. Calling an AI agent to analyze the data
		// 3. Extracting and storing the results
		pipeline, err := workflow.New(ctx,
			workflow.WithNamespace("examples"),
			workflow.WithName("repo-analysis-pipeline"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Analyze GitHub repositories with AI"),
		)
		if err != nil {
			return err
		}

		// Build GitHub API endpoint using context variables
		endpoint := apiBase.Concat(repoPath.Expression())

		// TASK 1: Fetch repository data from GitHub API
		fetchTask := pipeline.HttpGet("fetch-repo", endpoint,
			workflow.Header("Accept", "application/vnd.github.v3+json"),
			workflow.Header("User-Agent", "Stigmer-Demo"),
			workflow.Timeout(30),
		)
		fetchTask.ExportAs = "repoData"

		// TASK 2: Call AI agent to analyze the repository
		// This demonstrates the CallAgent feature - workflows can invoke agents!
		analyzeTask := pipeline.CallAgent(
			"analyze-repo",
			workflow.AgentOption(workflow.Agent(analyzer)),
			workflow.Message(fetchTask.Field("body").Expression()), // Pass GitHub API response to agent
			workflow.WithEnv(map[string]string{
				"SUMMARY_LENGTH": summaryLength.Expression(), // Pass context variable to agent
			}),
			workflow.AgentModel("claude-3-5-sonnet"),
			workflow.AgentTimeout(60),
		)
		analyzeTask.ExportAs = "analysis"

		// TASK 3: Extract and store final results
		// Combines repository data with AI analysis
		finalizeTask := pipeline.SetVars("finalize-results",
			"repoName", fetchTask.Field("full_name"),
			"repoStars", fetchTask.Field("stargazers_count"),
			"primaryLanguage", fetchTask.Field("language"),
			"aiAnalysis", analyzeTask.Field("response"),
			"analyzedAt", "${.context.timestamp}",
			"status", "completed",
		)
		finalizeTask.ExportAs = "results"

		// ============================================
		// SUMMARY: Show what was created
		// ============================================
		log.Println("\n✅ Created repository analysis pipeline:")
		log.Printf("   Workflow: %s\n", pipeline.Document.Name)
		log.Printf("   Agent: %s\n", analyzer.Name)
		log.Println("\n   Task Flow:")
		log.Printf("     1. %s → Fetch repo data from GitHub API\n", fetchTask.Name)
		log.Printf("     2. %s → AI agent analyzes the repository ✨\n", analyzeTask.Name)
		log.Printf("     3. %s → Combine repo data + AI insights\n", finalizeTask.Name)

		log.Println("\n🚀 Resources ready to deploy!")
		log.Println("\n   Next steps:")
		log.Println("     1. Deploy:  stigmer apply")
		log.Println("     2. Run:     stigmer run repo-analysis-pipeline")
		log.Println("\n   💡 This example demonstrates:")
		log.Println("      • Real-world API integration (GitHub)")
		log.Println("      • AI agents analyzing production data")
		log.Println("      • Workflows calling agents (CallAgent feature)")
		log.Println("      • Context variables for configuration")
		log.Println("      • Task chaining with field references")
		log.Println("      • Professional data processing pattern")

		return nil
	})

	if err != nil {
		log.Fatal(err)
	}

	log.Println("\n✅ Resources synthesized successfully!")
}
`
}
