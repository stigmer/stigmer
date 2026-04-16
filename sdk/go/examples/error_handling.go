// Example: Error handling patterns.
package examples

import (
	"context"
	"errors"
	"fmt"
	"log"

	stigmer "github.com/stigmer/stigmer/sdk/go"
)

func ErrorHandling() {
	ctx := context.Background()
	client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_your_api_key"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	agent, err := client.Agent.Get(ctx, "nonexistent-id")
	if err != nil {
		if stigmer.IsNotFound(err) {
			fmt.Println("Agent not found — creating a new one")
		} else if stigmer.IsUnauthenticated(err) {
			fmt.Println("Invalid API key")
		} else if stigmer.IsPermissionDenied(err) {
			fmt.Println("No access to this agent")
		} else {
			var sErr *stigmer.Error
			if errors.As(err, &sErr) {
				fmt.Printf("SDK error: code=%d grpc=%v msg=%s\n",
					sErr.Code, sErr.GRPCCode, sErr.Message)
			} else {
				fmt.Printf("Unexpected error: %v\n", err)
			}
		}
		return
	}

	fmt.Printf("Agent: %s\n", agent.GetMetadata().GetName())
}
