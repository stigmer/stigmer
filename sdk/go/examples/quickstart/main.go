// The Stigmer quick start: connect to the Stigmer running on this machine,
// set up a small agent, ask it one thing and print its answer.
//
// Start Stigmer first with `stigmer up` (given a model key), then: go run .
package main

import (
	"context"
	"fmt"
	"log"

	stigmer "go.stigmer.ai/sdk"
)

func main() {
	log.SetFlags(0)

	// `stigmer up` serves on localhost:7234 and needs no key on your machine.
	client, err := stigmer.NewClient(stigmer.WithBaseURL("localhost:7234"), stigmer.WithInsecure())
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()
	ctx := context.Background()

	// Apply creates the agent, or updates it when you run this again.
	agent, err := client.Agent.Apply(ctx, &stigmer.AgentInput{
		Name:         "greeter",
		Org:          "stigmer",
		Instructions: "You greet people in one short, friendly sentence.",
	})
	if err != nil {
		log.Fatal(err)
	}

	turn, err := client.SendAndWait(ctx, &stigmer.RunInput{
		Org:         "stigmer",
		SessionSpec: &stigmer.SessionSpecInput{AgentRef: stigmer.ResourceRef{Org: "stigmer", Slug: agent.GetMetadata().GetSlug()}},
		Message:     "Say hello to a developer trying Stigmer for the first time.",
	})
	if err != nil {
		log.Fatal(err)
	}
	if turn.Phase != "completed" {
		log.Fatalf("the turn did not complete (%s): %s", turn.Phase, turn.Error)
	}
	fmt.Println(turn.Answer)
}
