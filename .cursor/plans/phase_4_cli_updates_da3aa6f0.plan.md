---
name: Phase 4 CLI Updates
overview: Fix CLI compilation errors and update to org/slug model by removing all ApiResourceOwnerScope references and adding smart org/slug reference parsing. The CLI is currently broken and cannot compile due to Phase 1 proto changes.
todos:
  - id: subtask-1
    content: Create reference parsing package (pkg/reference/) with Parse, MustParse, ID detection functions and comprehensive tests
    status: completed
  - id: subtask-2
    content: Fix deployer.go and applier.go - remove all OwnerScope defaulting (10 locations)
    status: completed
  - id: subtask-3
    content: Fix run_resolve.go - update resolveAgent() and resolveWorkflow() to use reference parser and remove Scope field
    status: completed
  - id: subtask-4
    content: Fix mcpserver.go - update get/delete commands to use reference parser and remove Scope field
    status: completed
  - id: subtask-5
    content: Fix skill.go - remove Scope field from PushSkillRequest (2 locations)
    status: completed
  - id: subtask-6
    content: Fix run_create.go - remove OwnerScope from execution metadata (2 locations)
    status: completed
  - id: subtask-7
    content: Documentation, tests, and final verification - update help text, run test suite, create changelog
    status: completed
isProject: false
---

# Phase 4: CLI Updates for org/slug Model

## Critical Finding: CLI is Currently Broken

The CLI cannot compile due to Phase 1 proto changes that removed `ApiResourceOwnerScope`. This is a **critical fix**, not just an enhancement.

**Compile errors in 6 CLI files (18 locations):**


| File                                | Error Type                         | Locations |
| ----------------------------------- | ---------------------------------- | --------- |
| `internal/cli/deploy/deployer.go`   | `OwnerScope` on metadata           | 8         |
| `internal/cli/artifact/skill.go`    | `Scope` in `PushSkillRequest`      | 2         |
| `internal/cli/mcpserver/applier.go` | `OwnerScope` on metadata           | 2         |
| `cmd/stigmer/root/run_resolve.go`   | `Scope` in `ApiResourceReference`  | 2         |
| `cmd/stigmer/root/mcpserver.go`     | `Scope` in `ApiResourceReference`  | 2         |
| `cmd/stigmer/root/run_create.go`    | `OwnerScope` on execution metadata | 2         |


## Architecture: Reference Parsing

The SDK already has excellent reference parsing in [sdk/go/skill/skill.go](client-apps/cli/../../sdk/go/skill/skill.go). We will create a similar CLI-specific package.

```mermaid
flowchart TD
    subgraph input [User Input]
        A[org/slug] 
        B[org/slug@version]
        C[agt_xxx / wf_xxx]
        D[slug-only]
    end
    
    subgraph parser [pkg/reference Parser]
        E[Parse] --> F{Contains /}
        F -->|Yes| G[Extract org + slug]
        F -->|No| H{Has ID prefix}
        H -->|Yes| I[Return as ID]
        H -->|No| J[Use context org + slug]
        G --> K{Contains @}
        K -->|Yes| L[Extract version]
        K -->|No| M[No version]
    end
    
    subgraph output [Result]
        N[ParsedReference]
    end
    
    A --> E
    B --> E
    C --> E
    D --> E
    L --> N
    M --> N
    I --> N
    J --> N
```



**ParsedReference struct:**

```go
type ParsedReference struct {
    Org     string // Extracted or from context
    Slug    string // Resource slug
    Version string // Optional version (for skills)
    IsID    bool   // True if reference is a resource ID
    ID      string // The ID value if IsID is true
}
```

## Sub-Tasks

### Sub-Task 1: Create Reference Parsing Package (60 min)

**Goal:** Create a reusable, well-tested parsing package for org/slug references.

**Create:** [client-apps/cli/pkg/reference/](client-apps/cli/pkg/reference/)

- `reference.go` (~100 lines) - Core parsing logic
- `errors.go` (~40 lines) - Error types with context
- `reference_test.go` (~200 lines) - Comprehensive table-driven tests

**Key functions:**

```go
// Parse parses a reference string, detecting IDs vs org/slug format
func Parse(ref string, contextOrg string) (*ParsedReference, error)

// MustParse panics on error (for tests/init)
func MustParse(ref string, contextOrg string) *ParsedReference

// ID prefix detection
func IsAgentID(ref string) bool    // agt_
func IsWorkflowID(ref string) bool // wf_
func IsMcpServerID(ref string) bool // mcp- or UUID format
```

