# Database Schema: Old vs. New Approach

**Created**: 2026-01-18
**Status**: Comparison Document

## The Problem

The initial plan (T01_0_plan.md) listed these tables:

```
- executions: Workflow execution state
- execution_logs: Execution logs and events
- secrets: Encrypted secret storage
- agents: Agent definitions
- workflows: Workflow definitions
- artifacts: Stored execution artifacts
```

**Issues with this approach:**

1. ❌ **Not derived from protos** - Tables were guessed, not based on actual API structure
2. ❌ **"secrets" table doesn't exist in protos** - Secrets are part of `Environment` and `ExecutionContext`
3. ❌ **"execution_logs" table doesn't exist** - Logs are part of execution status (not separate)
4. ❌ **"artifacts" table doesn't exist** - Artifacts are stored differently (not in database)
5. ❌ **Missing critical tables** - No `AgentInstance`, `WorkflowInstance`, `Session`, etc.
6. ❌ **Vague naming** - "executions" could mean workflow OR agent executions (two different resources)

## The Solution

**Design Principle**: Database schema MUST mirror the proto API structure exactly.

**Process:**
1. Scan all proto files in `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/apis/`
2. Extract all `ApiResourceKind` enum values from `api_resource_kind.proto`
3. For each kind, read the corresponding `spec.proto` and `api.proto`
4. Create one table per `ApiResourceKind` with fields matching proto structure

**Result**: 15 tables, all directly derived from protos.

## Detailed Comparison

### Table-by-Table Analysis

| Old Table | Status | New Table(s) | Notes |
|-----------|--------|--------------|-------|
| `executions` | ❌ Vague | `agent_executions`<br>`workflow_executions` | Two separate resources with different structures |
| `execution_logs` | ❌ Wrong | (part of execution `status`) | Logs are in `status.messages[]` field, not separate table |
| `secrets` | ❌ Wrong | `environments`<br>`execution_contexts` | Secrets stored as `EnvironmentValue` with `is_secret=true` |
| `agents` | ✅ Correct | `agents` | Matches proto, but missing instance layer |
| `workflows` | ✅ Correct | `workflows` | Matches proto, but missing instance layer |
| `artifacts` | ❌ Wrong | (not in database) | Artifacts stored in object storage (S3, R2), not SQLite |

### Missing Tables (Not in Old List)

These critical tables were **missing** from the original plan:

1. **`agent_instances`** - Configured agent deployments (Instance layer)
   - Links Agent template → Environment → Configuration
   - Required for multi-environment deployments (dev/prod)

2. **`workflow_instances`** - Configured workflow deployments (Instance layer)
   - Links Workflow template → Environment → Configuration
   - Required for multi-environment deployments (dev/prod)

3. **`sessions`** - Agent conversation sessions
   - Groups multiple `agent_executions` into a conversation thread
   - Manages thread_id and sandbox_id for persistence

4. **`skills`** - Agent knowledge base
   - Markdown content injected into agent context
   - Enables RAG-style knowledge sharing

5. **`execution_contexts`** - Ephemeral runtime secrets
   - JIT (Just-In-Time) secret injection for executions
   - Deleted when execution completes (security)

6. **IAM Tables** - Identity and access management
   - `identity_accounts`: User accounts
   - `api_keys`: API keys for authentication
   - `iam_policies`: Authorization policies

7. **Tenancy Tables** - Organization management
   - `organizations`: Tenant root entities

8. **Versioning Tables** - Audit trail
   - `api_resource_versions`: Full history of all resource changes

## Why "secrets" Table is Wrong

The original plan included a `secrets` table. **This does not exist in the Stigmer protos.**

### How Secrets Actually Work

Secrets are stored in **two places**:

#### 1. Long-Lived Secrets → `environments` Table

**Proto**: `ai.stigmer.agentic.environment.v1.EnvironmentSpec`

```protobuf
message EnvironmentSpec {
  string description = 1;
  
  // Map of key-value pairs
  // Each value includes a flag indicating whether it's a secret
  map<string, EnvironmentValue> data = 2;
}

message EnvironmentValue {
  string value = 1;         // Encrypted if is_secret=true
  bool is_secret = 2;       // Flag: is this a secret?
  string description = 3;   // Optional documentation
}
```

