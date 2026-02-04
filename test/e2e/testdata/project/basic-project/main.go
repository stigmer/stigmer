//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Basic project with a single agent for testing fresh project deployment.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a simple agent
		_, err := agent.New(ctx, "simple-agent", &agent.AgentArgs{
			Instructions: "You are a simple test agent for E2E testing.",
			Description:  "A simple agent for basic project deployment testing",
		})
		if err != nil {
			return err
		}

		log.Println("Created basic-project with 1 agent")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
