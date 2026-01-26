//go:build ignore

// Example 05: Agent with Environment Variables
//
// This example demonstrates how to define environment variables for agents.
// Environment variables can be configuration values or secrets that agents
// need at runtime.
//
// Key concepts:
//   - Secrets (IsSecret=true): Encrypted at rest, redacted in logs
//   - Config (IsSecret=false): Plaintext, visible in audit logs
//   - Required: Must be provided at AgentInstance creation
//   - Optional: Can use default value if not provided
//   - Variables with defaults are automatically optional
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
		fmt.Println("=== Example 05: Agent with Environment Variables ===\n")

		// =============================================================================
		// Example 1: Required Secret Variable
		// =============================================================================
		// Secrets are encrypted at rest and redacted in logs.
		// By default, variables are required.
		githubToken, err := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
			IsSecret:    true,
			Description: "GitHub personal access token with repo scope",
		})
		if err != nil {
			return fmt.Errorf("failed to create GITHUB_TOKEN: %w", err)
		}
		fmt.Printf("Created secret: %s\n", githubToken)

		// =============================================================================
		// Example 2: Optional Configuration with Default Value
		// =============================================================================
		// Variables with default values are automatically optional.
		// Configuration values are stored as plaintext.
		awsRegion, err := environment.New(ctx, "AWS_REGION", &environment.VariableArgs{
			DefaultValue: "us-east-1",
			Description:  "AWS region for resource deployment",
		})
		if err != nil {
			return fmt.Errorf("failed to create AWS_REGION: %w", err)
		}
		fmt.Printf("Created config with default: %s\n", awsRegion)

		// =============================================================================
		// Example 3: Optional Configuration (no default)
		// =============================================================================
		// To make a variable optional without a default, set Required to false.
		optionalFalse := false
		logLevel, err := environment.New(ctx, "LOG_LEVEL", &environment.VariableArgs{
			Required:    &optionalFalse,
			Description: "Logging level (debug, info, warn, error)",
		})
		if err != nil {
			return fmt.Errorf("failed to create LOG_LEVEL: %w", err)
		}
		fmt.Printf("Created optional config: %s\n", logLevel)

		// =============================================================================
		// Example 4: Multiple Secrets for Different Services
		// =============================================================================
		slackToken, err := environment.New(ctx, "SLACK_BOT_TOKEN", &environment.VariableArgs{
			IsSecret:    true,
			Description: "Slack bot token for team communication",
		})
		if err != nil {
			return fmt.Errorf("failed to create SLACK_BOT_TOKEN: %w", err)
		}

		openaiKey, err := environment.New(ctx, "OPENAI_API_KEY", &environment.VariableArgs{
			IsSecret:    true,
			Description: "OpenAI API key for embeddings",
		})
		if err != nil {
			return fmt.Errorf("failed to create OPENAI_API_KEY: %w", err)
		}
		fmt.Printf("Created multiple secrets: %s, %s\n\n", slackToken, openaiKey)

		// =============================================================================
		// Example 5: Agent with Environment Variables
		// =============================================================================
		fmt.Println("=== Creating Agent with Environment Variables ===\n")

		// Create MCP server that uses environment variables via placeholders
		githubMCP, err := mcpserver.Stdio(ctx, "github", &mcpserver.StdioArgs{
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-github"},
			EnvPlaceholders: map[string]string{
				"GITHUB_TOKEN": "${GITHUB_TOKEN}",
			},
		})
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
		// Note: AddEnvironmentVariables takes values, so dereference the pointers
		deployAgent.AddMCPServer(githubMCP)
		deployAgent.AddEnvironmentVariables(
			*githubToken,
			*awsRegion,
			*logLevel,
			*slackToken,
			*openaiKey,
		)

		fmt.Printf("Created agent: %s\n", deployAgent.Name)
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

		// =============================================================================
		// Example 6: Validation Examples
		// =============================================================================
		fmt.Println("=== Validation Examples ===\n")

		// Invalid name (lowercase) - should be rejected
		_, err = environment.New(ctx, "github_token", nil) // Should be uppercase
		if err != nil {
			fmt.Printf("Correctly rejected invalid name: %v\n", err)
		}

		// Invalid name (starts with number) - should be rejected
		_, err = environment.New(ctx, "2FA_TOKEN", nil)
		if err != nil {
			fmt.Printf("Correctly rejected name starting with number: %v\n", err)
		}

		// Invalid name (special characters) - should be rejected
		_, err = environment.New(ctx, "API-KEY", nil)
		if err != nil {
			fmt.Printf("Correctly rejected name with hyphens: %v\n", err)
		}

		// Empty name - should be rejected
		_, err = environment.New(ctx, "", &environment.VariableArgs{IsSecret: true})
		if err != nil {
			fmt.Printf("Correctly rejected empty name: %v\n\n", err)
		}

		// =============================================================================
		// Example 7: Common Use Cases
		// =============================================================================
		fmt.Println("=== Common Use Cases ===\n")

		// Use Case 1: Database Connection
		dbHost, _ := environment.New(ctx, "DB_HOST", &environment.VariableArgs{
			DefaultValue: "localhost",
			Description:  "Database host address",
		})
		dbPort, _ := environment.New(ctx, "DB_PORT", &environment.VariableArgs{
			DefaultValue: "5432",
			Description:  "Database port",
		})
		dbPassword, _ := environment.New(ctx, "DB_PASSWORD", &environment.VariableArgs{
			IsSecret:    true,
			Description: "Database password",
		})
		fmt.Println("Database connection variables:")
		fmt.Printf("  %s, %s, %s\n\n", dbHost, dbPort, dbPassword)

		// Use Case 2: API Integration
		apiEndpoint, _ := environment.New(ctx, "API_ENDPOINT", &environment.VariableArgs{
			DefaultValue: "https://api.example.com",
			Description:  "External API endpoint URL",
		})
		apiKey, _ := environment.New(ctx, "API_KEY", &environment.VariableArgs{
			IsSecret:    true,
			Description: "API authentication key",
		})
		apiTimeout, _ := environment.New(ctx, "API_TIMEOUT", &environment.VariableArgs{
			DefaultValue: "30",
			Description:  "API request timeout in seconds",
		})
		fmt.Println("API integration variables:")
		fmt.Printf("  %s, %s, %s\n\n", apiEndpoint, apiKey, apiTimeout)

		// Use Case 3: Feature Flags
		featureDebug, _ := environment.New(ctx, "FEATURE_DEBUG", &environment.VariableArgs{
			DefaultValue: "false",
			Description:  "Enable debug mode",
		})
		featureCache, _ := environment.New(ctx, "FEATURE_CACHE", &environment.VariableArgs{
			DefaultValue: "true",
			Description:  "Enable caching",
		})
		fmt.Println("Feature flag variables:")
		fmt.Printf("  %s, %s\n\n", featureDebug, featureCache)

		// =============================================================================
		// Key Concepts Summary
		// =============================================================================
		fmt.Println("=== Key Concepts ===\n")
		fmt.Println("1. Secret vs Configuration:")
		fmt.Println("   - Secrets (IsSecret=true): Encrypted at rest, redacted in logs")
		fmt.Println("   - Config (IsSecret=false): Plaintext, visible in audit logs")
		fmt.Println()
		fmt.Println("2. Required vs Optional:")
		fmt.Println("   - Required (default): Must be provided at AgentInstance creation")
		fmt.Println("   - Optional: Set Required=&false or provide DefaultValue")
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
		fmt.Println("   - MCP servers reference env vars via placeholders: ${VAR_NAME}")
		fmt.Println("   - Agent templates declare variable requirements")
		fmt.Println("   - AgentInstance provides actual values at runtime")

		fmt.Println("\nExample completed successfully!")
		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