**Example**:
```json
{
  "AWS_REGION": {
    "value": "us-west-2",
    "is_secret": false,
    "description": "Default AWS region"
  },
  "AWS_ACCESS_KEY_ID": {
    "value": "AKIA...",  // Encrypted in database
    "is_secret": true,
    "description": "AWS access key for S3"
  }
}
```

**Storage**:
- `environments` table, `spec` JSON column
- When `is_secret=true`, `value` is encrypted using AES-256-GCM
- Encryption key stored in OS keychain (macOS) or `~/.stigmer/master.key` (Linux)

#### 2. Ephemeral Secrets → `execution_contexts` Table

**Proto**: `ai.stigmer.agentic.executioncontext.v1.ExecutionContextSpec`

```protobuf
message ExecutionContextSpec {
  string execution_id = 1;
  
  // Runtime secrets (deleted when execution completes)
  map<string, ExecutionValue> data = 2;
}

message ExecutionValue {
  string value = 1;      // Encrypted if is_secret=true
  bool is_secret = 2;    // Flag: is this a secret?
}
```

**Use Case**: JIT (Just-In-Time) secret injection for B2B integrations.

**Example** (Planton Cloud customer executing workflow):
```json
{
  "CUSTOMER_API_KEY": {
    "value": "sk_live_abc123...",  // Encrypted
    "is_secret": true
  },
  "CUSTOMER_WORKSPACE_ID": {
    "value": "ws-customer-abc",
    "is_secret": false
  }
}
```

**Lifecycle**:
1. Created when execution starts (if `runtime_env` provided in spec)
2. Execution accesses secrets during runtime
3. **Deleted when execution completes** (ephemeral, never persisted long-term)

### Why No Separate "secrets" Table?

**Design Decision**: Secrets are always **scoped to their context** (Environment or Execution).

**Benefits:**
1. **Clear Ownership**: Every secret belongs to an Environment or ExecutionContext
2. **Automatic Cleanup**: ExecutionContext deletion cleans up ephemeral secrets
3. **Access Control**: Secrets inherit permissions from their parent resource
4. **Layering**: Environments can be layered (base → prod → team overrides)
5. **Proto Alignment**: Matches the actual API structure

**Alternative (not chosen)**: Separate `secrets` table with references.
- ❌ Requires foreign keys and join queries
- ❌ Orphan secret cleanup becomes manual
- ❌ Doesn't match proto structure
- ❌ Harder to implement layered environment merging

## Why "execution_logs" Table is Wrong

The original plan included an `execution_logs` table. **This does not exist in the protos.**

### How Execution Logs Actually Work

Execution logs are stored **inside the execution status**, not in a separate table.

#### Agent Execution Logs

**Proto**: `ai.stigmer.agentic.agentexecution.v1.AgentExecutionStatus`

```protobuf
message AgentExecutionStatus {
  // Sequential stream of execution events
  repeated AgentMessage messages = 1;
  
  // Tool calls (also in messages, but tracked separately)
  repeated ToolCall tool_calls = 3;
  
  // Sub-agent delegations
  repeated SubAgentExecution sub_agent_executions = 4;
}

message AgentMessage {
  MessageType type = 1;        // HUMAN, AI, TOOL, SYSTEM
  string content = 2;           // Message text
  string timestamp = 3;         // ISO 8601
  repeated ToolCall tool_calls = 4;
}
```

**Storage**:
- `agent_executions` table, `status` JSON column
- `status.messages[]` contains chronological event stream
- `status.tool_calls[]` contains all tool invocations (extracted for querying)

**Example**:
```json
{
  "messages": [
    {
      "type": "HUMAN",
      "content": "Deploy to production",
      "timestamp": "2025-01-11T14:30:00Z"
    },
    {
      "type": "AI",
      "content": "I'll deploy to production. First, let me check the current status.",
      "timestamp": "2025-01-11T14:30:01Z",
      "tool_calls": [{"id": "call-1", "name": "kubectl_get_pods"}]
    },
    {
      "type": "TOOL",
      "content": "Pod status: 3 running",
      "timestamp": "2025-01-11T14:30:03Z"
    }
  ]
}
```

#### Workflow Execution Logs

**Proto**: `ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionStatus`

```protobuf
message WorkflowExecutionStatus {
  // Workflow tasks with execution state
  repeated WorkflowTask tasks = 2;
}

message WorkflowTask {
  string task_id = 1;
  string task_name = 2;
  WorkflowTaskType task_type = 3;
  google.protobuf.Struct input = 4;
  google.protobuf.Struct output = 5;
  WorkflowTaskStatus status = 6;
  string started_at = 7;
  string completed_at = 8;
  string error = 9;
}
```

