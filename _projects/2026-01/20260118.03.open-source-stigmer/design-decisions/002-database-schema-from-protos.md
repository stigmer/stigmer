# Database Schema Design (Based on Proto Analysis)

**Created**: 2026-01-18
**Status**: DRAFT - Awaiting Review
**Updated**: 2026-01-18 (Removed multi-tenancy fields for open source)

## Executive Summary

This document defines the SQLite database schema for the **Open Source Local Backend**, derived **directly from the Stigmer API protobuf definitions**. Every table corresponds to an actual `ApiResourceKind` enum value, ensuring perfect alignment between the proto API and database storage.

### Key Differences from Stigmer Cloud

**Open Source (Local Mode)**:
- ✅ Single tenant (implicit "local" organization)
- ✅ No user accounts (implicit "local-user")
- ✅ No access control (trust the local user)
- ❌ No `org_id` field (removed)
- ❌ No `owner_scope` field (removed)
- ❌ No IAM tables (organizations, identity_accounts, api_keys, iam_policies)

**Stigmer Cloud (SaaS)**:
- Multi-tenant with organizations
- User accounts and authentication
- IAM policies and access control
- All resources scoped to organizations

**Result**: Simplified schema with 12 tables (vs. 15+ in cloud version)

## Design Principle

**The database schema MUST mirror the proto API structure, adapted for open source (single-tenant) use.**

- ✅ One table per `ApiResourceKind` (from `api_resource_kind.proto`)
- ✅ Table columns match proto message fields (from `spec.proto` and `api.proto`)
- ✅ No arbitrary tables invented without proto backing
- ❌ No "secrets" table (secrets are stored in `environment` and `execution_context`)
- ❌ No separate "logs" table (logs are part of execution status)
- ❌ **No `org_id` or `owner_scope` fields** (Stigmer Cloud multi-tenancy, removed for open source)

## Open Source vs. Cloud Differences

### Fields Removed for Open Source

These fields are **Stigmer Cloud specific** and will be removed from open source protos:

1. **`org_id`** - Organization identifier (multi-tenancy)
   - Cloud: Required for tenant isolation
   - Open Source: Implicit single tenant, no need for org_id

2. **`owner_scope`** - Resource visibility scope (platform/organization/identity_account)
   - Cloud: Controls who can see/access resources
   - Open Source: All resources owned by local user, no scope needed

### Simplified Local Model

**Open Source**: Single user, implicit "local" organization
- All resources belong to the local user
- No tenant isolation needed
- No access control enforcement (trust the local user)

**Cloud**: Multi-tenant with organizations
- Resources scoped to organizations
- Tenant isolation enforced
- IAM policies control access

## API Resources → Database Tables Mapping

Based on analysis of `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/apis/`:

### Core API Resources (All Resources)

Every API resource has this standard structure:

```protobuf
message SomeResource {
  string api_version = 1;  // e.g., "agentic.stigmer.ai/v1"
  string kind = 2;         // e.g., "Agent"
  ApiResourceMetadata metadata = 3;
  SomeResourceSpec spec = 4;
  SomeResourceStatus status = 5;
}
```

**Common Table Pattern (applies to ALL tables):**

```sql
CREATE TABLE <resource_kind> (
  -- Metadata fields (from ApiResourceMetadata, simplified for open source)
  id TEXT PRIMARY KEY,           -- metadata.id (e.g., "agt-abc123")
  name TEXT NOT NULL,            -- metadata.name
  slug TEXT NOT NULL UNIQUE,     -- metadata.slug (globally unique in local mode)
  labels JSON,                   -- metadata.labels (JSON map)
  annotations JSON,              -- metadata.annotations (JSON map)
  tags JSON,                     -- metadata.tags (JSON array)
  
  -- Version tracking (from ApiResourceMetadata.version)
  version_id TEXT,               -- metadata.version.id
  version_message TEXT,          -- metadata.version.message
  previous_version_id TEXT,      -- metadata.version.previous_version_id
  
  -- Spec (from <Resource>Spec proto)
  spec JSON NOT NULL,            -- Full spec as JSON
  
  -- Status (from <Resource>Status proto)
  status JSON NOT NULL,          -- Full status as JSON
  
  -- Audit fields (from ApiResourceAudit in status.audit)
  created_at TEXT NOT NULL,      -- status.audit.created_at
  updated_at TEXT NOT NULL,      -- status.audit.updated_at
  created_by TEXT,               -- status.audit.created_by (always 'local-user' in open source)
  updated_by TEXT,               -- status.audit.updated_by (always 'local-user' in open source)
  
  -- Indexes
  INDEX idx_<resource>_created_at ON <resource>(created_at)
);
```

