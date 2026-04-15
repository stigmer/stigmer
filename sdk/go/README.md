# Stigmer Go SDK

Go client library for the [Stigmer](https://stigmer.ai) platform API.

## Install

```bash
go get github.com/stigmer/stigmer/sdk/go
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    stigmer "github.com/stigmer/stigmer/sdk/go"
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

    // Run an execution
    exec, err := client.AgentExecution.Create(ctx, &stigmer.AgentExecutionInput{
        AgentId: agent.GetMetadata().GetId(),
        Message: "Hello, what can you help me with?",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Execution: %s\n", exec.GetMetadata().GetId())
}
```

## Resources

The client provides sub-clients for each resource type:

| Sub-client              | Resource        | Operations |
|-------------------------|-----------------|------------|
| `client.Agent`          | Agent           | Get, GetByReference, Create, Update, Apply, Delete, List |
| `client.Skill`          | Skill           | Get, GetByReference, Push, GetArtifact, Delete, List |
| `client.McpServer`      | MCP Server      | Get, GetByReference, Create, Update, Apply, Delete, List |
| `client.Session`        | Session         | Get, Create, Update, Apply, Delete, List, ListByAgent |
| `client.AgentExecution` | AgentExecution  | Get, Create, Subscribe, List, ListBySession, Cancel, Pause, Resume, Terminate, Recover, SubmitApproval, UploadAttachment, GetArtifactDownloadUrl |
| `client.Search`         | Cross-resource  | Query |

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

Subscribe to real-time execution updates:

```go
stream, err := client.AgentExecution.Subscribe(ctx, "execution-id")
for {
    exec, err := stream.Recv()
    if err == io.EOF {
        break
    }
    fmt.Println(exec.GetStatus().GetPhase())
}
```

## Types

- **Input types** (`AgentInput`, `AgentExecutionInput`, etc.) are SDK types that flatten proto construction.
- **Response types** are proto types directly (e.g., `*agentv1.Agent`). Access fields via generated getters.
- **Search/List results** use `*stigmer.ListResult` (for SearchService-backed lists) or the native list response types.

## Examples

See the `examples/` directory for complete usage patterns:
- `basic_crud.go` — Create, get, list, delete agents
- `streaming_execution.go` — Create and stream an execution
- `error_handling.go` — Handle SDK errors
- `search.go` — Cross-resource search
