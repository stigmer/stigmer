# Open Source Database Schema Simplifications

**Created**: 2026-01-18
**Status**: Summary Document

## Overview

This document summarizes the changes made to the database schema to remove Stigmer Cloud multi-tenancy features for the open source version.

## Fields Removed from All Tables

### 1. `org_id` (Organization ID)

**Purpose in Cloud**: Tenant isolation - ensures resources belong to specific organizations.

**Example in Cloud**:
```sql
SELECT * FROM agents WHERE org_id = 'org-acme-corp';
```

**Why Removed for Open Source**:
- Local mode = single implicit organization
- No need for tenant isolation
- Simplifies queries (no org_id filter needed)

**Impact**:
- ❌ Removed from all tables
- ✅ Slug uniqueness changed from `UNIQUE(org_id, slug)` to `UNIQUE(slug)`
- ✅ All slugs must be globally unique within local database

### 2. `owner_scope` (Resource Visibility Scope)

**Purpose in Cloud**: Controls who can see/access resources (platform/organization/identity_account).

**Example in Cloud**:
```protobuf
enum ApiResourceOwnerScope {
  OWNER_SCOPE_UNSPECIFIED = 0;
  PLATFORM = 1;            // Visible to all (system templates)
  ORGANIZATION = 2;        // Visible to organization members
  IDENTITY_ACCOUNT = 3;    // Visible only to creator
}
```

**Why Removed for Open Source**:
- Local mode = single user
- No access control enforcement
- All resources "owned" by local user

**Impact**:
- ❌ Removed from all tables
- ✅ No scope-based filtering needed

## Tables Removed (Stigmer Cloud Only)

### 1. `organizations`

**Purpose**: Multi-tenant root entities.

**Why Removed**: Single-tenant local mode doesn't need organization management.

**Alternative**: Implicit "local" organization (never stored in database).

### 2. `identity_accounts`

**Purpose**: User accounts and authentication.

**Why Removed**: Local mode has no authentication (trust the local user).

**Alternative**: All audit fields (`created_by`, `updated_by`) hardcoded to `"local-user"`.

### 3. `api_keys`

**Purpose**: API authentication for programmatic access.

**Why Removed**: Local mode has no API authentication.

**Alternative**: If needed in the future, add simplified version without multi-tenancy.

### 4. `iam_policies`

**Purpose**: IAM authorization policies (who can do what).

**Why Removed**: Local mode has no access control.

**Alternative**: None needed (trust the local user).

## Common Table Structure (Open Source)

**Before (Cloud Version)**:
```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,          -- ❌ REMOVED
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  owner_scope INTEGER NOT NULL,  -- ❌ REMOVED
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  spec JSON NOT NULL,
  status JSON NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  
  UNIQUE(org_id, slug),          -- ❌ REMOVED
  INDEX idx_agents_org_id ON agents(org_id)  -- ❌ REMOVED
);
```

**After (Open Source Version)**:
```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  -- org_id REMOVED
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,     -- ✅ Globally unique
  -- owner_scope REMOVED
  labels JSON,
  annotations JSON,
  tags JSON,
  version_id TEXT,
  version_message TEXT,
  previous_version_id TEXT,
  spec JSON NOT NULL,
  status JSON NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,               -- ✅ Always 'local-user'
  updated_by TEXT,               -- ✅ Always 'local-user'
  
  INDEX idx_agents_created_at ON agents(created_at)
);
```

## Proto Migration Strategy

When migrating protos from Stigmer Cloud to open source:

### Fields to Remove from `ApiResourceMetadata`

```protobuf
// BEFORE (Cloud)
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  string org = 4;                      // ❌ REMOVE for open source
  ApiResourceOwnerScope owner_scope = 5; // ❌ REMOVE for open source
  map<string, string> labels = 6;
  map<string, string> annotations = 7;
  repeated string tags = 8;
  ApiResourceMetadataVersion version = 9;
}

// AFTER (Open Source)
message ApiResourceMetadata {
  string name = 1;
  string slug = 2;
  string id = 3;
  // org field REMOVED
  // owner_scope field REMOVED
  map<string, string> labels = 6;
  map<string, string> annotations = 7;
  repeated string tags = 8;
  ApiResourceMetadataVersion version = 9;
}
```