**Key Differences from Cloud Version:**
- ❌ No `org_id` field (single tenant)
- ❌ No `owner_scope` field (no access control)
- ✅ `slug` is globally unique (no `UNIQUE(org_id, slug)`, just `UNIQUE(slug)`)
- ✅ `created_by`/`updated_by` always set to `"local-user"` (no user accounts in local mode)

## Table Definitions (From Proto Analysis)

### 1. Tenancy Resources

#### `organizations`

**NOTE**: This table is **NOT needed in open source** (Stigmer Cloud only).

In local mode, there is an implicit single "organization" (the local user).

**Removed**: This entire table will not exist in the open source schema.

### 2. IAM Resources

#### `identity_accounts`

**NOTE**: This table is **NOT needed in open source** (Stigmer Cloud only).

In local mode, there is an implicit single "local-user" identity (no authentication).

**Removed**: This entire table will not exist in the open source schema.

**Audit Trail**: All `created_by`/`updated_by` fields will be hardcoded to `"local-user"` string.

#### `api_keys`

**NOTE**: This table is **NOT needed in open source** (Stigmer Cloud only).

In local mode, there is no API authentication (trust the local user).

**Removed**: This entire table will not exist in the open source schema.

**Future**: If API keys are needed for local mode (e.g., for CLI → local backend auth), we can add a simplified version without multi-tenancy.

#### `iam_policies`

**NOTE**: This table is **NOT needed in open source** (Stigmer Cloud only).

In local mode, there is no IAM/access control (trust the local user).

**Removed**: This entire table will not exist in the open source schema.

### 3. Agentic Resources (Core)

#### `agents`

Agent templates (the "Template" layer).

**Proto Source**: `ai/stigmer/agentic/agent/v1/`

```sql
CREATE TABLE agents (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (AgentSpec)
  -- Contains: description, icon_url, instructions, mcp_servers, skill_refs, sub_agents, env_spec
  spec JSON NOT NULL,
  
  -- Status (AgentStatus)
  -- Contains: default_instance_id, published status
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  INDEX idx_agents_created_at ON agents(created_at)
);
```

**Spec Fields** (from `agent/v1/spec.proto`):
- `description`: Human-readable description
- `icon_url`: Icon for UI display
- `instructions`: Agent behavior/personality definition
- `mcp_servers[]`: MCP server definitions (stdio/http/docker)
- `skill_refs[]`: References to Skill resources
- `sub_agents[]`: Inline or referenced sub-agents
- `env_spec`: Required environment variables

**Status Fields** (from `agent/v1/status.proto`):
- `default_instance_id`: Default AgentInstance ID
- `published`: Whether agent is published to marketplace

#### `agent_instances`

Configured agent deployments (the "Instance" layer).

**Proto Source**: `ai/stigmer/agentic/agentinstance/v1/`

```sql
CREATE TABLE agent_instances (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (AgentInstanceSpec)
  -- Contains: agent_id, description, environment_refs
  spec JSON NOT NULL,
  
  -- Status (AgentInstanceStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized column for fast queries
  agent_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.agent_id')) VIRTUAL,
  
  INDEX idx_agent_instances_created_at ON agent_instances(created_at),
  INDEX idx_agent_instances_agent_id ON agent_instances(agent_id)
);
```