**Test cases:**

- `stigmer/web-search` → org=stigmer, slug=web-search
- `stigmer/web-search@v1.0` → org=stigmer, slug=web-search, version=v1.0
- `web-search` (with contextOrg="acme") → org=acme, slug=web-search
- `agt_abc123` → IsID=true, ID=agt_abc123
- Empty, missing slash, empty org/slug → appropriate errors

**Acceptance criteria:**

- All tests pass
- `go build ./pkg/reference/...` succeeds
- Error messages follow CLI guidelines (wrapped with context)

---

### Sub-Task 2: Fix Core Infrastructure - Deployer & Applier (45 min)

**Goal:** Remove `OwnerScope` defaulting from deployment infrastructure to restore compilation.

**Files to modify:**

1. **[deployer.go](client-apps/cli/internal/cli/deploy/deployer.go)** - Remove 8 locations:
  - Lines 244-245: Remove OwnerScope check/set for agent
  - Lines 272-273: Remove OwnerScope check/set for workflow
  - Lines 310-311: Remove OwnerScope check/set in `deployAgents`
  - Lines 353-354: Remove OwnerScope check/set in `deployWorkflows`
2. **[applier.go](client-apps/cli/internal/cli/mcpserver/applier.go)** - Remove 2 locations:
  - Lines 58-59: Remove OwnerScope defaulting

**Change pattern:**

```go
// BEFORE (remove this block entirely)
if agent.Metadata.OwnerScope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
    agent.Metadata.OwnerScope = apiresource.ApiResourceOwnerScope_organization
}

// AFTER: No replacement needed - org is already set on metadata
// The backend uses org from metadata, not OwnerScope
```

**Acceptance criteria:**

- `go build ./internal/cli/deploy/...` succeeds
- `go build ./internal/cli/mcpserver/...` succeeds
- Existing tests pass

---

### Sub-Task 3: Fix Run Resolve Functions (45 min)

**Goal:** Update agent/workflow resolution to use new parsing and remove `Scope` field.

**File:** [run_resolve.go](client-apps/cli/cmd/stigmer/root/run_resolve.go)

**Changes:**

1. **Import reference package:**

```go
import "github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
```

1. **Update `resolveAgent**` (lines 72-99):

```go
func resolveAgent(ref string, orgID string, conn *grpc.ClientConn) (*agentv1.Agent, error) {
    client := agentv1.NewAgentQueryControllerClient(conn)
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    // Parse reference (handles ID detection and org/slug parsing)
    parsed, err := reference.Parse(ref, orgID)
    if err != nil {
        return nil, errors.Wrap(err, "invalid agent reference")
    }

    if parsed.IsID {
        agent, err := client.Get(ctx, &agentv1.AgentId{Value: parsed.ID})
        if err != nil {
            return nil, errors.Wrap(err, "agent not found")
        }
        return agent, nil
    }

    // Lookup by org/slug using GetByReference (no Scope field)
    agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
        Org:  parsed.Org,
        Kind: apiresourcekind.ApiResourceKind_agent,
        Slug: parsed.Slug,
    })
    if err != nil {
        return nil, errors.Wrap(err, "agent not found")
    }
    return agent, nil
}
```

1. **Update `resolveWorkflow**` - Same pattern as agent

**Acceptance criteria:**

- `go build ./cmd/stigmer/...` succeeds (for these functions)
- Resolution works with: `agt_xxx`, `org/slug`, `slug` (with context org)
- Error messages are clear and contextual

---

### Sub-Task 4: Fix MCP Server Commands (45 min)

**Goal:** Update MCP server get/delete commands to use new parsing and remove `Scope` field.

**File:** [mcpserver.go](client-apps/cli/cmd/stigmer/root/mcpserver.go)

**Changes:**

1. **Line 384** - Update get command resolution:

```go
// BEFORE
&apiresource.ApiResourceReference{
    Scope: apiresource.ApiResourceOwnerScope_organization,
    Org:   orgID,
    Kind:  apiresourcekind.ApiResourceKind_mcp_server,
    Slug:  reference,
}

// AFTER - use reference parser
parsed, err := reference.Parse(nameOrID, orgID)
if err != nil {
    return errors.Wrap(err, "invalid MCP server reference")
}
// Then use parsed.Org, parsed.Slug or parsed.ID
```