**Storage**:
- `workflow_executions` table, `status` JSON column
- `status.tasks[]` contains task-by-task execution history

**Example**:
```json
{
  "tasks": [
    {
      "task_id": "task-1",
      "task_name": "validate_email",
      "task_type": "WORKFLOW_TASK_API_CALL",
      "status": "WORKFLOW_TASK_COMPLETED",
      "started_at": "2025-01-11T14:30:00Z",
      "completed_at": "2025-01-11T14:30:01Z",
      "output": {"valid": true}
    }
  ]
}
```

### Why No Separate "execution_logs" Table?

**Design Decision**: Logs are part of execution state, stored in `status` JSON.

**Benefits:**
1. **Atomic Updates**: Execution + logs updated together (no consistency issues)
2. **Proto Alignment**: Matches the actual API structure exactly
3. **Simpler Queries**: One query gets execution + full log history
4. **No Joins**: No foreign key relationships to manage
5. **JSON Flexibility**: SQLite JSON functions enable nested queries

**Query Example** (find executions with tool call failures):
```sql
SELECT
  id,
  json_extract(status, '$.phase') AS phase,
  (
    SELECT COUNT(*)
    FROM json_each(json_extract(status, '$.tool_calls'))
    WHERE json_extract(value, '$.status') = 'TOOL_CALL_FAILED'
  ) AS failed_tool_calls
FROM agent_executions
WHERE failed_tool_calls > 0;
```

**Alternative (not chosen)**: Separate `execution_logs` table with `execution_id` foreign key.
- ❌ Requires joins for every query
- ❌ Potential consistency issues (execution complete but logs still writing)
- ❌ Doesn't match proto structure
- ❌ Harder to paginate (need to reconstruct message order)

## Why "artifacts" Table is Wrong

The original plan included an `artifacts` table. **Artifacts are NOT stored in the database.**

### How Artifacts Actually Work

Artifacts are stored in **object storage** (S3, Cloudflare R2, local filesystem), not in SQLite.

**Design Decision**: Database stores **references** to artifacts, not the artifacts themselves.

#### Workflow Execution Artifacts

**Proto**: `ai.stigmer.agentic.workflowexecution.v1.WorkflowTask`

```protobuf
message WorkflowTask {
  string task_id = 1;
  string task_name = 2;
  google.protobuf.Struct output = 5;  // May contain artifact references
}
```

**Example** (task output with artifact reference):
```json
{
  "task_id": "task-generate-report",
  "output": {
    "report_url": "s3://stigmer-artifacts/wex-abc123/report.pdf",
    "report_size_bytes": 1048576,
    "report_generated_at": "2025-01-11T14:30:00Z"
  }
}
```

**Storage**:
- `workflow_executions` table, `status.tasks[].output` JSON
- Actual artifact: `s3://stigmer-artifacts/wex-abc123/report.pdf`

#### Agent Execution Artifacts

**Proto**: `ai.stigmer.agentic.agentexecution.v1.ToolCall`

```protobuf
message ToolCall {
  string id = 1;
  string name = 2;
  google.protobuf.Struct args = 3;
  string result = 4;  // May contain artifact reference
}
```

**Example** (file creation tool result):
```json
{
  "tool_call": {
    "id": "call-create-file",
    "name": "create_file",
    "args": {"path": "/workspace/main.py", "content": "print('hello')"},
    "result": "file://.stigmer/sandbox/ses-abc123/workspace/main.py"
  }
}
```

**Storage**:
- `agent_executions` table, `status.tool_calls[].result` JSON
- Actual artifact: `file://.stigmer/sandbox/ses-abc123/workspace/main.py`

### Backend Abstraction for Artifacts

The **Backend Interface** (defined in proto) includes artifact storage operations:

```protobuf
service BackendService {
  // Store artifact (upload to S3/R2/filesystem)
  rpc StoreArtifact(StoreArtifactRequest) returns (StoreArtifactResponse);
  
  // Retrieve artifact (download from S3/R2/filesystem)
  rpc GetArtifact(GetArtifactRequest) returns (GetArtifactResponse);
}

message StoreArtifactRequest {
  string execution_id = 1;
  string artifact_name = 2;
  bytes artifact_data = 3;
  string content_type = 4;
}

message StoreArtifactResponse {
  string artifact_url = 1;  // Reference to stored artifact
  int64 size_bytes = 2;
}
```