**Spec Fields** (from `agentinstance/v1/spec.proto`):
- `agent_id`: Reference to Agent template
- `description`: Human-readable description
- `environment_refs[]`: References to Environment resources (layered)

#### `sessions`

Agent conversation sessions (the "Execution" layer for conversational agents).

**Proto Source**: `ai/stigmer/agentic/session/v1/`

```sql
CREATE TABLE sessions (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (SessionSpec)
  -- Contains: agent_instance_id, subject, thread_id, sandbox_id, metadata
  spec JSON NOT NULL,
  
  -- Status (SessionStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized column for fast queries
  agent_instance_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.agent_instance_id')) VIRTUAL,
  
  INDEX idx_sessions_created_at ON sessions(created_at),
  INDEX idx_sessions_agent_instance_id ON sessions(agent_instance_id)
);
```

**Spec Fields** (from `session/v1/spec.proto`):
- `agent_instance_id`: Which AgentInstance this session runs against
- `subject`: Conversation title/subject
- `thread_id`: LangGraph thread ID (persistent across executions)
- `sandbox_id`: Daytona sandbox ID (for file persistence)
- `metadata`: Session metadata (client info, tags)

#### `agent_executions`

Individual agent execution instances (one message-response cycle).

**Proto Source**: `ai/stigmer/agentic/agentexecution/v1/`

```sql
CREATE TABLE agent_executions (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (AgentExecutionSpec)
  -- Contains: session_id, agent_id, message, execution_config, runtime_env
  spec JSON NOT NULL,
  
  -- Status (AgentExecutionStatus)
  -- Contains: messages[], phase, tool_calls[], sub_agent_executions[], error, timestamps, todos
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized columns for fast queries
  session_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.session_id')) VIRTUAL,
  phase TEXT GENERATED ALWAYS AS (json_extract(status, '$.phase')) VIRTUAL,
  started_at TEXT GENERATED ALWAYS AS (json_extract(status, '$.started_at')) VIRTUAL,
  completed_at TEXT GENERATED ALWAYS AS (json_extract(status, '$.completed_at')) VIRTUAL,
  
  INDEX idx_agent_executions_created_at ON agent_executions(created_at),
  INDEX idx_agent_executions_session_id ON agent_executions(session_id),
  INDEX idx_agent_executions_phase ON agent_executions(phase),
  INDEX idx_agent_executions_started_at ON agent_executions(started_at)
);
```

**Spec Fields** (from `agentexecution/v1/spec.proto`):
- `session_id`: Session this execution belongs to (optional)
- `agent_id`: Agent template to execute (optional, used if no session_id)
- `message`: User input message
- `execution_config`: Execution-time config (model override, etc.)
- `runtime_env`: Execution-scoped environment variables/secrets

**Status Fields** (from `agentexecution/v1/api.proto`):
- `messages[]`: Sequential stream of execution events (user/AI/tool/system messages)
- `phase`: Lifecycle phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
- `tool_calls[]`: Tool invocations (tracked separately for querying)
- `sub_agent_executions[]`: Sub-agent delegations
- `error`: Error message (if failed)
- `started_at`: Start timestamp
- `completed_at`: Completion timestamp
- `todos`: Todo list (if TodoListMiddleware enabled)

#### `skills`

Agent knowledge base entries (Markdown content).

**Proto Source**: `ai/stigmer/agentic/skill/v1/`

```sql
CREATE TABLE skills (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (SkillSpec)
  -- Contains: description, markdown_content
  spec JSON NOT NULL,
  
  -- Status (SkillStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Full-text search on markdown content
  markdown_content TEXT GENERATED ALWAYS AS (json_extract(spec, '$.markdown_content')) VIRTUAL,
  
  INDEX idx_skills_created_at ON skills(created_at)
);

-- Full-text search virtual table for skill content
CREATE VIRTUAL TABLE skills_fts USING fts5(
  id UNINDEXED,
  markdown_content,
  content=skills,
  content_rowid=rowid
);
```

