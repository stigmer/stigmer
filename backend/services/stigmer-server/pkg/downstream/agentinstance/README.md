# Agent Instance Downstream Client

In-process gRPC client for calling the AgentInstance service from other domains.

## Purpose

This client provides zero-overhead cross-domain communication while maintaining clear domain boundaries and full gRPC infrastructure (interceptors, validation, etc.). It's used by other services (like Agent creation) to create agent instances automatically without requiring explicit user permissions.

## Architecture

```
┌─────────────────────┐
│ Agent Controller    │
│ (creates agents)    │
└──────────┬──────────┘
           │
           │ uses
           ▼
┌─────────────────────────────┐
│ AgentInstance Client        │
│ (downstream/agentinstance)  │
└──────────┬──────────────────┘
           │
           │ in-process gRPC call (via bufconn)
           │ ✓ Interceptors execute
           │ ✓ Validation runs
           │ ✓ Full gRPC lifecycle
           ▼
┌─────────────────────────────┐
│ gRPC Server (in-process)    │
│ - apiresource interceptor   │
│ - logging interceptor       │
│ - validation middleware     │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ AgentInstance Controller    │
│ (controllers/agentinstance) │
└─────────────────────────────┘
```

## Key Features

- **Full gRPC infrastructure**: All interceptors and middleware execute (validation, logging, api_resource_kind injection, etc.)
- **Zero network overhead**: Uses bufconn for in-process communication
- **Domain separation**: Agent domain doesn't directly depend on AgentInstance domain
- **Migration-ready**: Can be replaced with network gRPC client when splitting to microservices
- **System context**: Bypasses user-level authentication for backend automation
- **Consistent behavior**: Same code path as network gRPC calls, just without network transport

## Usage

```go
// In main.go, create in-process gRPC connection
inProcessConn, err := server.NewInProcessConnection(context.Background())
if err != nil {
    log.Fatal().Err(err).Msg("Failed to create in-process connection")
}
defer inProcessConn.Close()

// Create client with gRPC connection
client := agentinstance.NewClient(inProcessConn)

// Create instance as system (bypasses user auth)
// This goes through full gRPC stack with all interceptors
instance, err := client.CreateAsSystem(ctx, instanceRequest)
```

## Java Equivalent

This implements the **exact same pattern** as `AgentInstanceGrpcRepoImpl` in Stigmer Cloud, which uses in-process gRPC channels with system credentials.

Implementation parity:
- **Java**: Uses `inProcessChannelAsSystem` with `newBlockingStub(systemChannel)`
- **Go**: Uses `bufconn` with `NewAgentInstanceCommandControllerClient(conn)`
- **Both**: Make actual gRPC calls with full interceptor chain
- **Both**: Ensure all validation and middleware execute before handlers

## When to Use

Use this client when:
- One domain needs to create resources in another domain
- The operation should bypass user-level permissions (system-initiated)
- You want to maintain domain boundaries (no direct imports of other domain controllers)

## Why In-Process gRPC Instead of Direct Calls?

**Critical**: This client uses actual gRPC calls (via bufconn) instead of direct function calls because:

1. **Interceptors must execute**: The api_resource_kind interceptor extracts metadata from proto service descriptors and injects it into the context. Without going through gRPC, this doesn't happen.

2. **Validation must run**: gRPC middleware performs validation before handlers. Direct calls bypass this.

3. **Consistent behavior**: The handler logic expects the full gRPC request lifecycle. Skipping it breaks assumptions.

4. **Migration safety**: When splitting to microservices, behavior is identical—just swap the connection.

**Previous implementation** (direct calls) was incorrect and would have failed when handler logic depended on interceptor-injected context values.

**Current implementation** (in-process gRPC) matches Java exactly and ensures full gRPC infrastructure runs.

## Migration to Microservices

When splitting services:
1. Replace in-process connection with network connection
2. Point connection to network endpoint
3. Add authentication/authorization if needed
4. **No changes to client code needed** - it already uses gRPC stubs!

Example:
```go
// Current (in-process via bufconn)
inProcessConn, _ := server.NewInProcessConnection(ctx)
client := agentinstance.NewClient(inProcessConn)

// Future (network gRPC)
networkConn, _ := grpc.Dial("agentinstance-service:50051", grpc.WithInsecure())
client := agentinstance.NewClient(networkConn)

// Client usage is IDENTICAL - no code changes needed
instance, err := client.CreateAsSystem(ctx, req)
```
