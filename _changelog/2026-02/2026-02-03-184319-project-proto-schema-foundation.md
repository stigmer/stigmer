# Project Proto Schema: Aggregate Root for Resource Lifecycle Management

**Date**: February 3, 2026

## Summary

Implemented the Project entity as a proper API resource following the Kubernetes API pattern. Project is the aggregate root for resource lifecycle management in ADR-005's Project Track, enabling SDK synthesis with automatic reconciliation and orphan cleanup. This establishes the foundation for Phase 4 of the CLI Unified Architecture initiative.

## Problem Statement

The existing `Stigmer.yaml` configuration was a plain Go struct without API resource semantics. To implement the Project Track of ADR-005's Dual-Track Interface, we needed Project to be a full-fledged API resource with:

- Standard metadata (name, org, labels, tags)
- Proper proto schema with validation rules
- Status tracking for reconciliation state
- Integration with the ApiResourceKind enum system

### Pain Points

- No standardized Project entity across SDK, CLI, and backend
- Legacy `Stigmer.yaml` lacked API versioning and kind identification
- No status tracking for reconciliation outcomes
- Missing infrastructure for drift detection and resource count tracking
- No way to distinguish between legacy and new project formats

## Solution

Created a comprehensive proto schema for Project in `apis/ai/stigmer/agentic/project/v1/` following established patterns from Agent and Workflow resources. The design includes:

1. **Proper API Resource Structure**: Project has `apiVersion`, `kind`, `metadata`, `spec`, and `status` following Kubernetes patterns
2. **SDK-Only Focus**: No YAML resource glob patterns - Project is exclusively for SDK synthesis
3. **Backend-Managed Status**: ReconciliationSummary tracks outcomes (not process details like dependency graphs)
4. **Lowercase Enum Values**: `go`, `python`, `node` - no transformation needed when parsing YAML

## Implementation Details

### Proto Files Created

**1. enum.proto** - Runtime and reconciliation enums:
```protobuf
enum ProjectRuntime {
  project_runtime_unspecified = 0;
  go = 1;      // lowercase for direct YAML mapping
  python = 2;
  node = 3;
}

enum ReconciliationResult {
  reconciliation_result_unspecified = 0;
  success = 1;
  partial = 2;
  failed = 3;
}
```

**2. spec.proto** - Project configuration:
```protobuf
message ProjectSpec {
  ProjectRuntime runtime = 1;    // required, validated
  string entry_point = 2;        // optional, defaults by runtime
  string description = 3;
}
```

**3. status.proto** - Reconciliation tracking:
```protobuf
message ProjectStatus {
  ApiResourceAudit audit = 99;
  ReconciliationSummary reconciliation = 1;
}

message ReconciliationSummary {
  google.protobuf.Timestamp last_reconciled_at = 1;
  ReconciliationResult result = 2;
  string manifest_hash = 3;           // SHA256 for drift detection
  ResourceCounts resource_counts = 4;  // agents, workflows, skills, mcp_servers
}
```

**4. api.proto** - Main Project message:
```protobuf
message Project {
  string api_version = 1;  // 'agentic.stigmer.ai/v1'
  string kind = 2;         // 'Project'
  ApiResourceMetadata metadata = 3;
  ProjectSpec spec = 4;
  ProjectStatus status = 5;
}
```

**5. io.proto** - Wrapper types:
```protobuf
message ProjectId {
  string value = 1;
}
```

### ApiResourceKind Registration

Added `project = 60` to the ApiResourceKind enum:

```protobuf
project = 60 [(kind_meta) = {
  group: agentic
  version: v1
  name: "Project"
  display_name: "Project"
  id_prefix: "prj"              // Resource IDs like prj_abc123
  is_versioned: false
  not_search_indexed: false
  tier: TIER_OPEN_SOURCE        // Available in CLI local mode
  authorization: {
    scope_type: AUTHORIZATION_SCOPE_TYPE_ORGANIZATION
    owner_type: OWNER_ATTRIBUTION_TYPE_DIRECT
  }
}];
```

### Key Design Decisions

**1. Bounded Context**: Placed in `agentic` group
- **Rationale**: YAGNI - no non-agentic use cases exist today; maintains consistency with all other CLI-managed resources
- Migration path exists if needed (`project.stigmer.ai/v1`)

**2. SDK-Only Synthesis**: No `resources` field for YAML globs
- **Rationale**: Project is exclusively for SDK synthesis; Atomic Track (`stigmer <resource> apply`) handles individual YAMLs
- Keeps responsibilities clear and prevents confusion

