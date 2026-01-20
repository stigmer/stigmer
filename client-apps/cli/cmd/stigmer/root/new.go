package root

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/sdk/go/templates"
)

// NewCommand creates the new command for project scaffolding
func NewCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "new [project-name]",
		Short: "Create a new Stigmer project",
		Long: `Create a new Stigmer project with zero configuration.

This command scaffolds a complete working example that:
  - Includes an AI agent (PR code reviewer)
  - Includes a workflow (fetches and analyzes a real GitHub PR)
  - Works immediately with zero setup
  - Demonstrates agent-workflow integration

Just run 'stigmer new my-project' and then 'stigmer run'!`,
		Args: cobra.MaximumNArgs(1),
		Run:  newHandler,
	}
}

func newHandler(cmd *cobra.Command, args []string) {
	// Determine project name
	projectName := "stigmer-project"
	if len(args) > 0 {
		projectName = args[0]
	}

	// Validate project name
	if !isValidProjectName(projectName) {
		cliprint.PrintError("Invalid project name: %s", projectName)
		cliprint.PrintInfo("Project name must contain only letters, numbers, hyphens, and underscores")
		return
	}

	// Check if directory already exists
	if _, err := os.Stat(projectName); err == nil {
		cliprint.PrintError("Directory '%s' already exists", projectName)
		return
	}

	cliprint.PrintInfo("Creating Stigmer project: %s", projectName)
	fmt.Println()

	// Create project directory
	if err := os.MkdirAll(projectName, 0755); err != nil {
		cliprint.PrintError("Failed to create project directory")
		clierr.Handle(err)
		return
	}

	// Generate all project files
	steps := []struct {
		name     string
		filename string
		content  string
	}{
		{"stigmer.yaml", "stigmer.yaml", generateStigmerYAML(projectName)},
		{"main.go (AI-powered PR reviewer)", "main.go", templates.AgentAndWorkflow()},
		{"go.mod", "go.mod", generateGoMod(projectName)},
		{".gitignore", ".gitignore", generateGitignore()},
		{"README.md", "README.md", generateReadme(projectName)},
	}

	for _, step := range steps {
		cliprint.PrintSuccess("Creating %s", step.name)
		filePath := filepath.Join(projectName, step.filename)
		if err := os.WriteFile(filePath, []byte(step.content), 0644); err != nil {
			cliprint.PrintError("Failed to create %s", step.filename)
			clierr.Handle(err)
			// Cleanup on failure
			os.RemoveAll(projectName)
			return
		}
	}

	// Install dependencies
	cliprint.PrintInfo("Installing dependencies...")
	
	// Get the latest SDK version
	getCmd := exec.Command("go", "get", "github.com/stigmer/stigmer/sdk/go@latest")
	getCmd.Dir = projectName
	getCmd.Stdout = os.Stdout
	getCmd.Stderr = os.Stderr
	if err := getCmd.Run(); err != nil {
		cliprint.PrintWarning("Failed to fetch SDK - you may need to run 'go get github.com/stigmer/stigmer/sdk/go@latest' manually")
	}
	
	// Run go mod tidy to resolve all dependencies
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = projectName
	tidyCmd.Stdout = os.Stdout
	tidyCmd.Stderr = os.Stderr
	if err := tidyCmd.Run(); err != nil {
		cliprint.PrintWarning("Failed to run 'go mod tidy' - you may need to run it manually")
	} else {
		cliprint.PrintSuccess("Dependencies installed")
	}

	// Show success message
	fmt.Println()
	cliprint.PrintSuccess("Project created successfully!")
	fmt.Println()
	fmt.Println("What's included:")
	cliprint.PrintInfo("  • AI Agent:   Code reviewer (natural language instructions)")
	cliprint.PrintInfo("  • Workflow:   Fetches real PR from GitHub + analyzes it")
	cliprint.PrintInfo("  • Zero setup: No tokens or config needed!")
	fmt.Println()
	fmt.Println("Try it now:")
	cliprint.InfoColor.Printf("  cd %s\n", projectName)
	cliprint.InfoColor.Printf("  stigmer run\n")
	fmt.Println()
}

