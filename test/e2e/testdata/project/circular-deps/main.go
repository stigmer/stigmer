//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
)

// Circular deps project - attempts to create a circular dependency.
// Note: In the current SDK architecture, circular dependencies between
// agents are not directly representable since agents don't reference
// other agents at deployment time. This fixture creates agents that
// would form a logical circular reference if subagents were used.
//
// For testing purposes, this fixture is used to verify that the backend
// handles edge cases correctly.
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create two agents
		agentA, err := agent.New(ctx, "agent-a", &agent.AgentArgs{
			Instructions: "You are Agent A. You work with Agent B.",
			Description:  "Agent A - part of circular reference test",
		})
		if err != nil {
			return err
		}

		agentB, err := agent.New(ctx, "agent-b", &agent.AgentArgs{
			Instructions: "You are Agent B. You work with Agent A.",
			Description:  "Agent B - part of circular reference test",
		})
		if err != nil {
			return err
		}

		// Add each as subagent of the other (creates circular reference)
		agentA.AddSubAgents(agentB)
		agentB.AddSubAgents(agentA)

		log.Println("Created circular-deps-project with circular agent references")
		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
