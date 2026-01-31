---
name: SDK Cleanup Analysis
overview: Complete SDK cleanup to remove all deprecated references (Scope, ApiResourceOwnerScope, skillref, mcpserverref packages) and align generated code with current proto definitions.
todos:
  - id: fix-workflow-proto
    content: "Fix sdk/go/workflow/proto.go: Replace OwnerScope with Visibility"
    status: completed
  - id: fix-workflow-agentref
    content: "Fix sdk/go/workflow/agent_ref.go: Remove scope concept, use org/slug model"
    status: completed
  - id: regen-sdk-code
    content: Regenerate sdk/go/gen/ code to remove Scope field from types
    status: completed
  - id: migrate-examples
    content: Migrate 7 example files to use new smart parsing API
    status: completed
  - id: migrate-tests
    content: Migrate all test files using deprecated skillref/mcpserverref
    status: completed
  - id: delete-deprecated-packages
    content: Delete sdk/go/skillref/ and sdk/go/mcpserverref/ directories
    status: completed
  - id: update-documentation
    content: Update SDK documentation to remove deprecated references
    status: completed
  - id: final-verification
    content: Run go build and go test to verify complete cleanup
    status: completed
isProject: false
---

# SDK Comprehensive Cleanup Plan

## Analysis Summary

### Proto Changes (Already Done)

The proto definitions have been updated in Phase 1:

- `**ApiResourceReference**` now has: `Org`, `Kind`, `Slug`, `Version` (NO `Scope`)
- `**ApiResourceMetadata**` now has: `Visibility` enum (NOT `OwnerScope`)
- `**ApiResourceOwnerScope**` enum has been **completely deleted**
- `**ApiResourceVisibility**` enum added: `UNSPECIFIED`, `PRIVATE`, `PUBLIC`

---

## Cleanup Tasks

### Task 1: Delete Deprecated Packages

**Delete entirely - these packages are 100% obsolete:**

- `[sdk/go/skillref/](sdk/go/skillref/)` - Uses removed `Scope` field and deleted `ApiResourceOwnerScope` enum
- `[sdk/go/mcpserverref/](sdk/go/mcpserverref/)` - Same issues

**Evidence of obsolescence:**

```go
// skillref/skillref.go - Line 28
Scope: apiresource.ApiResourceOwnerScope_platform,  // COMPILE ERROR - enum deleted

// mcpserverref/mcpserverref.go - Lines 21, 37, 55
Scope: apiresource.ApiResourceOwnerScope_platform,      // COMPILE ERROR
Scope: apiresource.ApiResourceOwnerScope_organization,  // COMPILE ERROR
Scope: apiresource.ApiResourceOwnerScope_identity_account, // COMPILE ERROR
```

---

### Task 2: Fix workflow/proto.go

**File:** `[sdk/go/workflow/proto.go](sdk/go/workflow/proto.go)`

**Current (broken):**

```go
metadata := &apiresource.ApiResourceMetadata{
    // ...
    OwnerScope: apiresource.ApiResourceOwnerScope_organization,  // DELETED
}
```

**Required fix:** Replace with `Visibility` field:

```go
metadata := &apiresource.ApiResourceMetadata{
    // ...
    Visibility: apiresource.ApiResourceVisibility_API_RESOURCE_VISIBILITY_PRIVATE,
}
```

---

### Task 3: Fix workflow/agent_ref.go

**File:** `[sdk/go/workflow/agent_ref.go](sdk/go/workflow/agent_ref.go)`

**Issues:**

- Uses `scope` string field ("platform", "organization")
- The concept of "scope" is deprecated; resources now identified by `org/slug`

**Required changes:**

- Remove `scope` field from `AgentRef` struct
- Update `AgentBySlug()` to accept `org/slug` format instead of scope parameter
- Update `determineScope()` - this function concept is obsolete

---

### Task 4: Regenerate SDK Code (gen/ directory)

**Files affected:**

- `[sdk/go/gen/types/commons_types.go](sdk/go/gen/types/commons_types.go)` - Contains obsolete `Scope string` field
- `[sdk/go/gen/workflow/agentcalltaskconfig.go](sdk/go/gen/workflow/agentcalltaskconfig.go)` - Contains `Scope string` field
- `[sdk/go/gen/agent/agentspec_args.go](sdk/go/gen/agent/agentspec_args.go)` - Comments mention deprecated `scope: platform`

**Action:** Re-run code generation tools:

```bash
# From tools/codegen/
go run proto2schema/main.go --comprehensive
go run generator/main.go
```

---

### Task 5: Migrate Examples (Existing Sub-Task 5)

**Files to update:**

