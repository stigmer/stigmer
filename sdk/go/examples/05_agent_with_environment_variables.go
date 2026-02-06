//go:build ignore

// Example 05: Agent with Environment Variables
//
// This example demonstrates how to declare environment requirements for agents
// using the RequireSecret and RequireConfig builder methods.
//
// Key concepts:
//   - RequireSecret: Declares a required secret (encrypted at rest, redacted in logs)
//   - RequireConfig: Declares a config variable with optional default value
//   - EnvSpec: All environment requirements are stored in Args.EnvSpec
//   - Runtime Resolution: Values are provided at AgentInstance creation time
//
// The old environment.VariableArgs pattern has been replaced with cleaner
// builder methods that directly modify the agent's EnvSpec.
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Example 05: Agent with Environment Variables ===\n")

		// =============================================================================
		// Creating an Agent with Environment Requirements
		// =============================================================================
		// Environment requirements are declared using builder methods on the agent.
		// This is cleaner than the old pattern of creating separate VariableArgs.

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

		// =============================================================================
		// Declaring Secret Requirements
		// =============================================================================
		// Secrets are encrypted at rest and redacted in logs.
		// Use RequireSecret for API keys, tokens, and passwords.
		// These MUST be provided at AgentInstance creation time.

		deployAgent.
			RequireSecret("GITHUB_TOKEN", "GitHub personal access token with repo scope").
			RequireSecret("SLACK_BOT_TOKEN", "Slack bot token for team communication").
			RequireSecret("OPENAI_API_KEY", "OpenAI API key for intelligent suggestions")

		fmt.Println("✓ Declared required secrets: GITHUB_TOKEN, SLACK_BOT_TOKEN, OPENAI_API_KEY")

		// =============================================================================
		// Declaring Config Requirements with Defaults
		// =============================================================================
		// Config values are non-secret environment variables.
		// If a default value is provided, the variable becomes optional.
		// If default is empty string, the variable is required at runtime.

		deployAgent.
			RequireConfig("AWS_REGION", "us-east-1", "AWS region for resource deployment").
			RequireConfig("LOG_LEVEL", "info", "Logging level (debug, info, warn, error)").
			RequireConfig("DEPLOYMENT_TIMEOUT", "300", "Deployment timeout in seconds")

		fmt.Println("✓ Declared config with defaults: AWS_REGION, LOG_LEVEL, DEPLOYMENT_TIMEOUT")

		// =============================================================================
		// Declaring Required Config (no default)
		// =============================================================================
		// Pass empty string as default to make a config variable required.

		deployAgent.
			RequireConfig("TARGET_ENVIRONMENT", "", "Target deployment environment (staging/production)")

		fmt.Println("✓ Declared required config: TARGET_ENVIRONMENT")

		// =============================================================================
		// Adding MCP Server Reference
		// =============================================================================
		// MCP servers are referenced using org/slug format.

		deployAgent.UseMCP("stigmer/github", "create_pr", "search_code", "list_repos")

		fmt.Println("✓ Added MCP server usage: stigmer/github")

		// =============================================================================
		// Display Agent Configuration
		// =============================================================================
		fmt.Println("\n=== Agent Configuration Summary ===\n")
		fmt.Printf("Agent: %s\n", deployAgent.Name)
		fmt.Printf("  - Instructions: %d characters\n", len(deployAgent.Args.Instructions))
		fmt.Printf("  - MCP Server Usages: %d\n", len(deployAgent.Args.McpServerUsages))

		// Display environment spec
		if deployAgent.Args.EnvSpec != nil && len(deployAgent.Args.EnvSpec.Data) > 0 {
			fmt.Printf("  - Environment Variables: %d\n\n", len(deployAgent.Args.EnvSpec.Data))

			fmt.Println("=== Environment Requirements ===\n")
			for name, value := range deployAgent.Args.EnvSpec.Data {
				fmt.Printf("%s:\n", name)
				fmt.Printf("   - Secret: %v\n", value.IsSecret)
				if value.Value != "" {
					fmt.Printf("   - Default: %s\n", value.Value)
				} else {
					fmt.Printf("   - Required: yes (no default)\n")
				}
				if value.Description != "" {
					fmt.Printf("   - Description: %s\n", value.Description)
				}
				fmt.Println()
			}
		}

		// =============================================================================
		// Common Use Cases
		// =============================================================================
		fmt.Println("=== Common Use Cases ===\n")

		// Use Case 1: Database Agent
		dbAgent, err := agent.New(ctx, "database-manager", &agent.AgentArgs{
			Instructions: "Manage database operations including queries, migrations, and backups.",
			Description:  "Database management agent",
		})
		if err != nil {
			return err
		}

		dbAgent.
			RequireConfig("DB_HOST", "localhost", "Database host address").
			RequireConfig("DB_PORT", "5432", "Database port").
			RequireConfig("DB_NAME", "", "Database name (required)").
			RequireSecret("DB_PASSWORD", "Database password")

		fmt.Println("Database Agent:")
		fmt.Printf("  - Config: DB_HOST (default: localhost), DB_PORT (default: 5432), DB_NAME (required)\n")
		fmt.Printf("  - Secrets: DB_PASSWORD\n\n")

		// Use Case 2: API Integration Agent
		apiAgent, err := agent.New(ctx, "api-integrator", &agent.AgentArgs{
			Instructions: "Integrate with external APIs and handle data transformation.",
			Description:  "External API integration agent",
		})
		if err != nil {
			return err
		}

		apiAgent.
			RequireConfig("API_ENDPOINT", "https://api.example.com", "External API endpoint URL").
			RequireConfig("API_TIMEOUT", "30", "API request timeout in seconds").
			RequireSecret("API_KEY", "API authentication key")

		fmt.Println("API Integration Agent:")
		fmt.Printf("  - Config: API_ENDPOINT, API_TIMEOUT (with defaults)\n")
		fmt.Printf("  - Secrets: API_KEY\n\n")

		// Use Case 3: Feature Flag Agent
		featureAgent, err := agent.New(ctx, "feature-manager", &agent.AgentArgs{
			Instructions: "Manage feature flags and A/B testing configurations.",
			Description:  "Feature flag management agent",
		})
		if err != nil {
			return err
		}

		featureAgent.
			RequireConfig("FEATURE_DEBUG", "false", "Enable debug mode").
			RequireConfig("FEATURE_CACHE", "true", "Enable caching").
			RequireConfig("CACHE_TTL", "3600", "Cache TTL in seconds")

		fmt.Println("Feature Flag Agent:")
		fmt.Printf("  - Config: FEATURE_DEBUG, FEATURE_CACHE, CACHE_TTL (all with defaults)\n")
		fmt.Printf("  - Secrets: none\n\n")

		// =============================================================================
		// Key Concepts Summary
		// =============================================================================
		fmt.Println("=== Key Concepts ===\n")
		fmt.Println("1. RequireSecret(name, description):")
		fmt.Println("   - For sensitive data (API keys, tokens, passwords)")
		fmt.Println("   - Encrypted at rest, redacted in logs")
		fmt.Println("   - Always required at runtime")
		fmt.Println()
		fmt.Println("2. RequireConfig(name, defaultValue, description):")
		fmt.Println("   - For non-sensitive configuration")
		fmt.Println("   - With default: optional at runtime")
		fmt.Println("   - Empty default: required at runtime")
		fmt.Println()
		fmt.Println("3. Builder Method Pattern:")
		fmt.Println("   - Methods return *Agent for fluent chaining")
		fmt.Println("   - All requirements stored in Args.EnvSpec")
		fmt.Println("   - Thread-safe for concurrent modification")
		fmt.Println()
		fmt.Println("4. Runtime Resolution:")
		fmt.Println("   - Values provided at AgentInstance creation")
		fmt.Println("   - Secrets resolved just-in-time during execution")
		fmt.Println("   - Never appear in manifests or logs")

		fmt.Println("\n✅ Example completed successfully!")
		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
