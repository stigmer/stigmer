# Stigmer Go SDK

Go client library for the [Stigmer](https://stigmer.ai) platform API.

## Install

```bash
go get go.stigmer.ai/sdk
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    stigmer "go.stigmer.ai/sdk"
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
| `client.Agent`          | Agent           | Get, GetByReference, Create, Update, Apply, UpdateVisibility, Rename, Delete, TagVersion, List, ListAll, ListVersions, ListVersionsAll, GetVersion |
| `client.Skill`          | Skill           | Get, GetByReference, Push, CreateArtifactUploadUrl, PushFromRunArtifact, UpdateVisibility, Delete, List, ListAll, GetArtifact, GetArtifactDownloadUrl, ListVersions, ListVersionsAll |
| `client.Plugin`         | Plugin          | Get, GetByReference, Push, CreateArtifactUploadUrl, UpdateVisibility, Delete, ListTools, List, ListAll, GetArtifact, GetArtifactDownloadUrl, ListVersions, ListVersionsAll |
| `client.Session`        | Session         | Get, Create, Update, Apply, UpdateSubject, ReviewFileChanges, ConfirmToolUse, GrantPermission, Interrupt, Delete, AppendEvents, BindHarnessState, List, ListAll, ListByAgent, ListByAgentAll, ListByChannel, ListByChannelAll, ListEvents, StreamEvents |
| `client.Vault`          | Vault           | Get, GetByReference, GetMine, GetByExternalId, Create, Update, UpdateVisibility, Rename, Delete, List, ListAll, SetSecrets, RemoveSecrets, SetConnection, RemoveConnections, StartSignIn, CompleteSignIn, CreateConnectLink, GetConnectLink, StartConnectLink, CompleteConnectLink, FetchValues |
| `client.Run`            | Run             | Get, Create, Update, UpdateStatus, Delete, List, ListAll, ListBySession, ListBySessionAll, Pause, Resume, Terminate, Recover, UploadAttachment, GetArtifactDownloadUrl, GetArtifactContent, GetRunUsageReport, GetSessionUsageReport, GetAgentUsageReport, GetOrgUsageReport, GetRunSummary |
| `client.Search`         | Cross-resource  | Query |
| `client.Billing`        | Billing         | GetOrCreateBillingAccount, GetBillingAccount, CreateBillingPortalSession, CreatePaymentMethodSetupSession + operator pricing methods |

A rename changes the slug people type; the id stays, so everything that points
at the resource keeps working, and the old slug reads for 30 days. A list's
`Labels` returns only the resources carrying every label given.

```go
renamed, err := client.Agent.Rename(ctx, &apiresource.RenameInput{
    ResourceId: agent.GetMetadata().GetId(),
    Slug:       "support-bot",
})
if err != nil {
    log.Fatal(err)
}
fmt.Println(renamed.GetMetadata().GetSlug())

support, err := client.Agent.List(ctx, &agentv1.ListAgentsRequest{
    Org:    "my-org",
    Labels: map[string]string{"team": "support"},
})
if err != nil {
    log.Fatal(err)
}
fmt.Println(len(support.GetEntries()))
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
// API key authentication (default endpoint api.stigmer.ai:443)
client, _ := stigmer.NewClient(stigmer.WithAPIKey("sk_live_..."))

// Token authentication (from interactive login)
client, _ := stigmer.NewClient(stigmer.WithToken(loginToken))

// Custom endpoint
client, _ := stigmer.NewClient(stigmer.WithAPIKey("sk_live_..."), stigmer.WithBaseURL("localhost:9090"))

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

## Types

- **Input types** (`AgentInput`, `RunInput`, etc.) are SDK types that flatten proto construction.
- **Response types** are proto types directly (e.g., `*agentv1.Agent`). Access fields via generated getters.
- **Lists** return the native list response types: a page of `Entries` and a `NextPageToken` that is set while more follow. `PageSize` 0 asks for the default page of 50, and above 100 reads 100. Every list has an iterator beside it (`List` → `ListAll`, an `iter.Seq2` that follows the tokens), and `client.Search.QueryAll` does the same for search.

## Examples

See the `examples/` directory for complete usage patterns:
- `basic_crud.go` — Create, get, list, delete agents
- `streaming_run.go` — Create a run and follow its session's events
- `error_handling.go` — Handle SDK errors
- `search.go` — Cross-resource search
