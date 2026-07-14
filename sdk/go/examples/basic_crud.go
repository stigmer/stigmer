// Example: Basic CRUD operations with the Stigmer Go SDK.
//
// This example demonstrates creating, getting, listing, and deleting agents.
// It is not a runnable program — it shows the API patterns.
package examples

import (
	"context"
	"fmt"
	"log"

	stigmer "github.com/stigmer/stigmer/sdk/go/v3"
)

func BasicCRUD() {
	ctx := context.Background()

	client, err := stigmer.NewClient(
		stigmer.WithAPIKey("sk_live_your_api_key"),
		stigmer.WithBaseURL("api.stigmer.ai:443"),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	// Create an agent
	agent, err := client.Agent.Create(ctx, &stigmer.AgentInput{
		Name:         "code-reviewer",
		Org:          "acme",
		Instructions: "You are a senior code reviewer. Analyze code for bugs and style issues.",
		McpServerUsages: []*stigmer.McpServerUsageInput{
			{
				McpServerRef: stigmer.ResourceRef{Org: "acme", Slug: "github"},
				EnabledTools: []string{"get_file_contents", "create_pull_request_review"},
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Created agent: %s (ID: %s)\n", agent.GetMetadata().GetName(), agent.GetMetadata().GetId())

	// Get by ID
	agent, err = client.Agent.Get(ctx, agent.GetMetadata().GetId())
	if err != nil {
		log.Fatal(err)
	}

	// Get by reference (org + slug)
	agent, err = client.Agent.GetByReference(ctx, stigmer.ResourceRef{
		Org:  "acme",
		Slug: "code-reviewer",
	})
	if err != nil && !stigmer.IsNotFound(err) {
		log.Fatal(err)
	}

	// List agents in org
	result, err := client.Agent.List(ctx, &stigmer.ListParams{
		Org:  "acme",
		Page: &stigmer.Page{Num: 1, Size: 20},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Found %d agents\n", result.TotalCount)
	for _, entry := range result.Entries {
		fmt.Printf("  - %s (%s)\n", entry.GetName(), entry.GetQualifiedSlug())
	}

	// Delete
	_, err = client.Agent.Delete(ctx, agent.GetMetadata().GetId())
	if err != nil {
		log.Fatal(err)
	}
}
