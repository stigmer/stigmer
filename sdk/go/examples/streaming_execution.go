// Example: Streaming an agent execution.
//
// This shows how to create an execution and subscribe to real-time updates.
package examples

import (
	"context"
	"fmt"
	"io"
	"log"

	stigmer "github.com/stigmer/stigmer/sdk/go/v3"
)

func StreamingExecution() {
	ctx := context.Background()

	client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_your_api_key"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	exec, err := client.AgentExecution.Create(ctx, &stigmer.AgentExecutionInput{
		AgentId: "agent-id",
		Message: "Review the latest changes in the auth module",
		ExecutionConfig: &stigmer.ExecutionConfigInput{
			ModelName:     "claude-sonnet-4-6",
			MaxToolRounds: 25,
			MaxCostUsd:    2.00,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Created execution: %s\n", exec.GetMetadata().GetId())

	stream, err := client.AgentExecution.Subscribe(ctx, exec.GetMetadata().GetId())
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
