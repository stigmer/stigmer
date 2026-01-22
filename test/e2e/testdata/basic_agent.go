//go:build ignore

// Test fixture for E2E testing
// This is a minimal agent definition used to test the apply workflow
package main

import (
	"fmt"
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a basic test agent
		_, err := agent.New(ctx,
			agent.WithName("test-agent"),
			agent.WithInstructions("You are a test agent used for E2E testing"),
			agent.WithDescription("Test agent for integration testing"),
		)
		if err != nil {
			return fmt.Errorf("failed to create test agent: %w", err)
		}

		return nil
	})

	if err != nil {
		log.Fatalf("Failed to synthesize agent: %v", err)
	}
}
