// Example: Streaming an agent run.
//
// This shows how to start a conversation on an agent and subscribe to
// real-time updates. The new conversation names the agent by reference; the
// server creates its session and pins the agent's current version on it.
package examples

import (
	"context"
	"fmt"
	"io"
	"log"

	stigmer "github.com/stigmer/stigmer/sdk/go/v3"
)

func StreamingRun() {
	ctx := context.Background()

	client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_your_api_key"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	run, err := client.Run.Create(ctx, &stigmer.RunInput{
		SessionSpec: &stigmer.SessionSpecInput{
			AgentRef: stigmer.ResourceRef{Org: "my-org", Slug: "code-reviewer"},
		},
		Message: "Review the latest changes in the auth module",
		RunConfig: &stigmer.RunConfigInput{
			ModelName:     "claude-sonnet-4-6",
			MaxToolRounds: 25,
			MaxCostUsd:    2.00,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Created run: %s\n", run.GetMetadata().GetId())

	stream, err := client.Run.Subscribe(ctx, run.GetMetadata().GetId())
	if err != nil {
		log.Fatal(err)
	}

	for {
		update, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Fatal(err)
		}
		status := update.GetStatus()
		fmt.Printf("Phase: %s, Messages: %d\n",
			status.GetPhase(),
			len(status.GetMessages()),
		)
	}
}
