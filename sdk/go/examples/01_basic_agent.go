//go:build ignore

// Example 01: Basic Agent
//
// This example demonstrates creating a simple agent with just the required fields.
// Uses struct-based args (Pulumi pattern) - clean and discoverable!
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		fmt.Println("=== Basic Agent Example ===\n")

		// Create a basic agent with required fields only
		// Pulumi-style API: name as parameter, struct args for configuration
		// Clean single-package import - no gen package needed!
		basicAgent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
			Instructions: "Review code and suggest improvements based on best practices",
		})
		if err != nil {
			return fmt.Errorf("failed to create basic agent: %w", err)
		}

		fmt.Println("✅ Created basic agent:")
		fmt.Printf("   Name: %s\n", basicAgent.Name)
		fmt.Printf("   Instructions: %s\n", basicAgent.Instructions)

		// Create an agent with optional fields
		fullAgent, err := agent.New(ctx, "code-reviewer-pro", &agent.AgentArgs{
			Instructions: "Review code and suggest improvements based on best practices and security considerations",
			Description:  "Professional code reviewer with security focus",
			IconUrl:      "https://example.com/icons/code-reviewer.png",
		})
		if err != nil {
			return fmt.Errorf("failed to create full agent: %w", err)
		}

		fmt.Println("\n✅ Created full agent:")
		fmt.Printf("   Name: %s\n", fullAgent.Name)
		fmt.Printf("   Instructions: %s\n", fullAgent.Instructions)
		fmt.Printf("   Description: %s\n", fullAgent.Description)
		fmt.Printf("   IconURL: %s\n", fullAgent.IconURL)

		// Example of validation error
		fmt.Println("\n❌ Attempting to create invalid agent:")
		_, err = agent.New(ctx, "Invalid Name!", &agent.AgentArgs{
			Instructions: "Test",
		})
		if err != nil {
			fmt.Printf("   Error: %v\n", err)
		}

		fmt.Println("\n✅ Example completed successfully!")
		fmt.Println("\nNote: Agents are automatically synthesized when stigmer.Run() completes.")

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to run example: %v", err)
	}
}
