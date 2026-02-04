//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Orphan project v1 - has 3 agents.
// Used to test orphan pruning: v2 removes one agent which becomes an orphan.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		_, err := agent.New(ctx, "keeper-agent-1", &agent.AgentArgs{
			Instructions: "You are keeper agent 1.",
			Description:  "First keeper agent that persists across versions",
		})
		if err != nil {
			return err
		}

		_, err = agent.New(ctx, "keeper-agent-2", &agent.AgentArgs{
			Instructions: "You are keeper agent 2.",
			Description:  "Second keeper agent that persists across versions",
		})
		if err != nil {
			return err
		}

		// This agent will be removed in v2, becoming an orphan
		_, err = agent.New(ctx, "orphan-agent", &agent.AgentArgs{
			Instructions: "You are the orphan agent that will be removed in v2.",
			Description:  "Agent that will become orphaned in v2",
		})
		if err != nil {
			return err
		}

		log.Println("Created orphan-project v1 with 3 agents (including orphan-agent)")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