**Spec Fields** (from `skill/v1/spec.proto`):
- `description`: Brief description
- `markdown_content`: Full skill documentation (Markdown)

### 4. Workflow Resources

#### `workflows`

Workflow templates (the "Template" layer).

**Proto Source**: `ai/stigmer/agentic/workflow/v1/`

```sql
CREATE TABLE workflows (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (WorkflowSpec)
  -- Contains: description, document, tasks[], env_spec
  spec JSON NOT NULL,
  
  -- Status (WorkflowStatus)
  -- Contains: default_instance_id
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  INDEX idx_workflows_created_at ON workflows(created_at)
);
```

**Spec Fields** (from `workflow/v1/spec.proto`):
- `description`: Human-readable description
- `document`: Workflow metadata (DSL version, namespace, name, version)
- `tasks[]`: List of WorkflowTask (name, kind, task_config, export, flow)
- `env_spec`: Required environment variables

**Status Fields** (from `workflow/v1/status.proto`):
- `default_instance_id`: Default WorkflowInstance ID

#### `workflow_instances`

Configured workflow deployments (the "Instance" layer).

**Proto Source**: `ai/stigmer/agentic/workflowinstance/v1/`

```sql
CREATE TABLE workflow_instances (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (WorkflowInstanceSpec)
  -- Contains: workflow_id, description, env_refs
  spec JSON NOT NULL,
  
  -- Status (WorkflowInstanceStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized column for fast queries
  workflow_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.workflow_id')) VIRTUAL,
  
  INDEX idx_workflow_instances_created_at ON workflow_instances(created_at),
  INDEX idx_workflow_instances_workflow_id ON workflow_instances(workflow_id)
);
```

**Spec Fields** (from `workflowinstance/v1/spec.proto`):
- `workflow_id`: Reference to Workflow template
- `description`: Human-readable description
- `env_refs[]`: References to Environment resources (layered)

#### `workflow_executions`

Workflow execution instances (the "Execution" layer).

**Proto Source**: `ai/stigmer/agentic/workflowexecution/v1/`

```sql
CREATE TABLE workflow_executions (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (WorkflowExecutionSpec)
  -- Contains: workflow_instance_id, workflow_id, trigger_message, trigger_metadata, runtime_env
  spec JSON NOT NULL,
  
  -- Status (WorkflowExecutionStatus)
  -- Contains: phase, tasks[], output, error, started_at, completed_at, temporal_workflow_id
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized columns for fast queries
  workflow_instance_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.workflow_instance_id')) VIRTUAL,
  phase TEXT GENERATED ALWAYS AS (json_extract(status, '$.phase')) VIRTUAL,
  started_at TEXT GENERATED ALWAYS AS (json_extract(status, '$.started_at')) VIRTUAL,
  completed_at TEXT GENERATED ALWAYS AS (json_extract(status, '$.completed_at')) VIRTUAL,
  
  INDEX idx_workflow_executions_created_at ON workflow_executions(created_at),
  INDEX idx_workflow_executions_workflow_instance_id ON workflow_executions(workflow_instance_id),
  INDEX idx_workflow_executions_phase ON workflow_executions(phase),
  INDEX idx_workflow_executions_started_at ON workflow_executions(started_at)
);
```

**Spec Fields** (from `workflowexecution/v1/spec.proto`):
- `workflow_instance_id`: Which WorkflowInstance to execute (optional)
- `workflow_id`: Direct Workflow reference (optional, auto-resolves to default instance)
- `trigger_message`: Input message/payload
- `trigger_metadata`: Who/what triggered this (source, caller_id, IP, etc.)
- `runtime_env`: Execution-specific environment overrides

**Status Fields** (from `workflowexecution/v1/api.proto`):
- `phase`: Lifecycle phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
- `tasks[]`: Workflow tasks with execution state (task_id, task_name, task_type, status, input, output, error, timestamps)
- `output`: Final workflow output (JSON, only when COMPLETED)
- `error`: Error message (if FAILED)
- `started_at`: Start timestamp
- `completed_at`: Completion timestamp
- `temporal_workflow_id`: Correlation ID for Temporal engine

