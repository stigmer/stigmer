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
    client, err := stigmer.NewClient("sk_live_your_api_key")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    ctx := context.Background()

    // Create an agent
    agent, err := client.Agents.Create(ctx, &stigmer.CreateAgentInput{
        Name:         "my-agent",
        Org:          "my-org",
        Instructions: "You are a helpful coding assistant.",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Created: %s\n", agent.GetMetadata().GetId())

    // Run an execution
    exec, err := client.Executions.Create(ctx, &stigmer.CreateExecutionInput{
        AgentID: agent.GetMetadata().GetId(),
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

| Sub-client         | Resource        | Operations |
|--------------------|-----------------|------------|
| `client.Agents`    | Agent           | Get, GetByReference, Create, Update, Apply, Delete, List |
| `client.Skills`    | Skill           | Get, GetByReference, Push, GetArtifact, Delete, List |
| `client.McpServers`| MCP Server      | Get, GetByReference, Create, Update, Apply, Delete, List |
| `client.Sessions`  | Session         | Get, Create, Update, Apply, Delete, List, ListByAgent |
| `client.Executions`| AgentExecution  | Get, Create, Subscribe, List, ListBySession, Cancel, Pause, Resume, Terminate, Recover, SubmitApproval, UploadAttachment, GetArtifactDownloadUrl |
| `client.Search`    | Cross-resource  | Query |

## Configuration

```go
// Default endpoint (api.stigmer.ai:443)
client, _ := stigmer.NewClient("sk_live_...")

// Custom endpoint
client, _ := stigmer.NewClient("sk_live_...", stigmer.WithBaseURL("localhost:9090"))

// Local development (no TLS)
client, _ := stigmer.NewClient("sk_live_...",
    stigmer.WithBaseURL("localhost:9090"),
    stigmer.WithInsecure(),
)
```

## Error Handling

All methods return `*stigmer.Error` for API errors, wrapping gRPC status codes:

```go
agent, err := client.Agents.Get(ctx, "id")
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
stream, err := client.Executions.Subscribe(ctx, "execution-id")
for {
    exec, err := stream.Recv()
    if err == io.EOF {
        break
    }
    fmt.Println(exec.GetStatus().GetPhase())
}
```

## Types

- **Input types** (`CreateAgentInput`, `CreateExecutionInput`, etc.) are SDK types that flatten proto construction.
- **Response types** are proto types directly (e.g., `*agentv1.Agent`). Access fields via generated getters.
- **Search/List results** use `*stigmer.ListResult` (for SearchService-backed lists) or the native list response types.

## Examples

See the `examples/` directory for complete usage patterns:
- `basic_crud.go` — Create, get, list, delete agents
- `streaming_execution.go` — Create and stream an execution
- `error_handling.go` — Handle SDK errors
- `search.go` — Cross-resource search
