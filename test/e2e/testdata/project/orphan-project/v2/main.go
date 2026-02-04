//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Orphan project v2 - has 2 agents (orphan-agent removed).
// The orphan-agent from v1 is not in v2, so it becomes an orphan and should be pruned.
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

		// Note: orphan-agent is NOT created in v2
		// This means it will be detected as an orphan and pruned

		log.Println("Created orphan-project v2 with 2 agents (orphan-agent removed)")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
