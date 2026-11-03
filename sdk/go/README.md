# Stigmer Go SDK

Go client for [Stigmer](https://stigmer.ai), the open-source backend for the agents in your product.

## Install

```bash
go get go.stigmer.ai/sdk
```

## Quick Start

Before you start, run Stigmer on your machine with `stigmer up` and give it a model key ([Start Stigmer and add your model key](https://stigmer.ai/docs/getting-started/quickstart#start-stigmer-and-add-your-model-key)). Without a key the server refuses the message, and the program prints why.

This program connects to that Stigmer, sets up a small agent, asks it one thing and prints its answer:

```go
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
```

It is `examples/quickstart/main.go`. In a new folder, run `go mod init quickstart`, `go get go.stigmer.ai/sdk` and `go run .`; it prints the agent's answer, for example "Hello, and welcome to Stigmer!".

`SendAndWait` sends the message and waits for the agent's answer, reconnecting if the stream drops. A turn that waits for a person's approval returns with `Phase` `waiting` and its `Asks`; answer them with `client.Session.ConfirmToolUse` and call `client.WaitForTurn` with the outcome's `LastSeq`.

### On Stigmer Cloud

Make two changes: connect with an API key, `stigmer.NewClient(stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")))` (keys read `stk_…`), and use your own organization, `os.Getenv("STIGMER_ORG")`, where the program says `"stigmer"`.

## Resources

The client provides sub-clients for each resource type:

| Sub-client              | Resource        | Operations |
|-------------------------|-----------------|------------|
| `client.Agent`          | Agent           | Get, GetByReference, Create, Update, Apply, UpdateVisibility, Rename, Delete, TagVersion, List, ListAll, ListVersions, ListVersionsAll, GetVersion |
| `client.Skill`          | Skill           | Get, GetByReference, Push, CreateArtifactUploadUrl, PushFromFile, UpdateVisibility, Delete, List, ListAll, GetArtifact, GetArtifactDownloadUrl, ListVersions, ListVersionsAll |
| `client.Plugin`         | Plugin          | Get, GetByReference, Push, CreateArtifactUploadUrl, UpdateVisibility, Delete, ListTools, List, ListAll, GetArtifact, GetArtifactDownloadUrl, ListVersions, ListVersionsAll |
| `client.Session`        | Session         | Get, Create, Update, Apply, UpdateSubject, ReviewFileChanges, ConfirmToolUse, GrantPermission, Interrupt, Delete, List, ListAll, ListByAgent, ListByAgentAll, ListByChannel, ListByChannelAll, ListEvents, StreamEvents |
| `client.Vault`          | Vault           | Get, GetByReference, GetMine, GetByExternalId, Create, Update, UpdateVisibility, Rename, Delete, List, ListAll, SetSecrets, RemoveSecrets, SetConnection, RemoveConnections, StartSignIn, CompleteSignIn, CreateConnectLink, GetConnectLink, StartConnectLink, CompleteConnectLink |
| `client.Run`            | Run             | Get, Create, Update, UpdateStatus, Delete, List, ListAll, ListBySession, ListBySessionAll, Pause, Resume, Terminate, Recover, GetArtifactDownloadUrl, GetArtifactContent, GetRunUsageReport, GetSessionUsageReport, GetAgentUsageReport, GetOrgUsageReport, GetRunSummary |
| `client.Search`         | Cross-resource  | Query |
| `client.Billing`        | Billing         | GetOrCreateBillingAccount, GetBillingAccount, CreateBillingPortalSession, CreatePaymentMethodSetupSession + operator pricing methods |

A rename changes the slug people type; the id stays, so everything that points
at the resource keeps working, and the old slug reads for 30 days. A list's
`Labels` returns only the resources carrying every label given.

```go
renamed, err := client.Agent.Rename(ctx, &apiresource.RenameInput{
    ResourceId: agent.GetMetadata().GetId(),
    Slug:       "variance-reporter",
})
if err != nil {
    log.Fatal(err)
}
fmt.Println(renamed.GetMetadata().GetSlug())

finance, err := client.Agent.List(ctx, &agentv1.ListAgentsRequest{
    Org:    "my-org",
    Labels: map[string]string{"team": "finance"},
})
if err != nil {
    log.Fatal(err)
}
fmt.Println(len(finance.GetEntries()))
```

`apiresource` is
`go.stigmer.ai/sdk/proto/ai/stigmer/commons/apiresource` and
`agentv1` is `go.stigmer.ai/sdk/proto/ai/stigmer/agentic/agent/v1`.

## Billing

An organization's billing account (its Stripe customer), the Stripe portal
and card setup sessions. Token usage is read from the run client's usage
reports (`GetRunUsageReport`, `GetSessionUsageReport`, `GetAgentUsageReport`,
`GetOrgUsageReport`), counted in tokens and never priced. Queries require
`can_view_billing` on the org and the org's own billing commands require
`can_manage_billing`. The operator pricing methods
(`ListModelPricingBaselines`, `UpsertModelPricingBaseline`,
`RetireModelPricingBaseline`) require `can_manage_model_pricing` on the
platform:

```go
account, err := client.Billing.GetBillingAccount(ctx, org)

setup, err := client.Billing.CreatePaymentMethodSetupSession(ctx, &stigmer.CreatePaymentMethodSetupSessionParams{
    Org:        org,
    SuccessURL: "https://example.com/billing?setup=success",
    CancelURL:  "https://example.com/billing",
})
```

## Configuration

```go
// API key authentication (default endpoint api.stigmer.ai:443); keys read "stk_…"
client, _ := stigmer.NewClient(stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")))

// Token authentication (from interactive login)
client, _ := stigmer.NewClient(stigmer.WithToken(loginToken))

// Custom endpoint
client, _ := stigmer.NewClient(stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")), stigmer.WithBaseURL("stigmer.example.com:443"))

// Local development (no TLS, no credentials required)
client, _ := stigmer.NewClient(stigmer.WithBaseURL("localhost:7234"), stigmer.WithInsecure())
```

For a CI job or a script, use a [service account's](https://stigmer.ai/docs/guides/authentication/service-accounts) API key, not a person's: it keeps working when that person leaves and works only in its own organization.

## Error Handling

All methods return `*stigmer.Error` for API errors, wrapping gRPC status codes:

```go
agent, err := client.Agent.Get(ctx, "id")
if stigmer.IsNotFound(err) {
    // handle not found
}
if stigmer.IsPermissionDenied(err) {
    // handle access denied
}
```

## Streaming

A session's output is one ordered log of Claude Managed Agents events. Follow it
from the start (`AfterSeq` 0: every stored event, then each new one):

```go
stream, err := client.Session.StreamEvents(ctx, &sessionv1.StreamSessionEventsRequest{
    SessionId: "ses-id",
    AfterSeq:  proto.Int64(0),
})
for {
    frame, err := stream.Recv()
    if err != nil {
        break
    }
    if status := frame.GetEvent().GetStigmerRunStatus(); status != nil {
        fmt.Println(frame.GetEvent().GetRunId(), status.GetPhase())
    }
}
```

`sessionv1` is `go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1`.
Answer a tool use that waits for approval with `client.Session.ConfirmToolUse`.
To send a message and wait for the answer in one call, use `client.SendAndWait`.

## Types

- **Input types** (`AgentInput`, `RunInput`, etc.) are SDK types that flatten proto construction.
- **Response types** are proto types directly (e.g., `*agentv1.Agent`). Access fields via generated getters.
- **Lists** return the native list response types: a page of `Entries` and a `NextPageToken` that is set while more follow. `PageSize` 0 asks for the default page of 50, and above 100 reads 100. Every list has an iterator beside it (`List` → `ListAll`, an `iter.Seq2` that follows the tokens), and `client.Search.QueryAll` does the same for search.

## Examples

See the `examples/` directory for complete usage patterns:
- `quickstart/` — The quick start above: send a message and print the agent's answer
- `basic_crud.go` — Create, get, list, delete agents
- `streaming_run.go` — Create a run and follow its session's events
- `error_handling.go` — Handle SDK errors
- `search.go` — Cross-resource search
