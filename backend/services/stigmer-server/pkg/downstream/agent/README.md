# Agent Downstream Client

This package provides an in-process gRPC client for calling the Agent service from other domains.

## Purpose

The Agent client enables other domains (e.g., AgentExecution) to interact with agents through the full gRPC interceptor chain, ensuring:
- All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
- All middleware runs before handlers
- Single source of truth for agent operations
- Zero network overhead (in-process communication)

## Architecture

This client lives **outside** the agent domain because it's infrastructure for calling the agent service from other domains. When services are split into separate microservices, this client will be used by external services to make network gRPC calls to the agent service.

```
┌─────────────────────┐
│ AgentExecution      │
│ Controller          │
└──────────┬──────────┘
           │
           │ Uses
           ▼
┌─────────────────────┐      In-Process gRPC      ┌─────────────────────┐
│ Agent Client        │─────────────────────────▶│ Agent Controller    │
│ (downstream/agent)  │   (Full Interceptors)    │ (controllers/agent) │
└─────────────────────┘                           └─────────────────────┘
```

## Usage

### Creating the Client

```go
// In main.go or server setup
inProcessConn, err := server.NewInProcessConnection(ctx)
if err != nil {
    log.Fatal().Err(err).Msg("Failed to create in-process connection")
}

agentClient := agent.NewClient(inProcessConn)
```

### Get an Agent

```go
agent, err := agentClient.Get(ctx, &agentv1.AgentId{Value: "agent-id"})
if err != nil {
    return err // Already a gRPC error
}

fmt.Printf("Agent: %s\n", agent.GetMetadata().GetName())
```

### Update an Agent

```go
agent.Status.DefaultInstanceId = "instance-id"

updated, err := agentClient.Update(ctx, agent)
if err != nil {
    return err
}
```

## Why In-Process gRPC?

### Single Source of Truth

By using in-process gRPC instead of direct store access, we ensure:
- The correct `api_resource_kind` is injected (AGENT, not the caller's kind)
- All validation rules are enforced
- All business logic in the handler executes
- Consistent error handling

**Example Problem with Direct Store Access:**

```go
// ❌ WRONG: Direct store access bypasses interceptors
err := store.SaveResource(ctx, "Agent", agentID, agent)
// Problem: api_resource_kind is wrong (comes from caller's context)
// Problem: No validation, no logging, no business logic
```

**Solution with In-Process gRPC:**

```go
// ✅ RIGHT: In-process gRPC goes through full interceptor chain
updated, err := agentClient.Update(ctx, agent)
// Benefit: Correct api_resource_kind (AGENT)
// Benefit: All interceptors execute
// Benefit: Handler business logic runs
```

## Migration to Microservices

When splitting to separate services, this client will be deployed with services that need to call the agent service. Simply replace the in-process gRPC connection with a network gRPC connection:

```go
// Before (in-process)
inProcessConn, err := server.NewInProcessConnection(ctx)
agentClient := agent.NewClient(inProcessConn)

// After (network)
networkConn, err := grpc.Dial("agent-service:50051", grpc.WithInsecure())
agentClient := agent.NewClient(networkConn)
// No changes to client code needed!
```

## Available Methods

### Query Methods

- `Get(ctx, *AgentId) (*Agent, error)` - Retrieve an agent by ID

### Command Methods

- `Update(ctx, *Agent) (*Agent, error)` - Update an existing agent

## Dependencies

- `agentv1` - Agent protobuf definitions
- `grpc` - gRPC client library
- `zerolog` - Structured logging

## Related

- [Agent Controller](../../controllers/agent/README.md) - The handler implementation
- [AgentInstance Client](../agentinstance/README.md) - Similar pattern for agent instances
- [Session Client](../session/README.md) - Similar pattern for sessions
