# Stigmer Go SDK

Go client library for the [Stigmer](https://stigmer.ai) platform API.

## Install

```bash
go get github.com/stigmer/stigmer/sdk/go/v3
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    stigmer "github.com/stigmer/stigmer/sdk/go/v3"
)

func main() {
    client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_your_api_key"))
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    ctx := context.Background()

    // Create an agent
    agent, err := client.Agent.Create(ctx, &stigmer.AgentInput{
        Name:         "my-agent",
        Org:          "my-org",
        Instructions: "You are a helpful coding assistant.",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Created: %s\n", agent.GetMetadata().GetId())

    // Start a conversation on the agent: the server creates its session
    // and pins the agent's current version on it
    run, err := client.Run.Create(ctx, &stigmer.RunInput{
        SessionSpec: &stigmer.SessionSpecInput{
            AgentRef: stigmer.ResourceRef{
                Org:  agent.GetMetadata().GetOrg(),
                Slug: agent.GetMetadata().GetSlug(),
            },
        },
        Message: "Hello, what can you help me with?",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Run: %s\n", run.GetMetadata().GetId())
}
```

## Resources

The client provides sub-clients for each resource type:

| Sub-client              | Resource        | Operations |
|-------------------------|-----------------|------------|
| `client.Agent`          | Agent           | Get, GetByReference, Create, Update, Apply, Delete, List |
| `client.Skill`          | Skill           | Get, GetByReference, Push, GetArtifact, Delete, List |
| `client.Plugin`         | Plugin          | Get, GetByReference, Push, ListTools, GetArtifact, ListVersions, UpdateVisibility, Delete, List |
| `client.Session`        | Session         | Get, Create, Update, Apply, Delete, List, ListByAgent |
| `client.Vault`          | Vault           | Get, GetByReference, GetMine, GetByExternalId, Create, Update, UpdateVisibility, Delete, List, SetSecrets, RemoveSecrets, SetConnection, RemoveConnections, StartSignIn, CompleteSignIn, CreateConnectLink, GetConnectLink, StartConnectLink, CompleteConnectLink |
| `client.Run`            | Run             | Get, Create, Subscribe, List, ListBySession, Cancel, Pause, Resume, Terminate, Recover, SubmitApproval, UploadAttachment, GetArtifactDownloadUrl |
| `client.Search`         | Cross-resource  | Query |
| `client.Billing`        | Billing         | GetOrCreateBillingAccount, GetBillingAccount, GetCreditBalance, AdjustCredits, GetCreditLedger, GetBillingUsageReport, CreateCreditCheckoutSession, CreateBillingPortalSession, CreatePaymentMethodSetupSession, SetAutoRechargeConfig, GetCustomerModelPricing + operator pricing methods |

## Billing

Credit balance queries, ledger history, and manual credit adjustments for an
organization. Queries require `can_view_billing` on the org and the org's own
billing commands require `can_manage_billing`. Adding or removing credits
without a purchase (`AdjustCredits`, `GrantCredits`) requires
`can_manage_credits` on the platform, held by platform operators and by the
funding identities Stigmer makes credit issuers:

```go
balance, err := client.Billing.GetCreditBalance(ctx, org)

entry, err := client.Billing.AdjustCredits(ctx, &stigmer.AdjustCreditsParams{
    Org:            org,
    AmountMicros:   25_000_000, // +$25.00
    Reason:         "support credit for an outage",
    IdempotencyKey: "support-" + org + "-2026-09",
})
```

## Configuration

```go
// API key authentication (default endpoint api.stigmer.ai:443)
client, _ := stigmer.NewClient(stigmer.WithAPIKey("sk_live_..."))

// Token authentication (from interactive login)
client, _ := stigmer.NewClient(stigmer.WithToken(loginToken))

// Custom endpoint
client, _ := stigmer.NewClient(stigmer.WithAPIKey("sk_live_..."), stigmer.WithBaseURL("localhost:9090"))

// Local development (no TLS, no credentials required)
client, _ := stigmer.NewClient(stigmer.WithBaseURL("localhost:7234"), stigmer.WithInsecure())
```

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

Subscribe to real-time run updates:

```go
stream, err := client.Run.Subscribe(ctx, "run-id")
for {
    run, err := stream.Recv()
    if err == io.EOF {
        break
    }
    fmt.Println(run.GetStatus().GetPhase())
}
```

## Types

- **Input types** (`AgentInput`, `RunInput`, etc.) are SDK types that flatten proto construction.
- **Response types** are proto types directly (e.g., `*agentv1.Agent`). Access fields via generated getters.
- **Search/List results** use `*stigmer.ListResult` (for SearchService-backed lists) or the native list response types.

## Examples

See the `examples/` directory for complete usage patterns:
- `basic_crud.go` — Create, get, list, delete agents
- `streaming_run.go` — Create and stream a run
- `error_handling.go` — Handle SDK errors
- `search.go` — Cross-resource search
