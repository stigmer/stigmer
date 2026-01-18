# Agent Instance Downstream Client

In-process gRPC client for calling the AgentInstance service from other domains.

## Purpose

This client provides zero-overhead cross-domain communication while maintaining clear domain boundaries. It's used by other services (like Agent creation) to create agent instances automatically without requiring explicit user permissions.

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
           │ calls (in-process)
           ▼
┌─────────────────────────────┐
│ AgentInstance Controller    │
│ (controllers/agentinstance) │
└─────────────────────────────┘
```

## Key Features

- **Zero-overhead**: Direct function calls in the same process (no network overhead)
- **Domain separation**: Agent domain doesn't directly depend on AgentInstance domain
- **Migration-ready**: Can be replaced with network gRPC client when splitting to microservices
- **System context**: Bypasses user-level authentication for backend automation

## Usage

```go
// Create client with controller reference
client := agentinstance.NewClient(agentInstanceController)

// Create instance as system (bypasses user auth)
instance, err := client.CreateAsSystem(ctx, instanceRequest)
```

## Java Equivalent

This implements the same pattern as `AgentInstanceGrpcRepoImpl` in Stigmer Cloud, which uses in-process gRPC channels with system credentials.

Key differences:
- **Java**: Uses in-process gRPC channel with `inProcessChannelAsSystem`
- **Go**: Direct controller method calls (simpler, no channel setup needed)

Both achieve the same goal: in-process cross-domain calls with system privileges.

## When to Use

Use this client when:
- One domain needs to create resources in another domain
- The operation should bypass user-level permissions (system-initiated)
- You want to maintain domain boundaries (no direct imports of other domain controllers)

## Migration to Microservices

When splitting services:
1. Replace `controller` field with gRPC client stub
2. Point client to network endpoint
3. Add authentication/authorization
4. No changes to calling code needed

Example:
```go
// Current (in-process)
type Client struct {
    controller agentinstancev1.AgentInstanceCommandControllerServer
}

// Future (network gRPC)
type Client struct {
    conn *grpc.ClientConn
}

func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    // Replace direct call with gRPC call
    stub := agentinstancev1.NewAgentInstanceCommandControllerClient(c.conn)
    return stub.Create(ctx, instance)
}
```