### 5. Environment & Context Resources

#### `environments`

Environment variable and secret collections (configuration containers).

**Proto Source**: `ai/stigmer/agentic/environment/v1/`

```sql
CREATE TABLE environments (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (EnvironmentSpec)
  -- Contains: description, data (map<string, EnvironmentValue>)
  -- EnvironmentValue: { value, is_secret, description }
  spec JSON NOT NULL,
  
  -- Status (EnvironmentStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  INDEX idx_environments_created_at ON environments(created_at)
);
```

**Spec Fields** (from `environment/v1/spec.proto`):
- `description`: Human-readable description
- `data`: Map of key-value pairs, each with:
  - `value`: The actual value (plaintext or encrypted)
  - `is_secret`: Whether this is a secret (encrypted at rest)
  - `description`: Optional documentation

**Secret Encryption**:
- When `is_secret=true`, `value` is encrypted using OS keychain or master key
- Local Backend encrypts/decrypts on read/write
- Cloud Backend handles encryption server-side

#### `execution_contexts`

Ephemeral execution-scoped configuration (JIT secret injection).

**Proto Source**: `ai/stigmer/agentic/executioncontext/v1/`

```sql
CREATE TABLE execution_contexts (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (ExecutionContextSpec)
  -- Contains: execution_id, data (map<string, ExecutionValue>)
  -- ExecutionValue: { value, is_secret }
  spec JSON NOT NULL,
  
  -- Status (ExecutionContextStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized execution_id for fast lookups
  execution_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.execution_id')) VIRTUAL,
  
  INDEX idx_execution_contexts_created_at ON execution_contexts(created_at),
  INDEX idx_execution_contexts_execution_id ON execution_contexts(execution_id)
);
```

**Spec Fields** (from `executioncontext/v1/spec.proto`):
- `execution_id`: Which execution this context belongs to (WorkflowExecution or AgentExecution)
- `data`: Map of key-value pairs, each with:
  - `value`: The actual value
  - `is_secret`: Whether this is a secret (encrypted, redacted in logs)

**Lifecycle**:
- Created when execution starts (if runtime_env provided)
- Deleted when execution completes (ephemeral secrets)
- Only accessible to the associated execution (JIT pattern)

### 6. Versioning Resources

#### `api_resource_versions`

Audit trail for all resource changes.

**Proto Source**: `ai/stigmer/agentic/apiresourceversion/v1/` (inferred, not in codebase yet)

```sql
CREATE TABLE api_resource_versions (
  -- Standard columns (open source simplified)
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,  -- Globally unique in local mode
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec (ApiResourceVersionSpec)
  -- Contains: resource_kind, resource_id, version_data
  spec JSON NOT NULL,
  
  -- Status (ApiResourceVersionStatus)
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,              -- Always 'local-user' in open source
  updated_by TEXT,              -- Always 'local-user' in open source
  
  -- Denormalized columns for fast queries
  resource_kind TEXT GENERATED ALWAYS AS (json_extract(spec, '$.resource_kind')) VIRTUAL,
  resource_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.resource_id')) VIRTUAL,
  
  INDEX idx_api_resource_versions_created_at ON api_resource_versions(created_at),
  INDEX idx_api_resource_versions_resource ON api_resource_versions(resource_kind, resource_id)
);
```

**Purpose**:
- Capture full resource state at each update
- Enable version history and rollback
- Support audit compliance requirements

## Database Schema Principles

### 1. Proto-First Design

**Every table MUST correspond to an `ApiResourceKind` enum value.**

This ensures:
- Database schema stays in sync with proto API
- No drift between API and storage layer
- Code generation can create CRUD operations automatically

### 2. JSON for Flexibility

**Store `spec` and `status` as JSON columns.**

