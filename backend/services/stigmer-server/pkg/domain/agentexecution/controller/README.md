# Agent Execution Controller

Handles agent execution lifecycle management for Stigmer OSS.

## Architecture

The Agent Execution Controller implements both `AgentExecutionCommandController` and `AgentExecutionQueryController` gRPC services defined in the proto files.

## Handlers

### Command Handlers

#### Create
Creates and triggers a new agent execution.

**Pipeline**:
1. `ValidateFieldConstraints` - Validate proto field constraints
2. `ValidateSessionOrAgent` - Ensure session_id OR agent_id is provided
3. `ResolveSlug` - Generate slug from metadata.name
4. `BuildNewState` - Generate ID, set audit fields
5. `CreateDefaultInstanceIfNeeded` - Create default agent instance if missing
6. `CreateSessionIfNeeded` - Auto-create session if session_id not provided
7. `SetInitialPhase` - Set execution phase to PENDING
8. `Persist` - Save execution to repository

**Key Features**:
- Supports two execution modes:
  - With `session_id`: Execute within existing session
  - With `agent_id`: Auto-create session using agent's default instance
- Automatically creates default instance if agent doesn't have one
- Sets initial phase to PENDING for frontend loading indicators

#### Update
Updates an existing agent execution (full state replacement).

**Pipeline**:
1. `Persist` - Save updated execution

**Note**: This is for user-initiated spec updates. Status updates from agent-runner use `UpdateStatus` instead.

#### UpdateStatus
Updates execution status during agent execution (incremental status updates).

**Features**:
- Optimized for frequent status updates from agent-runner
- Merges status fields with existing state using proto.Merge
- Updates messages, tool_calls, phase, etc. incrementally

**Direct Implementation** (not pipeline-based for performance).

#### Delete
Deletes an agent execution.

**Steps**:
1. Validate input ID
2. Load execution (for audit trail)
3. Delete from database
4. Return deleted execution

### Query Handlers

#### Get
Retrieves a single agent execution by ID.

**Direct implementation** - loads from store and returns.

#### List
Lists all agent executions with optional filtering.

**Features**:
- Filter by execution phase
- Filter by tags (TODO)
- Pagination support (TODO)

#### ListBySession
Lists all executions in a specific session.

**Features**:
- Filters by session_id
- Pagination support (TODO)

#### Subscribe
Real-time execution updates via gRPC streaming.

**Implementation**: 
- Polling-based for OSS (1-second interval)
- Automatically ends subscription when execution reaches terminal state
- TODO: Replace with event-driven mechanism (file watchers, channels, etc.)

## Simplified from Stigmer Cloud

### Excluded Steps (not needed for OSS):

**Authorization**:
- No `Authorize` step (no multi-tenant auth)
- No `CreateIamPolicies` step (no IAM/FGA)

**Event Publishing**:
- No `Publish` step (no NATS)
- No `PublishToRedis` step (no Redis Streams)

**Workflow**:
- No `StartWorkflow` step (no Temporal yet - will be added later)

**Response Handling**:
- No `TransformResponse` step (no field transformations)

## Custom Pipeline Steps

### ValidateSessionOrAgent
Ensures at least one of `session_id` or `agent_id` is provided.

### CreateDefaultInstanceIfNeeded
Creates default agent instance if the agent doesn't have one.

**When**:
- Only runs if `session_id` is NOT provided
- Checks if agent has `default_instance_id` in status
- Creates instance if missing
- Updates agent status with `default_instance_id`
- Stores instance ID in context for next step

### CreateSessionIfNeeded
Auto-creates session if `session_id` is not provided.

**When**:
- Only runs if `session_id` is NOT provided
- Uses `default_instance_id` from context (set by previous step)
- Creates session with auto-generated name
- Updates execution spec with created `session_id`
- Stores session ID in context for tracking

### SetInitialPhase
Sets execution phase to `EXECUTION_PENDING`.

**Purpose**: Allows frontend to show loading indicator immediately before agent worker starts processing.

## Context Keys

Pipeline steps communicate via context metadata:

```go
const (
    DefaultInstanceIDKey = "default_instance_id"  // Set by CreateDefaultInstanceIfNeeded
    CreatedSessionIDKey  = "created_session_id"   // Set by CreateSessionIfNeeded
)
```

## Dependencies

- `badger.Store` - Local persistence
- `agentinstance.Client` - Downstream client for creating agent instances

## Usage

```go
// Create controller
ctrl := NewAgentExecutionController(store, agentInstanceClient)

// Register with gRPC server
agentexecutionv1.RegisterAgentExecutionCommandControllerServer(server, ctrl)
agentexecutionv1.RegisterAgentExecutionQueryControllerServer(server, ctrl)
```

## Execution Flow

### User triggers execution with agent_id (no session)

```
1. User sends AgentExecution with agent_id="agent-123", message="Hello"
2. ValidateSessionOrAgent: ✓ agent_id provided
3. BuildNewState: Generate execution ID
4. CreateDefaultInstanceIfNeeded:
   - Load agent-123
   - Check default_instance_id → missing
   - Create default instance "agent-123-default"
   - Update agent status with instance ID
   - Store instance ID in context
5. CreateSessionIfNeeded:
   - Get instance ID from context
   - Create session with instance ID
   - Update execution with session_id
6. SetInitialPhase: Set phase to PENDING
7. Persist: Save execution to database
8. Return execution (ready for agent-runner)
```

### User triggers execution with session_id

```
1. User sends AgentExecution with session_id="ses-456", message="Hello"
2. ValidateSessionOrAgent: ✓ session_id provided
3. BuildNewState: Generate execution ID
4. CreateDefaultInstanceIfNeeded: SKIP (session provided)
5. CreateSessionIfNeeded: SKIP (session provided)
6. SetInitialPhase: Set phase to PENDING
7. Persist: Save execution to database
8. Return execution (ready for agent-runner)
```

## Future Enhancements

1. **Temporal Workflow Integration**
   - Add `StartWorkflow` step to trigger agent execution worker
   - Similar to Cloud implementation

2. **Event Streaming**
   - Replace Subscribe polling with event-driven updates
   - Options: File watchers, Go channels, Redis Streams

3. **Pagination**
   - Implement proper pagination for List and ListBySession
   - Add page_token support

4. **Enhanced Filtering**
   - Tag-based filtering
   - Date range filtering
   - Advanced query support

## Testing

TODO: Add unit tests for:
- Create pipeline (all custom steps)
- UpdateStatus merging logic
- Subscribe streaming behavior
- List filtering logic
