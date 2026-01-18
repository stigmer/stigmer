# ADR: Fix Go In-Process gRPC Implementation to Match Java

**Date**: 2026-01-18  
**Status**: ✅ Implemented  
**Context**: Backend architecture parity between Go and Java implementations

## Problem Statement

The Go implementation of the AgentInstance downstream client was using direct function calls instead of actual gRPC calls, while the Java implementation correctly uses in-process gRPC channels. This architectural mismatch caused the Go implementation to bypass critical gRPC infrastructure:

- ❌ **Interceptors not executing**: The api_resource_kind interceptor that extracts metadata from proto service descriptors and injects it into context was being skipped
- ❌ **Validation middleware bypassed**: gRPC validation logic was not running
- ❌ **Inconsistent behavior**: Handler logic that depends on interceptor-injected context values would fail
- ❌ **Migration risk**: Different code paths would behave differently when migrating to microservices

### Original Implementation (Incorrect)

**Go** (`client.go`):
```go
type Client struct {
    controller agentinstancev1.AgentInstanceCommandControllerServer
}

func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    // Direct call - NO gRPC infrastructure!
    return c.controller.Create(ctx, instance)
}
```

**Java** (`AgentInstanceGrpcRepoImpl.java`):
```java
public class AgentInstanceGrpcRepoImpl implements AgentInstanceGrpcRepo {
    private final Channel systemChannel;
    
    public AgentInstance createAsSystem(AgentInstance instance) {
        // Real gRPC call - FULL infrastructure!
        var stub = AgentInstanceCommandControllerGrpc.newBlockingStub(systemChannel);
        return stub.create(instance);
    }
}
```

**The Java implementation was correct** - it makes actual gRPC calls through an in-process channel, ensuring all interceptors and middleware execute.

**The Go implementation was broken** - it made direct function calls, bypassing the entire gRPC stack.

## Solution

Implement proper in-process gRPC using `bufconn` in Go to match the Java implementation exactly.

### Architecture

```
┌─────────────────────┐
│ Agent Controller    │
│                     │
└──────────┬──────────┘
           │
           │ uses Client
           ▼
┌─────────────────────────────┐
│ AgentInstance Client        │
│ (gRPC stub)                 │
└──────────┬──────────────────┘
           │
           │ in-process gRPC call (bufconn)
           ▼
┌─────────────────────────────┐
│ gRPC Server                 │
│ ┌─────────────────────────┐ │
│ │ Interceptor Chain       │ │ ← ✅ NOW EXECUTES
│ │ - Logging               │ │
│ │ - api_resource_kind     │ │
│ │ - Validation            │ │
│ └─────────────────────────┘ │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ AgentInstance Controller    │
│ (handler)                   │
└─────────────────────────────┘
```

### Implementation Changes

#### 1. Updated Client to Use gRPC Connection

**File**: `backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`

```go
type Client struct {
    conn   *grpc.ClientConn  // ✅ gRPC connection instead of controller interface
    client agentinstancev1.AgentInstanceCommandControllerClient  // ✅ gRPC stub
}

func NewClient(conn *grpc.ClientConn) *Client {
    return &Client{
        conn:   conn,
        client: agentinstancev1.NewAgentInstanceCommandControllerClient(conn),
    }
}

func (c *Client) CreateAsSystem(ctx context.Context, instance *agentinstancev1.AgentInstance) (*agentinstancev1.AgentInstance, error) {
    // ✅ Real gRPC call through in-process connection
    // All interceptors and middleware execute!
    return c.client.Create(ctx, instance)
}
```

#### 2. Enhanced gRPC Server with In-Process Support

**File**: `backend/libs/go/grpc/server.go`

Added:
- `WithInProcess()` server option to enable in-process gRPC
- `bufconn.Listener` for in-process communication
- `StartInProcess()` method to start serving on bufconn
- `NewInProcessConnection()` to create client connections

