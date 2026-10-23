// Example: Basic CRUD operations with the Stigmer Go SDK.
//
// This example demonstrates creating, getting, listing, and deleting agents.
// It is not a runnable program — it shows the API patterns.
package examples

import (
	"context"
	"fmt"
	"log"

	stigmer "go.stigmer.ai/sdk"
	agentv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/agent/v1"
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
		Name:         "variance-reporter",
		Org:          "acme",
		Instructions: "You review a customer's quarterly ledger and report how each account did against its budget.",
		// The installed ledger plugin, whole: its skills, agents, hooks and
		// MCP servers.
		Plugins: []stigmer.ResourceRef{{Org: "acme", Slug: "ledger"}},
		// Claude Code's tool-list names: this agent reads the ledger and
		// proposes adjustments, and never runs shell commands. A plugin's
		// server is named plugin_<plugin>_<server>.
		Tools:           []string{"Read", "Grep", "Glob", "mcp__plugin_ledger_ledger__get_ledger", "mcp__plugin_ledger_ledger__post_adjustment"},
		DisallowedTools: []string{"Bash"},
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
		Slug: "variance-reporter",
	})
	if err != nil && !stigmer.IsNotFound(err) {
		log.Fatal(err)
	}

	// List the org's agents, 20 to a page: a page carries a token while
	// more follow.
	page, err := client.Agent.List(ctx, &agentv1.ListAgentsRequest{Org: "acme", PageSize: 20})
	if err != nil {
		log.Fatal(err)
	}
	for _, a := range page.GetEntries() {
		fmt.Printf("  - %s\n", a.GetMetadata().GetSlug())
	}

	// Every agent, page after page: ListAll follows the page tokens.
	for a, err := range client.Agent.ListAll(ctx, &agentv1.ListAgentsRequest{Org: "acme"}) {
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("  - %s\n", a.GetMetadata().GetSlug())
	}

	// Delete
	_, err = client.Agent.Delete(ctx, agent.GetMetadata().GetId())
	if err != nil {
		log.Fatal(err)
	}
}
