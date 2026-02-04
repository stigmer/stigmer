---
name: Reconciliation Proto Types T05.0
overview: Implement T05.0 from Phase 5 - Add ReconciliationSummary proto type to the Project API. This enables the Apply response to report what changes were made (created/updated/deleted resources). The dependency graph is NOT a proto type - it's derived by backend via reflection.
todos:
  - id: create-reconciliation-proto
    content: Create reconciliation.proto with ReconciliationSummary and ResourceChangeRecord messages
    status: completed
  - id: update-api-proto
    content: Update api.proto to add last_reconciliation field (field 6) to Project message
    status: completed
  - id: generate-stubs
    content: Run make protos to generate Go and Python stubs and update BUILD files
    status: completed
  - id: verify-buf-lint
    content: Verify buf lint passes and proto compilation succeeds
    status: completed
  - id: verify-go-stubs
    content: Verify Go stubs compile with bazel build
    status: completed
isProject: false
---

# T05.0: Reconciliation Proto Types

## Overview

This task establishes the proto foundation for Project Track reconciliation. The key architectural decision: **DependencyGraph is DERIVED by the backend via proto reflection, NOT passed from CLI**. This ensures:

- Single source of truth (resources contain their references)
- No sync risk (graph derived from resources can't be stale)
- Open/Closed principle (new reference fields work automatically)

## Files to Create/Modify

### 1. Create `reconciliation.proto` (NEW)

**Path**: `apis/ai/stigmer/agentic/project/v1/reconciliation.proto`

```protobuf
syntax = "proto3";

package ai.stigmer.agentic.project.v1;

import "ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto";

// ReconciliationSummary contains the results of project reconciliation.
// This is populated only in the Apply response to show what changes were made.
// It is NOT persisted to the database - the status remains minimal.
//
// Design Decision: No DependencyGraph proto.
// The backend derives dependency relationships by scanning resources for
// ApiResourceReference fields using proto reflection. This keeps the proto
// simple and ensures the graph is always consistent with the actual resources.
message ReconciliationSummary {
  // Resources that were created during this apply.
  repeated ResourceChangeRecord created = 1;
  
  // Resources that were updated during this apply.
  repeated ResourceChangeRecord updated = 2;
  
  // Resources that were deleted (orphan pruning) during this apply.
  repeated ResourceChangeRecord deleted = 3;
}

// ResourceChangeRecord identifies a single resource that was changed.
// Used in ReconciliationSummary to report create/update/delete operations.
message ResourceChangeRecord {
  // The kind of resource (agent, workflow, mcp_server, skill).
  ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind kind = 1;
  
  // The resource slug (human-readable identifier from metadata.name).
  string slug = 2;
  
  // The resource ID (system-assigned, e.g., agt_xxx, wfl_xxx, mcp_xxx).
  string resource_id = 3;
}
```

### 2. Update `api.proto`

**Path**: `apis/ai/stigmer/agentic/project/v1/api.proto`

Add import and new field to Project message:

```protobuf
import "ai/stigmer/agentic/project/v1/reconciliation.proto";

message Project {
  // ... existing fields 1-5 ...
  
  // Reconciliation summary from the most recent Apply operation.
  // Populated only in Apply() response - not persisted to database.
  // Shows what resources were created, updated, or deleted.
  //
  // Note: No dependency_graph field - backend derives it from resources
  // by scanning for ApiResourceReference fields using proto reflection.
  ReconciliationSummary last_reconciliation = 6;
}
```

### 3. Generate Stubs and Update BUILD

Run from `apis/` directory:

```bash
make protos
```

This will:

1. Run `buf lint` - validate proto syntax
2. Run `buf format -w` - format proto files
3. Generate Go stubs (`stubs/go/...`)
4. Generate Python stubs (`stubs/python/...`)
5. Run Gazelle to update BUILD.bazel files

## Proto Design Rationale

### Why No DependencyGraph Proto?

The plan explicitly states: "Dependency graph is DERIVED by backend, not passed from CLI"

**Reasons:**

1. **Single Source of Truth**: Resources contain their references (ApiResourceReference fields)
2. **No Sync Risk**: Graph derived from resources can't be stale or inconsistent
3. **Open/Closed Principle**: Adding new reference fields works automatically via reflection
4. **SDK's dependencies.json**: Used for LOCAL validation only, not sent to backend

### Why ReconciliationSummary is Response-Only?

Per the existing design in `status.proto`:

- "Status is minimal by design"
- "Resource counts are derivable from spec"
- "Errors are returned in Apply() response, not stored in status"

ReconciliationSummary follows this philosophy - it's returned in the Apply response but NOT persisted.

## Existing Patterns Followed

### ApiResourceKind Enum Usage

The enum is defined at:

```
ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind
```

With relevant values:

- `agent` (40), `workflow` (50), `mcp_server` (44), `skill` (43), `project` (60)

### Field Numbering Convention

- Fields 1-5: Standard resource fields (api_version, kind, metadata, spec, status)
- Field 6: First extension field for `last_reconciliation`
- Field 99: Reserved for audit in status messages

## Verification Steps

After implementation:

1. **buf lint passes**: Proto syntax is valid
2. **Go stubs compile**: `bazel build //apis/stubs/go/ai/stigmer/agentic/project/v1:project`
3. **Python stubs generate**: Check `stubs/python/stigmer/ai/stigmer/agentic/project/v1/`
4. **No breaking changes**: New field is additive (field 6), no existing fields modified

## Success Criteria

- `reconciliation.proto` created with ReconciliationSummary and ResourceChangeRecord
- `api.proto` updated with `last_reconciliation` field at position 6
- No DependencyGraph proto (it's internal domain logic, not wire format)
- `buf lint` passes
- Go stubs generated and compile
- Python stubs generated
- BUILD.bazel files updated by Gazelle

## Architectural Decision Documentation

This task implements the key Phase 5 architectural decision:

**Dependency Graph is DERIVED, not passed:**

- The backend scans all resources for ApiResourceReference fields using proto reflection
- This is dynamic - adding new reference fields works automatically without code changes
- SDK's `dependencies.json` is for LOCAL CLI validation only (dry-run preview, cycle detection)

```
Agent.spec.skill_refs[]           → agent depends on skills
Agent.spec.mcp_server_usages[]    → agent depends on mcp_servers
Workflow.spec.tasks[].agent_ref   → workflow depends on agents
```

The DependencyDiscoverer (T05.13) will implement the reflection-based scanner in Java.