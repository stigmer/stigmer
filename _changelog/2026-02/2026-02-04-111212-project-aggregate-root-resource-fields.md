# ProjectSpec Aggregate Root Resource Fields

**Date**: 2026-02-04
**Phase**: 4 - Project Entity & stigmer.yaml Foundation
**Sub-task**: T04.1b - Update ProjectSpec with Resource Fields

## Summary

Enhanced `ProjectSpec` to include repeated resource fields for Agents, Workflows, MCP Servers, and Skills, making Project a true aggregate root for resource lifecycle management. This follows the Terraform/Pulumi model where the Project is the state manager for its resources.

**Architectural Cleanup**: Removed `ReconciliationSummary`, `ResourceCounts`, and `ReconciliationResult` from the schema as they were anemic data that duplicated derivable information.

## Changes

### Proto Schema

#### spec.proto - Added Resource Fields

**Added imports**:
- `ai/stigmer/agentic/agent/v1/api.proto`
- `ai/stigmer/agentic/workflow/v1/api.proto`
- `ai/stigmer/agentic/mcpserver/v1/api.proto`
- `ai/stigmer/agentic/skill/v1/api.proto`

**Added resource fields** (field numbers 10-13):
- `repeated Agent agents = 10` - Agents managed by the project
- `repeated Workflow workflows = 11` - Workflows managed by the project
- `repeated McpServer mcp_servers = 12` - MCP Servers managed by the project
- `repeated Skill skills = 13` - Skills managed by the project

#### status.proto - Removed Anemic Data

**Removed messages**:
- `ReconciliationSummary` - Contained derivable/redundant data
- `ResourceCounts` - Derivable from `len(spec.agents)`, etc.

**Removed from enum.proto**:
- `ReconciliationResult` enum (success/partial/failed)

**Clean design**:
```protobuf
message ProjectStatus {
  // audit.updated_at = when the project was last successfully applied
  ai.stigmer.commons.apiresource.ApiResourceAudit audit = 99;
  // That's it. No reconciliation summary needed.
}
```

**Rationale**:
1. `last_reconciled_at` was redundant with `audit.updated_at`
2. `resource_counts` was derivable from `len(spec.X)`
3. `manifest_hash` was derivable from `hash(spec)`
4. `result` (success/partial/failed) without knowing WHICH resources failed is useless

### CLI Display - Derived Resource Counts

Updated `display.go` to compute resource counts from spec instead of reading from status:

```go
// Before: Read from status.reconciliation.resource_counts
// After: Derive from spec
if len(project.Spec.Agents) > 0 {
    parts = append(parts, fmt.Sprintf("%d agents", len(project.Spec.Agents)))
}
```

## Domain Model (Final)

```
Project (Aggregate Root)
├── metadata (name, org, labels, tags)
├── spec (Desired State)
│   ├── runtime (go, python, node)
│   ├── entry_point (main.go)
│   ├── description
│   ├── agents[]        ← Full Agent resources
│   ├── workflows[]     ← Full Workflow resources
│   ├── mcp_servers[]   ← Full McpServer resources
│   └── skills[]        ← Full Skill resources
└── status (System-managed)
    └── audit (created_at, updated_at) ← updated_at = last apply time
```

## Design Decisions

### Why Remove ReconciliationSummary?

| Field | Problem | Solution |
|-------|---------|----------|
| `last_reconciled_at` | Redundant with `audit.updated_at` | Use audit |
| `result` | "partial" without details is useless | Errors in Apply() response |
| `manifest_hash` | Derivable from spec | Compute on demand |
| `resource_counts` | Derivable from spec | Compute from `len(spec.X)` |

### Why Embed Full Resources (Not References)?

The SDK synthesizes complete resource definitions. Embedding full resources enables:
- Single atomic apply operation
- No separate resource creation needed
- Clear ownership (resources belong to Project)

### Why Field Numbers 10-13?

Reserved field numbers 4-9 for future spec configuration fields. Resource fields start at 10 for clear separation.

## Verification

- `buf lint` passes
- `make protos` succeeds (Go + Python stubs generated)
- `bazel build //apis/stubs/go/ai/stigmer/agentic/project/v1:project` succeeds
- `bazel build //client-apps/cli/internal/cli/project:project` succeeds
- All 51 project CLI tests pass

## Files Modified

```
apis/ai/stigmer/agentic/project/v1/spec.proto     (MODIFIED - added resource fields)
apis/ai/stigmer/agentic/project/v1/status.proto   (MODIFIED - removed ReconciliationSummary)
apis/ai/stigmer/agentic/project/v1/enum.proto     (MODIFIED - removed ReconciliationResult)
apis/stubs/go/ai/stigmer/agentic/project/v1/      (REGENERATED - all .pb.go files)
apis/stubs/python/stigmer/ai/stigmer/agentic/project/v1/  (REGENERATED)
client-apps/cli/internal/cli/project/display.go   (MODIFIED - derive counts from spec)
```

## Next Steps

- T04.5: Track Detection Logic - walk-up algorithm for stigmer.yaml discovery
- T04.6: Project Command Group - info and validate subcommands
- T04.7: Integration and Documentation - E2E testing, example stigmer.yaml