**Local Backend**: Stores artifacts in `~/.stigmer/artifacts/{execution_id}/{artifact_name}`
**Cloud Backend**: Stores artifacts in S3/R2 with signed URLs

### Why No "artifacts" Table?

**Design Decision**: Artifacts are **referenced** in execution output, not stored in database.

**Benefits:**
1. **Database Size**: SQLite stays small (no binary blobs)
2. **Performance**: No need to query large binary data
3. **Flexibility**: Can use different storage backends (S3, R2, filesystem)
4. **Scalability**: Object storage scales better than SQLite for large files
5. **Proto Alignment**: Backend interface includes artifact operations

**Alternative (not chosen)**: Store artifacts as BLOBs in SQLite.
- ❌ Database size explodes with large artifacts
- ❌ Poor query performance (scanning BLOBs)
- ❌ No streaming support (SQLite loads full BLOB into memory)
- ❌ Harder to migrate to cloud backend later

## Lessons Learned

### 1. Always Derive Schema from Proto Definitions

**Wrong Approach**: Guess what tables are needed based on intuition.

**Right Approach**: Scan proto files, extract `ApiResourceKind` enum, create one table per kind.

**Why This Matters**:
- Guarantees API-storage parity (no drift)
- Enables code generation (proto → CRUD)
- Makes schema evolution predictable (proto change → schema change)

### 2. Secrets Are Context-Scoped, Not Global

**Wrong Approach**: Create a `secrets` table with `(key, value, owner)` tuples.

**Right Approach**: Secrets are always part of `Environment` or `ExecutionContext`.

**Why This Matters**:
- Clear ownership and lifecycle (ephemeral vs. long-lived)
- Automatic cleanup (delete execution → delete secrets)
- Layered merging (base env + prod env + team env)

### 3. Logs Are Part of Execution State, Not Separate

**Wrong Approach**: Create an `execution_logs` table with `(execution_id, timestamp, message)`.

**Right Approach**: Logs stored in `status.messages[]` or `status.tasks[]` JSON.

**Why This Matters**:
- Atomic updates (execution + logs updated together)
- Simpler queries (one query, no joins)
- Proto alignment (matches actual API structure)

### 4. Artifacts Live in Object Storage, Not Database

**Wrong Approach**: Store artifact BLOBs in an `artifacts` table.

**Right Approach**: Store artifact references in execution output, actual files in S3/filesystem.

**Why This Matters**:
- Database stays small and fast
- Supports large files (GBs) without SQLite limitations
- Easy to migrate to cloud backend (just change storage layer)

## Summary Table

| Concept | Wrong Approach | Right Approach | Proto Source |
|---------|----------------|----------------|--------------|
| **Executions** | Single `executions` table | `agent_executions` + `workflow_executions` | `agentexecution/v1/api.proto`<br>`workflowexecution/v1/api.proto` |
| **Secrets** | `secrets` table | `environments.spec.data`<br>`execution_contexts.spec.data` | `environment/v1/spec.proto`<br>`executioncontext/v1/spec.proto` |
| **Logs** | `execution_logs` table | `agent_executions.status.messages[]`<br>`workflow_executions.status.tasks[]` | `agentexecution/v1/api.proto`<br>`workflowexecution/v1/api.proto` |
| **Artifacts** | `artifacts` table (BLOBs) | Object storage (S3/R2/filesystem)<br>References in execution output | Backend interface (to be defined) |
| **Instances** | Missing | `agent_instances`<br>`workflow_instances` | `agentinstance/v1/spec.proto`<br>`workflowinstance/v1/spec.proto` |
| **Sessions** | Missing | `sessions` | `session/v1/spec.proto` |
| **Skills** | Missing | `skills` | `skill/v1/spec.proto` |

## Next Steps

1. ✅ **Approve new schema design** (`002-database-schema-from-protos.md`)
2. ⏳ **Create SQL migration files** based on approved schema
3. ⏳ **Implement Local Backend** with proto-aligned CRUD operations
4. ⏳ **Add encryption layer** for secrets in `environments` and `execution_contexts`
5. ⏳ **Implement artifact storage** (local filesystem for Local Backend)

---

**Key Takeaway**: Database schema MUST be derived from proto definitions, not invented ad-hoc. This ensures API-storage parity and enables seamless migration from local to cloud backend.