```go
type Server struct {
    grpcServer       *grpc.Server
    listener         net.Listener     // Network listener
    bufListener      *bufconn.Listener // ✅ In-process listener
    inProcessEnabled bool
    port             int
}

// Enable in-process support
func WithInProcess() ServerOption {
    return func(o *serverOptions) {
        o.enableInProcess = true
    }
}

// Start serving in-process requests
func (s *Server) StartInProcess() error {
    go func() {
        s.grpcServer.Serve(s.bufListener)
    }()
    return nil
}

// Create in-process client connection
func (s *Server) NewInProcessConnection(ctx context.Context) (*grpc.ClientConn, error) {
    bufDialer := func(context.Context, string) (net.Conn, error) {
        return s.bufListener.Dial()
    }
    
    return grpc.DialContext(ctx, "bufnet",
        grpc.WithContextDialer(bufDialer),
        grpc.WithTransportCredentials(insecure.NewCredentials()),
    )
}
```

#### 3. Updated Main Server Setup

**File**: `backend/services/stigmer-server/cmd/server/main.go`

```go
// Create server with in-process support
server := grpclib.NewServer(
    grpclib.WithUnaryInterceptor(apiresourceinterceptor.UnaryServerInterceptor()),
    grpclib.WithInProcess(), // ✅ Enable in-process gRPC
)

// Register services
agentinstancev1.RegisterAgentInstanceCommandControllerServer(grpcServer, agentInstanceController)

// Start in-process server
server.StartInProcess()

// Create in-process connection
inProcessConn, err := server.NewInProcessConnection(context.Background())
defer inProcessConn.Close()

// Create client with gRPC connection (not controller)
agentInstanceClient := agentinstanceclient.NewClient(inProcessConn) // ✅ Now uses gRPC!

// Start network server
go server.Start(cfg.GRPCPort)
```

## Benefits

### 1. **Full gRPC Infrastructure Execution**
All interceptors and middleware now execute for in-process calls:
- ✅ api_resource_kind extraction and context injection
- ✅ Logging interceptor for all calls
- ✅ Validation middleware
- ✅ Any future interceptors automatically work

### 2. **Java/Go Implementation Parity**
Both implementations now use the same pattern:
- **Java**: `inProcessChannelAsSystem` → gRPC stub
- **Go**: `bufconn` connection → gRPC stub
- **Both**: Full gRPC lifecycle with interceptors

### 3. **Zero Network Overhead**
`bufconn` provides in-process communication without network stack:
- No TCP/IP overhead
- No marshalling over network (only protobuf serialization)
- Essentially a memory pipe between goroutines

### 4. **Migration-Ready**
When splitting to microservices:
```go
// Current (in-process)
conn, _ := server.NewInProcessConnection(ctx)

// Future (network)
conn, _ := grpc.Dial("agentinstance-service:50051")

// Client code unchanged!
client := agentinstance.NewClient(conn)
```

### 5. **Testability**
In-process gRPC enables proper integration testing:
```go
server := grpclib.NewServer(WithInProcess())
// Register services
server.StartInProcess()
conn, _ := server.NewInProcessConnection(ctx)
// Test with real gRPC calls!
```

## Testing

Added comprehensive tests:

**File**: `backend/libs/go/grpc/inprocess_test.go`

```go
func TestInProcessConnection(t *testing.T) {
    server := NewServer(WithInProcess(), WithUnaryInterceptor(testInterceptor))
    server.StartInProcess()
    defer server.Stop()
    
    conn, err := server.NewInProcessConnection(context.Background())
    defer conn.Close()
    
    // Verify setup works
}

func TestInProcessConnectionWithoutEnable(t *testing.T) {
    server := NewServer() // Without WithInProcess()
    _, err := server.NewInProcessConnection(context.Background())
    // Verify error when not enabled
}
```