### Fields to Remove from `ApiResourceAudit`

```protobuf
// BEFORE (Cloud)
message ApiResourceAudit {
  string created_at = 1;
  string updated_at = 2;
  string created_by = 3;    // User ID in cloud
  string updated_by = 4;    // User ID in cloud
}

// AFTER (Open Source)
message ApiResourceAudit {
  string created_at = 1;
  string updated_at = 2;
  string created_by = 3;    // Always 'local-user' in open source
  string updated_by = 4;    // Always 'local-user' in open source
}
```

## Backend Implementation Changes

### Creating Resources

**Before (Cloud)**:
```go
func CreateAgent(req *CreateAgentRequest) (*Agent, error) {
  // Extract org_id from authenticated context
  orgID := auth.GetOrgIDFromContext(ctx)
  
  agent := &Agent{
    Metadata: &ApiResourceMetadata{
      Id:         generateID("agt"),
      Org:        orgID,            // Set from context
      OwnerScope: ORGANIZATION,     // Set based on request
      Name:       req.Name,
      Slug:       slugify(req.Name),
    },
    Spec: req.Spec,
  }
  
  // Check if slug unique within org
  if exists(orgID, agent.Metadata.Slug) {
    return nil, errors.New("slug already exists in organization")
  }
  
  return db.Create(agent)
}
```

**After (Open Source)**:
```go
func CreateAgent(req *CreateAgentRequest) (*Agent, error) {
  // No auth context needed (local mode)
  
  agent := &Agent{
    Metadata: &ApiResourceMetadata{
      Id:   generateID("agt"),
      // No Org field
      // No OwnerScope field
      Name: req.Name,
      Slug: slugify(req.Name),
    },
    Spec: req.Spec,
  }
  
  // Check if slug unique globally
  if exists(agent.Metadata.Slug) {
    return nil, errors.New("slug already exists")
  }
  
  // Set audit fields to 'local-user'
  agent.Status.Audit = &ApiResourceAudit{
    CreatedAt: time.Now().Format(time.RFC3339),
    UpdatedAt: time.Now().Format(time.RFC3339),
    CreatedBy: "local-user",
    UpdatedBy: "local-user",
  }
  
  return db.Create(agent)
}
```

### Querying Resources

**Before (Cloud)**:
```go
func ListAgents(ctx context.Context) ([]*Agent, error) {
  // Extract org_id from authenticated context
  orgID := auth.GetOrgIDFromContext(ctx)
  
  // Filter by organization
  return db.Query("SELECT * FROM agents WHERE org_id = ?", orgID)
}
```

**After (Open Source)**:
```go
func ListAgents(ctx context.Context) ([]*Agent, error) {
  // No org_id filter needed (single tenant)
  return db.Query("SELECT * FROM agents ORDER BY created_at DESC")
}
```

### Deleting Resources

**Before (Cloud)**:
```go
func DeleteAgent(ctx context.Context, agentID string) error {
  // Extract org_id from authenticated context
  orgID := auth.GetOrgIDFromContext(ctx)
  
  // Verify resource belongs to organization
  agent, err := db.Query("SELECT * FROM agents WHERE id = ? AND org_id = ?", agentID, orgID)
  if err != nil {
    return errors.New("agent not found or access denied")
  }
  
  return db.Delete(agent)
}
```

**After (Open Source)**:
```go
func DeleteAgent(ctx context.Context, agentID string) error {
  // No org_id check needed (trust local user)
  return db.Delete("DELETE FROM agents WHERE id = ?", agentID)
}
```

## Benefits of Simplification

### 1. Simpler Schema

**Cloud**: 15+ tables (organizations, identity_accounts, api_keys, iam_policies, etc.)
**Open Source**: 12 tables (only agentic resources + environments + versioning)

**Result**: 20% fewer tables, easier to understand and maintain.

### 2. Simpler Queries

**Cloud**: Always filter by `org_id`
```sql
SELECT * FROM agents WHERE org_id = ? AND slug = ?;
```

**Open Source**: Direct global queries
```sql
SELECT * FROM agents WHERE slug = ?;
```

**Result**: Faster queries (no join/filter), simpler code.