Why:
- Proto definitions evolve over time (new fields added)
- SQLite JSON functions enable querying nested fields
- No schema migrations needed for proto changes
- Perfect round-trip: proto → JSON → SQLite → JSON → proto

**When to denormalize:**
- High-frequency query fields (e.g., `phase`, `started_at`)
- Use GENERATED VIRTUAL columns for fast indexed access

### 3. Common Table Structure

**All tables share the same base structure:**
1. Metadata columns (id, org_id, name, slug, owner_scope, labels, tags, version)
2. Spec JSON column (user inputs)
3. Status JSON column (system state)
4. Audit columns (created_at, updated_at, created_by, updated_by)

**Benefits:**
- Consistent query patterns across all resources
- Shared CRUD logic (single backend implementation)
- Easy to add new resource types (just add table + proto)

### 4. Indexing Strategy

**Required indexes for all tables:**
- PRIMARY KEY on `id`
- UNIQUE on `(org_id, slug)`
- INDEX on `org_id` (tenant isolation)
- INDEX on `created_at` (time-based queries)

**Additional indexes based on query patterns:**
- Execution tables: `phase`, `started_at`, `completed_at`
- Instance tables: Reference to template (e.g., `agent_id`, `workflow_id`)
- Context tables: `execution_id`

### 5. Secret Storage

**Secrets are NOT stored in a separate table.**

Secrets are stored in:
1. **`environments` table**: Long-lived secrets (API keys, credentials)
   - `spec.data` map contains `EnvironmentValue` with `is_secret=true`
   - Encrypted using OS keychain or master key file
2. **`execution_contexts` table**: Ephemeral execution-scoped secrets
   - `spec.data` map contains `ExecutionValue` with `is_secret=true`
   - Deleted when execution completes (JIT pattern)

**Encryption:**
- Local Backend: AES-256-GCM with key from OS keychain
- Cloud Backend: Handled server-side (HashiCorp Vault)

## Migration Strategy

### Phase 1: Initial Schema

Create all tables with the common structure.

**Migration file**: `001_initial_schema.sql`

```sql
-- NOTE: No organizations, identity_accounts, api_keys, iam_policies tables
-- These are Stigmer Cloud multi-tenancy features, not in open source

-- Agentic (Agents)
CREATE TABLE agents (...);
CREATE TABLE agent_instances (...);
CREATE TABLE sessions (...);
CREATE TABLE agent_executions (...);
CREATE TABLE skills (...);
CREATE VIRTUAL TABLE skills_fts USING fts5(...);

-- Agentic (Workflows)
CREATE TABLE workflows (...);
CREATE TABLE workflow_instances (...);
CREATE TABLE workflow_executions (...);

-- Environment
CREATE TABLE environments (...);
CREATE TABLE execution_contexts (...);

-- Versioning
CREATE TABLE api_resource_versions (...);

-- Enable WAL mode for concurrent access
PRAGMA journal_mode=WAL;
```

### Phase 2: Seed Data (Optional)

**NOTE**: No seed data needed for open source (no organizations table).

Local mode has an implicit single tenant - no need to create default organization.

## Query Patterns

### List Executions for a Session

```sql
SELECT
  id,
  json_extract(spec, '$.message') AS message,
  json_extract(status, '$.phase') AS phase,
  json_extract(status, '$.started_at') AS started_at,
  json_extract(status, '$.completed_at') AS completed_at
FROM agent_executions
WHERE json_extract(spec, '$.session_id') = 'ses-abc123'
ORDER BY created_at DESC;
```

### Find In-Progress Workflow Executions

```sql
SELECT
  id,
  workflow_instance_id,
  phase,
  started_at,
  json_array_length(json_extract(status, '$.tasks')) AS total_tasks,
  (
    SELECT COUNT(*)
    FROM json_each(json_extract(status, '$.tasks'))
    WHERE json_extract(value, '$.status') IN (3, 4, 5)  -- COMPLETED, FAILED, SKIPPED
  ) AS completed_tasks
FROM workflow_executions
WHERE phase = 'EXECUTION_IN_PROGRESS'
ORDER BY started_at DESC;
```