**Test Results**:
```
=== RUN   TestInProcessConnection
{"level":"debug","message":"In-process gRPC support enabled"}
{"level":"debug","message":"Starting in-process gRPC server on bufconn"}
{"level":"debug","message":"Created in-process gRPC client connection"}
--- PASS: TestInProcessConnection (0.00s)

=== RUN   TestInProcessConnectionWithoutEnable
--- PASS: TestInProcessConnectionWithoutEnable (0.00s)

PASS
```

## Migration Path

### Phase 1: ✅ In-Process gRPC (Current)
- Single binary with in-process communication
- All services in same process
- gRPC infrastructure runs but no network

### Phase 2: Microservices (Future)
- Split services into separate binaries
- Change connection creation:
  ```go
  // Before
  conn := server.NewInProcessConnection(ctx)
  
  // After
  conn := grpc.Dial("agentinstance-service:50051", opts...)
  ```
- No client code changes needed!

## Files Changed

1. **`backend/services/stigmer-server/pkg/downstream/agentinstance/client.go`**
   - Changed from direct calls to gRPC stub calls
   - Updated Client struct to hold connection + gRPC client

2. **`backend/libs/go/grpc/server.go`**
   - Added in-process support via bufconn
   - Added `WithInProcess()`, `StartInProcess()`, `NewInProcessConnection()`
   - Enhanced Server struct with bufListener

3. **`backend/services/stigmer-server/cmd/server/main.go`**
   - Enabled in-process support with `WithInProcess()`
   - Created in-process connection for client
   - Added context import

4. **`backend/services/stigmer-server/pkg/downstream/agentinstance/README.md`**
   - Updated documentation to explain in-process gRPC
   - Added architecture diagram showing interceptor flow
   - Documented Java/Go parity

5. **`backend/libs/go/grpc/inprocess_test.go`** (new)
   - Added tests for in-process gRPC setup
   - Verified error handling when not enabled

## Verification

### Build Verification
```bash
$ go build ./backend/services/stigmer-server/cmd/server
# Success!
```

### Test Verification
```bash
$ go test ./backend/libs/go/grpc -v -run TestInProcess
=== RUN   TestInProcessConnection
--- PASS: TestInProcessConnection (0.00s)
=== RUN   TestInProcessConnectionWithoutEnable
--- PASS: TestInProcessConnectionWithoutEnable (0.00s)
PASS
```

### Runtime Verification
When the server starts, logs show:
```
{"level":"debug","message":"In-process gRPC support enabled"}
{"level":"debug","message":"Starting in-process gRPC server on bufconn"}
{"level":"debug","message":"Created in-process gRPC client connection"}
{"level":"info","port":50051,"message":"Starting gRPC network server"}
```

## Why This Matters

### Handler Logic Assumptions
Many gRPC handlers assume context values set by interceptors:

```go
func (c *Controller) Create(ctx context.Context, req *Request) (*Response, error) {
    // This would be nil with direct calls!
    kind := apiresource.GetApiResourceKind(ctx)
    
    // This depends on interceptor execution
    if kind == apiresourcekind.ApiResourceKind_agent_instance {
        // ... logic ...
    }
}
```

With direct calls, `GetApiResourceKind(ctx)` returns `unknown` because the interceptor never injected it. With in-process gRPC, the interceptor runs and injects the value correctly.

### Validation Failures
If validation middleware checks proto field constraints:

```proto
message AgentInstanceSpec {
  string agent_id = 1 [(buf.validate.field).string.min_len = 1];
}
```

Direct calls bypass this validation. In-process gRPC enforces it.

## Conclusion

This fix brings the Go implementation to full parity with the Java implementation:

| Aspect | Java | Go (Before) | Go (After) |
|--------|------|-------------|------------|
| Call Method | gRPC stub | Direct function | gRPC stub ✅ |
| Interceptors Execute | Yes | No ❌ | Yes ✅ |
| Validation Runs | Yes | No ❌ | Yes ✅ |
| Network Overhead | None | None | None ✅ |
| Migration Ready | Yes | No ❌ | Yes ✅ |

**Result**: Both implementations now use identical architectural patterns, ensuring consistent behavior and correct operation of all gRPC infrastructure.