**3. Status is Outcome Data**: ReconciliationSummary contains counts/timestamps, not process details
- **Rationale**: Dependency graph (`.stigmer/dependencies.json`) is a build artifact, not domain state
- Prevents unbounded status growth
- Backend updates status after each reconciliation

**4. Entry Point Defaults**: Optional with runtime-based defaults
- GO → `main.go`
- PYTHON → `main.py`
- NODE → `index.ts`
- Applied by CLI loader (proto can't express conditional defaults)

**5. Lowercase Enum Values**: User input matches proto directly
- YAML `runtime: go` maps to enum `go` (no transformation)
- Consistent with existing `ApiResourceKind` enum pattern

## Benefits

**1. Unified API Resource Pattern**
- Project follows same structure as Agent, Workflow, Skill
- CLI code can reuse existing loader/validator patterns
- Backend can treat Project like any other resource

**2. Reconciliation State Tracking**
- Backend knows when last reconciliation occurred
- Drift detection via manifest hash comparison
- Resource counts provide quick summary without querying each type

**3. Clean Separation of Concerns**
- Proto schema enforces structure and validation
- CLI handles cross-field validation (runtime + entry_point)
- Backend manages status updates
- SDK synthesizes manifest

**4. Forward Compatibility**
- Legacy `Stigmer.yaml` (capital S) can coexist
- Detection via `apiVersion` field presence
- New `stigmer.yaml` (lowercase) uses API resource format

**5. Type Safety**
- Enum-based runtime prevents invalid values at proto level
- Generated Go/Python stubs provide compile-time checks
- Validation rules prevent invalid states

## Impact

**Affected Components**:
- **Phase 4 Subtask 1**: ✅ Complete - Proto schema foundation
- **Next (T04.2)**: Project loader implementation
- **Future (T04.3-7)**: Validator, commands, track detection, integration

**Files Created** (10 files):
```
apis/ai/stigmer/agentic/project/v1/
├── api.proto (45 lines)
├── enum.proto (41 lines)
├── spec.proto (43 lines)
├── status.proto (48 lines)
└── io.proto (10 lines)

apis/stubs/go/ai/stigmer/agentic/project/v1/
├── api.pb.go
├── enum.pb.go
├── spec.pb.go
├── status.pb.go
└── io.pb.go

apis/stubs/python/stigmer/ai/stigmer/agentic/project/v1/
├── api_pb2.py
├── enum_pb2.py
├── spec_pb2.py
├── status_pb2.py
└── io_pb2.py
```

**Files Modified** (1 file):
```
apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto
└── Added project = 60 with metadata
```

## Example Usage

**New stigmer.yaml format**:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-super-app
  org: acme-corp
spec:
  runtime: go
  # entry_point: main.go (optional - defaults to main.go for go runtime)
  description: My production application
```

**Status after reconciliation** (backend-managed):

```yaml
status:
  audit:
    created_at: 2026-02-03T18:00:00Z
    updated_at: 2026-02-03T18:43:00Z
  reconciliation:
    last_reconciled_at: 2026-02-03T18:43:00Z
    result: success
    manifest_hash: a3f2d8c...
    resource_counts:
      agents: 3
      workflows: 2
      skills: 5
      mcp_servers: 1
```

## Related Work

**ADR-005**: Unified Resource Management & Project-Based Reconciliation
- Introduces Dual-Track Interface (Atomic + Project)
- Project Track enables SDK synthesis with reconciliation

**Phase 1**: Agent YAML-First ✅ Complete
- Atomic Track for Agents

**Phase 2**: Workflow Commands ✅ Complete
- CRUD operations for Workflows

**Phase 3**: Workflow YAML-First ✅ Complete
- Atomic Track for Workflows

**Phase 4**: Project Entity (in progress)
- T04.1: ✅ Proto Schema (this work)
- T04.2: Project Loader
- T04.3: Cross-Field Validator
- T04.4: Display Functions
- T04.5: Track Detection
- T04.6: Project Commands
- T04.7: Integration & Documentation

## Technical Notes

**Proto Validation Patterns**:
- Combined enum validation: `(buf.validate.field).enum = {defined_only: true, not_in: [0]}`
- Required spec: `(buf.validate.field).required = true`
- String constants: `(buf.validate.field).string.const = 'agentic.stigmer.ai/v1'`

**Build Process**:
- Generated stubs via `make protos`
- Buf lint passed
- Go compilation verified
- Python stubs generated

**Pattern Consistency**:
- Mirrors Agent and Workflow proto structure exactly
- Uses shared `ApiResourceMetadata` and `ApiResourceAudit`
- Follows file organization conventions (api/spec/status/enum/io)

---

**Status**: ✅ Production Ready
**Next Steps**: Implement Project Loader (T04.2) following Agent loader patterns
