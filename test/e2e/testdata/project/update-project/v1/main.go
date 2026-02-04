//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Update project v1 - initial version with original description.
// Used to test project updates by comparing against v2.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		_, err := agent.New(ctx, "updatable-agent", &agent.AgentArgs{
			Instructions: "You are an updatable agent for testing.",
			Description:  "Initial agent description",
		})
		if err != nil {
			return err
		}

		log.Println("Created update-project v1 with initial description")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
