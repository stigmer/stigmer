//go:build ignore
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Example 5: Agent with Environment Variables ===\n")

		// Example 1: Required Secret Variable
		// Secrets are encrypted at rest and redacted in logs
		githubToken, err := environment.New(
			environment.WithName("GITHUB_TOKEN"),
			environment.WithSecret(true),
			environment.WithDescription("GitHub personal access token with repo scope"),
		)
		if err != nil {
			return fmt.Errorf("failed to create GITHUB_TOKEN: %w", err)
		}
		fmt.Printf("✓ Created secret: %s\n", githubToken)

		// Example 2: Optional Configuration with Default
		// Configuration values are stored as plaintext
		awsRegion, err := environment.New(
			environment.WithName("AWS_REGION"),
			environment.WithDefaultValue("us-east-1"),
			environment.WithDescription("AWS region for resource deployment"),
		)
		if err != nil {
			return fmt.Errorf("failed to create AWS_REGION: %w", err)
		}
		fmt.Printf("✓ Created config with default: %s\n", awsRegion)

		// Example 3: Optional Configuration (no default)
		logLevel, err := environment.New(
			environment.WithName("LOG_LEVEL"),
			environment.WithRequired(false),
			environment.WithDescription("Logging level (debug, info, warn, error)"),
		)
		if err != nil {
			return fmt.Errorf("failed to create LOG_LEVEL: %w", err)
		}
		fmt.Printf("✓ Created optional config: %s\n", logLevel)

		// Example 4: Multiple Secrets for Different Services
		slackToken, err := environment.New(
			environment.WithName("SLACK_BOT_TOKEN"),
			environment.WithSecret(true),
			environment.WithDescription("Slack bot token for team communication"),
		)
		if err != nil {
			return fmt.Errorf("failed to create SLACK_BOT_TOKEN: %w", err)
		}

		openaiKey, err := environment.New(
			environment.WithName("OPENAI_API_KEY"),
			environment.WithSecret(true),
			environment.WithDescription("OpenAI API key for embeddings"),
		)
		if err != nil {
			return fmt.Errorf("failed to create OPENAI_API_KEY: %w", err)
		}

		fmt.Printf("✓ Created multiple secrets: %s, %s\n\n", slackToken, openaiKey)

		// Example 5: Agent with Environment Variables
		fmt.Println("=== Creating Agent with Environment Variables ===\n")

		// Create MCP server that uses environment variables
		githubMCP, err := mcpserver.Stdio(
			mcpserver.WithName("github"),
			mcpserver.WithCommand("npx"),
			mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
			mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
		)
		if err != nil {
			return fmt.Errorf("failed to create GitHub MCP server: %w", err)
		}

		// Create agent with environment variables
		deployAgent, err := agent.New(ctx, "cloud-deployer", &agent.AgentArgs{
			Instructions: `You are a cloud deployment agent that manages infrastructure across AWS and GitHub.

Your capabilities:
- Deploy applications to AWS using the specified region
- Manage GitHub repositories and workflows
- Send notifications to Slack
- Use OpenAI for intelligent deployment suggestions

Always check environment configurations before deployment.`,
			Description: "Multi-cloud deployment agent with GitHub integration",
			IconUrl:     "https://example.com/deployer-icon.png",
		})
		if err != nil {
			return fmt.Errorf("failed to create agent: %w", err)
		}

		// Add MCP server and environment variables using builder methods
		deployAgent.AddMCPServer(githubMCP)
		deployAgent.AddEnvironmentVariables(
			githubToken,
			awsRegion,
			logLevel,
			slackToken,
			openaiKey,
		)

		fmt.Printf("✓ Created agent: %s\n", deployAgent.Name)
		fmt.Printf("  - Instructions: %d characters\n", len(deployAgent.Instructions))
		fmt.Printf("  - Environment Variables: %d\n", len(deployAgent.EnvironmentVariables))
		fmt.Printf("  - MCP Servers: %d\n\n", len(deployAgent.MCPServers))

		// Display environment variables
		fmt.Println("=== Environment Variables Configuration ===\n")
		for i, envVar := range deployAgent.EnvironmentVariables {
			fmt.Printf("%d. %s\n", i+1, envVar)
			fmt.Printf("   - Secret: %v\n", envVar.IsSecret)
			fmt.Printf("   - Required: %v\n", envVar.Required)
			if envVar.DefaultValue != "" {
				fmt.Printf("   - Default: %s\n", envVar.DefaultValue)
			}
			if envVar.Description != "" {
				fmt.Printf("   - Description: %s\n", envVar.Description)
			}
			fmt.Println()
		}

		// Example 6: Validation Examples
		fmt.Println("=== Validation Examples ===\n")

		// Invalid name (lowercase)
		_, err = environment.New(
			environment.WithName("github_token"), // Should be uppercase
		)
		if err != nil {
			fmt.Printf("✓ Correctly rejected invalid name: %v\n", err)
		}

		// Invalid name (starts with number)
		_, err = environment.New(
			environment.WithName("2FA_TOKEN"),
		)
		if err != nil {
			fmt.Printf("✓ Correctly rejected name starting with number: %v\n", err)
		}

		// Invalid name (special characters)
		_, err = environment.New(
			environment.WithName("API-KEY"),
		)
		if err != nil {
			fmt.Printf("✓ Correctly rejected name with hyphens: %v\n", err)
		}

		// Missing name
		_, err = environment.New(
			environment.WithSecret(true),
		)
		if err != nil {
			fmt.Printf("✓ Correctly rejected missing name: %v\n\n", err)
		}

		// Example 8: Use Cases
		fmt.Println("=== Common Use Cases ===\n")

		// Use Case 1: Database Connection
		dbHost, _ := environment.New(
			environment.WithName("DB_HOST"),
			environment.WithDefaultValue("localhost"),
			environment.WithDescription("Database host address"),
		)
		dbPort, _ := environment.New(
			environment.WithName("DB_PORT"),
			environment.WithDefaultValue("5432"),
			environment.WithDescription("Database port"),
		)
		dbPassword, _ := environment.New(
			environment.WithName("DB_PASSWORD"),
			environment.WithSecret(true),
			environment.WithDescription("Database password"),
		)
		fmt.Println("✓ Database connection variables:")
		fmt.Printf("  %s, %s, %s\n\n", dbHost, dbPort, dbPassword)

		// Use Case 2: API Integration
		apiEndpoint, _ := environment.New(
			environment.WithName("API_ENDPOINT"),
			environment.WithDefaultValue("https://api.example.com"),
			environment.WithDescription("External API endpoint URL"),
		)
		apiKey, _ := environment.New(
			environment.WithName("API_KEY"),
			environment.WithSecret(true),
			environment.WithDescription("API authentication key"),
		)
		apiTimeout, _ := environment.New(
			environment.WithName("API_TIMEOUT"),
			environment.WithDefaultValue("30"),
			environment.WithDescription("API request timeout in seconds"),
		)
		fmt.Println("✓ API integration variables:")
		fmt.Printf("  %s, %s, %s\n\n", apiEndpoint, apiKey, apiTimeout)

		// Use Case 3: Feature Flags
		featureDebug, _ := environment.New(
			environment.WithName("FEATURE_DEBUG"),
			environment.WithDefaultValue("false"),
			environment.WithRequired(false),
			environment.WithDescription("Enable debug mode"),
		)
		featureCache, _ := environment.New(
			environment.WithName("FEATURE_CACHE"),
			environment.WithDefaultValue("true"),
			environment.WithRequired(false),
			environment.WithDescription("Enable caching"),
		)
		fmt.Println("✓ Feature flag variables:")
		fmt.Printf("  %s, %s\n\n", featureDebug, featureCache)

		fmt.Println("=== Key Concepts ===\n")
		fmt.Println("1. Secret vs Configuration:")
		fmt.Println("   - Secrets (is_secret=true): Encrypted at rest, redacted in logs")
		fmt.Println("   - Config (is_secret=false): Plaintext, visible in audit logs")
		fmt.Println()
		fmt.Println("2. Required vs Optional:")
		fmt.Println("   - Required: Must be provided at AgentInstance creation")
		fmt.Println("   - Optional: Can use default value if not provided")
		fmt.Println()
		fmt.Println("3. Default Values:")
		fmt.Println("   - Variables with defaults are automatically optional")
		fmt.Println("   - Useful for configuration with sensible defaults")
		fmt.Println()
		fmt.Println("4. Variable Names:")
		fmt.Println("   - Must be uppercase letters, numbers, and underscores")
		fmt.Println("   - Cannot start with a number")
		fmt.Println("   - Follow standard environment variable conventions")
		fmt.Println()
		fmt.Println("5. Integration:")
		fmt.Println("   - MCP servers can reference env vars via placeholders")
		fmt.Println("   - Agent templates declare requirements")
		fmt.Println("   - AgentInstance provides actual values")
		fmt.Println()

		fmt.Println("✓ Example completed successfully!")
		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