- `sdk/go/examples/02_agent_with_skills.go`
- `sdk/go/examples/03_agent_with_mcp_servers.go`
- `sdk/go/examples/04_agent_with_subagents.go`
- `sdk/go/examples/05_agent_with_environment_variables.go`
- `sdk/go/examples/06_agent_with_inline_content.go`
- `sdk/go/examples/12_agent_with_typed_context.go`
- `sdk/go/examples/16_workflow_calling_agent_by_slug.go`

**Changes:**

- Replace `skillref.Platform()` with `agent.AddSkill("stigmer/skill-name")`
- Replace `mcpserverref.Platform()` with `agent.UseMCP("stigmer/server-name")`
- Remove imports of `skillref` and `mcpserverref`

---

### Task 6: Migrate Tests (Existing Sub-Task 6)

**Test files importing deprecated packages:**

- `sdk/go/agent/agent_skills_test.go`
- `sdk/go/agent/agent_builder_test.go`
- `sdk/go/agent/agent_subagents_test.go`
- `sdk/go/agent/error_cases_test.go`
- `sdk/go/agent/edge_cases_test.go`
- `sdk/go/agent/proto_integration_test.go`
- `sdk/go/mcpserverref/mcpserverref_test.go` (delete with package)
- `sdk/go/stigmer/context_test.go`
- `sdk/go/integration_scenarios_test.go`
- `sdk/go/examples/examples_test.go`

---

### Task 7: Update Documentation (Existing Sub-Task 7)

**Files with deprecated references:**

- `sdk/go/README.md`
- `sdk/go/docs/USAGE.md`
- `sdk/go/docs/API_REFERENCE.md`
- `sdk/go/docs/api-reference.md`
- `sdk/go/docs/guides/migration-guide.md`
- `sdk/go/docs/references/proto-mapping.md`

---

## SDK Field Comparison

### Agent Proto vs SDK Struct


| Proto Field (AgentSpec) | SDK Agent Field      | SDK AgentArgs   | Status                    |
| ----------------------- | -------------------- | --------------- | ------------------------- |
| description             | Description          | Description     | OK                        |
| icon_url                | IconURL              | IconUrl         | OK                        |
| instructions            | Instructions         | Instructions    | OK                        |
| mcp_server_usages       | McpServerUsages      | McpServerUsages | OK                        |
| skill_refs              | SkillRefs            | SkillRefs       | OK                        |
| sub_agents              | SubAgents            | SubAgents       | OK                        |
| env_spec                | EnvironmentVariables | EnvSpec         | OK (converted in ToProto) |


**Agent SDK is properly aligned with proto.**

### Workflow Proto vs SDK Struct


| Proto Field (WorkflowSpec) | SDK Status |
| -------------------------- | ---------- |
| description                | OK         |
| document                   | OK         |
| tasks                      | OK         |
| env_spec                   | OK         |


**Workflow SDK is properly aligned with proto (except metadata.OwnerScope issue).**

---

## Packages Analysis


| Package                | Status        | Action                           |
| ---------------------- | ------------- | -------------------------------- |
| `sdk/go/skillref/`     | DEPRECATED    | DELETE                           |
| `sdk/go/mcpserverref/` | DEPRECATED    | DELETE                           |
| `sdk/go/skill/`        | NEW (Phase 2) | KEEP                             |
| `sdk/go/mcpserver/`    | NEW (Phase 2) | KEEP                             |
| `sdk/go/agent/`        | UPDATED       | Has new smart parsing methods    |
| `sdk/go/subagent/`     | UPDATED       | Has new smart parsing methods    |
| `sdk/go/workflow/`     | NEEDS FIX     | Fix proto.go and agent_ref.go    |
| `sdk/go/gen/`          | NEEDS REGEN   | Regenerate to remove Scope field |


---

## Execution Order

1. **Fix workflow package first** (Task 2-3) - These are blocking compilation
2. **Regenerate SDK code** (Task 4) - Remove obsolete Scope fields
3. **Migrate examples** (Task 5) - Update to use new APIs
4. **Migrate tests** (Task 6) - Update to use new APIs
5. **Delete deprecated packages** (Task 1) - Only after all usages removed
6. **Update documentation** (Task 7) - Final cleanup
7. **Verify build** - `go build ./sdk/go/...` and `go test ./sdk/go/...`

---

## Verification Commands

```bash
# Build verification
go build ./sdk/go/...

# Test verification
go test ./sdk/go/...

# Search for any remaining deprecated references
rg "ApiResourceOwnerScope" sdk/go/
rg "Scope:" sdk/go/
rg "skillref\." sdk/go/
rg "mcpserverref\." sdk/go/
```

