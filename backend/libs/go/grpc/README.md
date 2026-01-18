# gRPC Server Utilities

gRPC server utilities and middleware for Stigmer services.

## Features

- **Server Lifecycle Management** - Start, stop, graceful shutdown
- **Request/Response Logging** - Automatic logging of all gRPC calls with duration
- **Error Handling** - Helper functions for common gRPC error codes
- **Interceptor Support** - Custom unary and stream interceptors

## Usage

### Creating a Server

```go
import "github.com/stigmer/stigmer/backend/libs/go/grpc"

server := grpc.NewServer()
```

### Registering Services

```go
// Get the underlying gRPC server
grpcServer := server.GRPCServer()

// Register your service
agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)
```

### Starting the Server

```go
// Start on port 8080
go func() {
    if err := server.Start(8080); err != nil {
        log.Fatal().Err(err).Msg("Failed to start server")
    }
}()

// Graceful shutdown
server.Stop()
```

### Custom Interceptors

```go
// Add custom interceptors
server := grpc.NewServer(
    grpc.WithUnaryInterceptor(myCustomInterceptor),
    grpc.WithStreamInterceptor(myStreamInterceptor),
)
```

## Error Handling

Use the provided error helpers for consistent error codes:

```go
import "github.com/stigmer/stigmer/backend/libs/go/grpc"

// Not found
return nil, grpc.NotFoundError("Agent", id)

// Invalid argument
return nil, grpc.InvalidArgumentError("name is required")

// Internal error
return nil, grpc.InternalError(err, "failed to save agent")

// Already exists
return nil, grpc.AlreadyExistsError("Agent", id)

// Custom error
return nil, grpc.WrapError(err, codes.PermissionDenied, "access denied")
```

## Logging

All gRPC calls are automatically logged with:
- Method name
- Duration
- Status code
- Error message (if failed)

**Success Log**:
```
INFO gRPC call succeeded method=/ai.stigmer.agentic.agent.v1.AgentCommandController/Create duration_ms=45
```

**Error Log**:
```
ERROR gRPC call failed method=/ai.stigmer.agentic.agent.v1.AgentCommandController/Create duration_ms=12 code=INVALID_ARGUMENT error="name is required"
```

## Configuration

The server is configured with sensible defaults:

- **Max Receive Message Size**: 10MB
- **Max Send Message Size**: 10MB
- **Graceful Shutdown**: Yes
- **Logging Interceptor**: Enabled by default

## Example

Complete server setup:

```go
package main

import (
    "os"
    "os/signal"
    "syscall"

    "github.com/rs/zerolog/log"
    "github.com/stigmer/stigmer/backend/libs/go/grpc"
    "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers"
    agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
)

func main() {
    // Create server
    server := grpc.NewServer()

    // Create and register controllers
    agentController := controllers.NewAgentController(store)
    grpcServer := server.GRPCServer()
    agentv1.RegisterAgentCommandControllerServer(grpcServer, agentController)
    agentv1.RegisterAgentQueryControllerServer(grpcServer, agentController)

    // Start server in goroutine
    go func() {
        if err := server.Start(8080); err != nil {
            log.Fatal().Err(err).Msg("Failed to start server")
        }
    }()

    // Wait for interrupt
    done := make(chan os.Signal, 1)
    signal.Notify(done, os.Interrupt, syscall.SIGINT, syscall.SIGTERM)
    <-done

    // Graceful shutdown
    server.Stop()
}
```

## Related

- [SQLite Storage](../sqlite/README.md)
- [Stigmer Server](../../services/stigmer-server/README.md)

---

**Last Updated**: January 19, 2026  
**Maintained By**: Stigmer Engineering Team