func isValidProjectName(name string) bool {
	if len(name) == 0 {
		return false
	}
	for _, r := range name {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func generateStigmerYAML(projectName string) string {
	return fmt.Sprintf(`name: %s
version: 1.0.0
description: AI-powered PR review demo
`, projectName)
}

func generateGoMod(projectName string) string {
	// Use the project name as module name (sanitized)
	moduleName := strings.ReplaceAll(projectName, "-", "_")
	
	// Generate go.mod with replace directives to ensure both SDK and stubs use the version with tracked stubs
	// This overrides the SDK's internal replace directives which only work inside the stigmer repo
	// Using commit fc443b1640d1 which includes the tracked stubs directory
	return fmt.Sprintf(`module %s

go 1.24

require (
	github.com/stigmer/stigmer/sdk/go v0.0.0-00010101000000-000000000000
)

replace github.com/stigmer/stigmer/sdk/go => github.com/stigmer/stigmer/sdk/go v0.0.0-20260120005545-fc443b1640d1

replace github.com/stigmer/stigmer/apis/stubs/go => github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120005545-fc443b1640d1
`, moduleName)
}

func generateGitignore() string {
	return `# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib
bin/
dist/

# Test binary, built with 'go test -c'
*.test

# Output of the go coverage tool
*.out

# Go workspace file
go.work
go.work.sum

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Stigmer
.stigmer/
stigmer.state
`
}

func generateReadme(projectName string) string {
	return "# " + projectName + "\n\n" +
		"An AI-powered pull request reviewer built with Stigmer.\n\n" +
		"## What's Included\n\n" +
		"This project demonstrates Stigmer's core capabilities:\n\n" +
		"- **AI Agent**: A code reviewer that analyzes PRs using natural language instructions\n" +
		"- **Workflow**: Fetches a real PR from GitHub and sends it to the agent for review\n" +
		"- **Zero Configuration**: Works immediately without tokens or setup\n\n" +
		"## Quick Start\n\n" +
		"### 1. Start Stigmer Server\n\n" +
		"```bash\n" +
		"stigmer server\n" +
		"```\n\n" +
		"### 2. Run the Workflow\n\n" +
		"```bash\n" +
		"stigmer run\n" +
		"```\n\n" +
		"That's it! The workflow will:\n" +
		"1. Fetch PR #1 from [stigmer/hello-stigmer](https://github.com/stigmer/hello-stigmer)\n" +
		"2. Get the code diff\n" +
		"3. Send it to the AI agent for review\n" +
		"4. Display the code review\n\n" +
		"## How It Works\n\n" +
		"### The Agent\n\n" +
		"The agent is defined with simple, natural language instructions:\n\n" +
		"```go\n" +
		"agent.New(ctx,\n" +
		"    agent.WithName(\"pr-reviewer\"),\n" +
		"    agent.WithInstructions(\"You are an expert code reviewer...\"),\n" +
		")\n" +
		"```\n\n" +
		"No complex configuration - just describe what you want!\n\n" +
		"### The Workflow\n\n" +
		"The workflow chains tasks together:\n\n" +
		"```go\n" +
		"// Fetch PR data\n" +
		"fetchPR := workflow.HttpGet(\"fetch-pr\", \"https://api.github.com/...\")\n\n" +
		"// Get code diff\n" +
		"fetchDiff := workflow.HttpGet(\"fetch-diff\", fetchPR.Field(\"diff_url\"))\n\n" +
		"// AI review\n" +
		"analyze := workflow.CallAgent(\"analyze-pr\", \n" +
		"    workflow.Agent(reviewer),\n" +
		"    workflow.Message(fetchDiff.Field(\"body\")),\n" +
		")\n" +
		"```\n\n" +
		"Task dependencies are automatic through field references!\n\n" +
		"## Customization\n\n" +
		"### Use Your Own Repository\n\n" +
		"Edit `main.go` and change the GitHub API URLs to point to your repository:\n\n" +
		"```go\n" +
		"fetchPR := pipeline.HttpGet(\"fetch-pr\",\n" +
		"    \"https://api.github.com/repos/YOUR_ORG/YOUR_REPO/pulls/1\",\n" +
		"    // ...\n" +
		")\n" +
		"```\n\n" +
		"### Modify Agent Instructions\n\n" +
		"Update the agent's instructions to change review focus:\n\n" +
		"```go\n" +
		"agent.WithInstructions(\"Focus on security issues...\")\n" +
		"```\n\n" +
		"### Add More Steps\n\n" +
		"Workflows are composable - add more tasks:\n\n" +
		"```go\n" +
		"// Send review to Slack\n" +
		"notify := pipeline.HttpPost(\"notify-slack\", \n" +
		"    \"https://hooks.slack.com/...\",\n" +
		"    workflow.Body(analyze.Field(\"response\")),\n" +
		")\n" +
		"```\n\n" +
		"## Learn More\n\n" +
		"- [Stigmer Documentation](https://docs.stigmer.ai)\n" +
		"- [SDK Reference](https://github.com/stigmer/stigmer/tree/main/sdk/go)\n" +
		"- [Examples](https://github.com/stigmer/stigmer/tree/main/examples)\n\n" +
		"## Next Steps\n\n" +
		"1. **Explore the code**: Check out `main.go` to see how it works\n" +
		"2. **Modify the agent**: Change the review instructions\n" +
		"3. **Try your own PRs**: Point it at your repositories\n" +
		"4. **Build something new**: Use this as a template for your automation\n\n" +
		"---\n\n" +
		"Built with [Stigmer](https://stigmer.ai) - Workflow as Code\n"
}