1. **Line 603** - Update delete command resolution (same pattern)
2. **Update help text** (line 37) - Remove mention of platform/personal scopes:

```go
// BEFORE
"Support platform, organization, and personal scopes"

// AFTER  
"Resources are identified by org/slug format (e.g., stigmer/github)"
```

**Acceptance criteria:**

- `go build ./cmd/stigmer/root/...` succeeds
- `stigmer mcp get org/slug` works
- `stigmer mcp get mcp-xxx` works (ID format)
- `stigmer mcp delete org/slug` works

---

### Sub-Task 5: Fix Skill Push (45 min)

**Goal:** Remove `Scope` field from skill push requests.

**File:** [skill.go](client-apps/cli/internal/cli/artifact/skill.go)

**Changes at lines 212 and 333:**

```go
// BEFORE
req := &skillv1.PushSkillRequest{
    Scope:    apiresource.ApiResourceOwnerScope_organization,
    Org:      orgID,
    Slug:     slug,
    // ...
}

// AFTER - Remove Scope field entirely
req := &skillv1.PushSkillRequest{
    Org:      orgID,
    Slug:     slug,
    // ...
}
```

**Verification:**

- Check `PushSkillRequest` proto definition to confirm fields
- Ensure org is properly passed through

**Acceptance criteria:**

- `go build ./internal/cli/artifact/...` succeeds
- `stigmer skill push` command works
- Skill artifacts are pushed to correct organization

---

### Sub-Task 6: Fix Run Create (30 min)

**Goal:** Remove `OwnerScope` from execution metadata creation.

**File:** [run_create.go](client-apps/cli/cmd/stigmer/root/run_create.go)

**Changes:**

1. **Line 35** - Agent execution metadata:

```go
// BEFORE
Metadata: &apiresource.ApiResourceMetadata{
    OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
},

// AFTER - Remove OwnerScope, keep other fields
Metadata: &apiresource.ApiResourceMetadata{
    Org: orgID,
},
```

1. **Line 72** - Workflow execution metadata:

```go
// BEFORE
Metadata: &apiresource.ApiResourceMetadata{
    OwnerScope: apiresource.ApiResourceOwnerScope_organization,
},

// AFTER
Metadata: &apiresource.ApiResourceMetadata{
    Org: orgID,
},
```

**Acceptance criteria:**

- `go build ./cmd/stigmer/...` succeeds
- `stigmer run` creates executions successfully
- Executions are associated with correct organization

---

### Sub-Task 7: Documentation, Tests & Final Verification (30 min)

**Goal:** Update documentation, run full test suite, verify all commands work.

**Documentation updates:**

- Update command examples to show `org/slug` format
- Remove any remaining scope references in help text
- Update [client-apps/cli/docs/](client-apps/cli/docs/) if needed

**Verification checklist:**

- `go build ./...` succeeds for entire CLI
- `go test ./...` passes
- `go vet ./...` passes
- No linter errors
- Manual test: `stigmer run stigmer/my-agent`
- Manual test: `stigmer mcp get stigmer/github`
- Manual test: `stigmer skill push`

**Changelog:**

- Create `_changelog/2026-01/2026-01-31-HHMMSS-cli-scope-removal.md`

## File Impact Summary


| File                                | Lines Changed | Type               |
| ----------------------------------- | ------------- | ------------------ |
| `pkg/reference/reference.go`        | +100          | New                |
| `pkg/reference/errors.go`           | +40           | New                |
| `pkg/reference/reference_test.go`   | +200          | New                |
| `internal/cli/deploy/deployer.go`   | -16           | Remove scope logic |
| `internal/cli/mcpserver/applier.go` | -4            | Remove scope logic |
| `internal/cli/artifact/skill.go`    | -4            | Remove Scope field |
| `cmd/stigmer/root/run_resolve.go`   | ~20           | Update resolution  |
| `cmd/stigmer/root/mcpserver.go`     | ~20           | Update resolution  |
| `cmd/stigmer/root/run_create.go`    | -4            | Remove OwnerScope  |


**Estimated total:** ~380 lines added, ~50 lines removed

## Notes on Go Backend

There are also compile errors in Go backend services (`backend/services/stigmer-server/`, `backend/services/workflow-runner/`). These are **out of scope** for Phase 4 but will need addressing:

- 6 controller files in stigmer-server
- 3 files in workflow-runner

These should be tracked as a separate task (Phase 3 Go backend cleanup).