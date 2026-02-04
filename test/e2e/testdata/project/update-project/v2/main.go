//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Update project v2 - updated version with modified description.
// The agent description is changed to trigger an update during reconciliation.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		_, err := agent.New(ctx, "updatable-agent", &agent.AgentArgs{
			Instructions: "You are an updatable agent for testing with enhanced capabilities.",
			Description:  "Updated agent description with new features",
		})
		if err != nil {
			return err
		}

		log.Println("Created update-project v2 with updated description")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
