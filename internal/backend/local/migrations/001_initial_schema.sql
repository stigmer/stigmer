-- Initial Stigmer Local Backend Schema
-- Based on API Resource Kinds from Stigmer protobuf definitions
-- Simplified for single-tenant local mode (no org_id, no owner_scope)

-- Enable WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- AGENTIC: Agents
-- ============================================================================

CREATE TABLE agents (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status (stored as JSON for flexibility)
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  -- Indexes
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_agents_created_at ON agents(created_at);
CREATE INDEX idx_agents_slug ON agents(slug);

-- ============================================================================
-- AGENTIC: Agent Instances  
-- ============================================================================

CREATE TABLE agent_instances (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_agent_instances_created_at ON agent_instances(created_at);

-- ============================================================================
-- AGENTIC: Workflows
-- ============================================================================

CREATE TABLE workflows (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_workflows_created_at ON workflows(created_at);
CREATE INDEX idx_workflows_slug ON workflows(slug);

-- ============================================================================
-- AGENTIC: Workflow Instances
-- ============================================================================

CREATE TABLE workflow_instances (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_workflow_instances_created_at ON workflow_instances(created_at);

-- ============================================================================
-- EXECUTION: Sessions (Agent Conversations)
-- ============================================================================

CREATE TABLE sessions (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_sessions_created_at ON sessions(created_at);

-- ============================================================================
-- EXECUTION: Agent Executions
-- ============================================================================

CREATE TABLE agent_executions (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  -- Frequently queried fields (virtual columns from JSON)
  agent_instance_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.agentInstanceId')) STORED,
  execution_status TEXT GENERATED ALWAYS AS (json_extract(status, '$.lifecycleState')) STORED,
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_agent_executions_created_at ON agent_executions(created_at);
CREATE INDEX idx_agent_executions_agent_instance_id ON agent_executions(agent_instance_id);
CREATE INDEX idx_agent_executions_status ON agent_executions(execution_status);

-- ============================================================================
-- EXECUTION: Workflow Executions
-- ============================================================================

CREATE TABLE workflow_executions (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  -- Frequently queried fields (virtual columns from JSON)
  workflow_instance_id TEXT GENERATED ALWAYS AS (json_extract(spec, '$.workflowInstanceId')) STORED,
  execution_status TEXT GENERATED ALWAYS AS (json_extract(status, '$.lifecycleState')) STORED,
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_workflow_executions_created_at ON workflow_executions(created_at);
CREATE INDEX idx_workflow_executions_workflow_instance_id ON workflow_executions(workflow_instance_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(execution_status);

-- ============================================================================
-- ENVIRONMENT: Environments (Variables and Secrets)
-- ============================================================================

CREATE TABLE environments (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,  -- Contains variables and encrypted secrets
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_environments_created_at ON environments(created_at);
CREATE INDEX idx_environments_slug ON environments(slug);

-- ============================================================================
-- EXECUTION: Execution Contexts (Ephemeral Runtime Config)
-- ============================================================================

CREATE TABLE execution_contexts (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,  -- Contains execution-scoped variables and secrets
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_execution_contexts_created_at ON execution_contexts(created_at);

-- ============================================================================
-- KNOWLEDGE: Skills (Agent Knowledge Base)
-- ============================================================================

CREATE TABLE skills (
  -- Metadata
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  labels JSON,
  annotations JSON,
  tags JSON,
  
  -- Version tracking
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  
  -- Spec and Status
  spec JSON NOT NULL,  -- Contains markdown content
  status JSON NOT NULL,
  
  -- Audit
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  updated_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(spec)),
  CHECK(json_valid(status))
);

CREATE INDEX idx_skills_created_at ON skills(created_at);
CREATE INDEX idx_skills_slug ON skills(slug);

-- ============================================================================
-- VERSIONING: API Resource Versions (Audit Trail)
-- ============================================================================

CREATE TABLE api_resource_versions (
  -- Version identity
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  
  -- Snapshot of resource at this version
  snapshot JSON NOT NULL,
  
  -- Version metadata
  message TEXT,
  previous_version_id TEXT,
  
  -- Audit
  created_at TEXT NOT NULL,
  created_by TEXT DEFAULT 'local-user',
  
  CHECK(json_valid(snapshot))
);

CREATE INDEX idx_versions_resource_id ON api_resource_versions(resource_id);
CREATE INDEX idx_versions_resource_kind ON api_resource_versions(resource_kind);
CREATE INDEX idx_versions_created_at ON api_resource_versions(created_at);

-- ============================================================================
-- METADATA: Schema Version
-- ============================================================================

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT
);

INSERT INTO schema_version (version, applied_at, description)
VALUES (1, datetime('now'), 'Initial schema for Stigmer local backend');