### Search Skills by Content

```sql
SELECT
  s.id,
  s.name,
  snippet(skills_fts, 1, '<mark>', '</mark>', '...', 64) AS excerpt
FROM skills s
JOIN skills_fts ON skills_fts.id = s.id
WHERE skills_fts MATCH 'kubernetes deployment'
ORDER BY rank
LIMIT 10;
```

### Get Execution with Resolved Environment

```sql
-- Get execution
SELECT * FROM agent_executions WHERE id = 'aex-abc123';

-- Get session
SELECT * FROM sessions WHERE id = (
  SELECT json_extract(spec, '$.session_id')
  FROM agent_executions
  WHERE id = 'aex-abc123'
);

-- Get agent instance
SELECT * FROM agent_instances WHERE id = (
  SELECT json_extract(spec, '$.agent_instance_id')
  FROM sessions
  WHERE id = '<session_id>'
);

-- Get environments (layered)
SELECT * FROM environments
WHERE id IN (
  SELECT value
  FROM json_each((
    SELECT json_extract(spec, '$.environment_refs')
    FROM agent_instances
    WHERE id = '<agent_instance_id>'
  ))
);

-- Merge environment data (in application code)
```

## Final Schema Summary (Open Source)

### Tables Included (11 total)

**Agentic Resources:**
1. `agents` - Agent templates
2. `agent_instances` - Configured agent deployments
3. `sessions` - Agent conversation sessions
4. `agent_executions` - Agent execution instances
5. `skills` - Agent knowledge base
6. `skills_fts` - Full-text search for skills (virtual table)
7. `workflows` - Workflow templates
8. `workflow_instances` - Configured workflow deployments
9. `workflow_executions` - Workflow execution instances

**Environment & Context:**
10. `environments` - Environment variables and secrets
11. `execution_contexts` - Ephemeral execution-scoped secrets

**Versioning:**
12. `api_resource_versions` - Audit trail for resource changes

### Tables Removed (Stigmer Cloud Only)

These tables will **NOT** exist in the open source schema:
- ❌ `organizations` - Multi-tenancy root
- ❌ `identity_accounts` - User accounts
- ❌ `api_keys` - API authentication
- ❌ `iam_policies` - Access control policies

### Fields Removed from All Tables

- ❌ `org_id` - Organization identifier
- ❌ `owner_scope` - Resource visibility scope

### Fields Simplified

- ✅ `slug` - Globally unique (no `UNIQUE(org_id, slug)`, just `UNIQUE(slug)`)
- ✅ `created_by`/`updated_by` - Always hardcoded to `"local-user"`

## Open Questions

1. **Should we denormalize more fields?**
   - Current: Only critical query fields (phase, timestamps, foreign keys)
   - Alternative: Denormalize all frequently-queried nested fields
   - Trade-off: Query speed vs. write complexity
   - **Recommendation**: Start with current approach, add more if needed

2. **Should we use WAL mode?**
   - WAL mode enables concurrent reads during writes
   - Required for multi-process access (CLI + Runner)
   - **Decision**: YES, enable WAL mode (already in migration)

3. **Should we version the schema?**
   - Track schema version in a `schema_version` table
   - Enables safe migrations and rollbacks
   - **Recommendation**: YES, add schema versioning table

## Next Steps

1. ✅ Review and approve this schema design
2. ⏳ Create SQL migration files (`001_initial_schema.sql`)
3. ⏳ Implement SQLite backend in Go (`internal/backend/local/backend.go`)
4. ⏳ Add encryption layer for secrets (OS keychain integration)
5. ⏳ Write tests for CRUD operations
6. ⏳ Benchmark query performance (SQLite vs. Cloud backend parity)

---

**Review Required**: Does this schema accurately reflect the Stigmer API protos? Any missing tables or fields?