### 3. No Authentication/Authorization Code

**Cloud**: 
- Middleware to extract `org_id` from JWT token
- Check user permissions against IAM policies
- Verify resource ownership before every operation

**Open Source**:
- No middleware needed
- No permission checks
- Trust the local user

**Result**: Simpler backend code, faster development.

### 4. Globally Unique Slugs

**Cloud**: Slug unique within organization
- `org-acme/agt-customer-support` (ACME Corp)
- `org-techco/agt-customer-support` (TechCo)

**Open Source**: Slug globally unique
- `agt-customer-support` (only one can exist)

**Result**: Simpler slug generation, no conflicts.

## Migration Checklist

When creating the open source proto package:

- [ ] Fork `ai.stigmer.*` protos to `ai.stigmer.oss.*` (or similar namespace)
- [ ] Remove `org` field from `ApiResourceMetadata`
- [ ] Remove `owner_scope` field from `ApiResourceMetadata`
- [ ] Remove validation rules that reference `org_id` or `owner_scope`
- [ ] Remove IAM-related proto files (iam_policy, identity_account, api_key)
- [ ] Remove organization proto files
- [ ] Update validation rules for slug uniqueness (no org_id scope)
- [ ] Update examples and documentation

## Testing Strategy

### Verify No Multi-Tenancy Leakage

**Tests to Add**:
1. Verify no `org_id` column in any table
2. Verify no `owner_scope` column in any table
3. Verify slug uniqueness is global (create two resources with same slug, expect failure)
4. Verify `created_by`/`updated_by` always set to `"local-user"`
5. Verify no IAM tables exist

**Example Test**:
```go
func TestSlugGloballyUnique(t *testing.T) {
  db := setupTestDB()
  
  // Create first agent with slug "customer-support"
  agent1 := &Agent{
    Metadata: &ApiResourceMetadata{Slug: "customer-support"},
    Spec: &AgentSpec{Instructions: "First agent"},
  }
  err := db.Create(agent1)
  assert.NoError(t, err)
  
  // Try to create second agent with same slug (should fail)
  agent2 := &Agent{
    Metadata: &ApiResourceMetadata{Slug: "customer-support"},
    Spec: &AgentSpec{Instructions: "Second agent"},
  }
  err = db.Create(agent2)
  assert.Error(t, err)
  assert.Contains(t, err.Error(), "slug already exists")
}
```

## Documentation Updates

### README.md

Update to clarify single-tenant model:

```markdown
## Local vs. Cloud Mode

**Local Mode (Open Source)**:
- Single-tenant SQLite database (`~/.stigmer/local.db`)
- No authentication (implicit "local-user")
- No organizations or access control
- Perfect for individual developers and small teams

**Cloud Mode (Stigmer Cloud SaaS)**:
- Multi-tenant with organizations
- User accounts and authentication
- IAM policies and role-based access control
- Perfect for enterprise teams and collaboration
```

### API Documentation

Update all API examples to remove `org_id`:

**Before**:
```bash
# Create agent (Cloud)
curl -X POST https://api.stigmer.io/v1/organizations/org-acme/agents \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Customer Support", "spec": {...}}'
```

**After**:
```bash
# Create agent (Open Source Local)
stigmer agent create customer-support \
  --instructions "You are a helpful customer support agent" \
  --mcp-server github
```

## Summary

**Total Changes**:
- ❌ 2 fields removed from every table (`org_id`, `owner_scope`)
- ❌ 4 tables removed entirely (organizations, identity_accounts, api_keys, iam_policies)
- ✅ Simpler schema (12 tables vs. 15+)
- ✅ Simpler queries (no org_id filtering)
- ✅ Simpler code (no auth/authz logic)
- ✅ Globally unique slugs

**Trade-offs**:
- ✅ Gain: Simplicity, faster development, easier to understand
- ❌ Lose: Multi-tenancy support (but not needed for local mode)

**Migration Path to Cloud**:
When user wants to migrate from local to cloud:
1. Export all resources as JSON
2. Upload to Stigmer Cloud via API
3. Cloud backend adds `org_id` and `owner_scope` during import
4. User's organization receives all imported resources

---

**Next Steps**: Update proto definitions to remove multi-tenancy fields for open source package.
