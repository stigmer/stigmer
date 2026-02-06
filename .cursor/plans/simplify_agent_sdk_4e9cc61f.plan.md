---
name: Simplify Agent SDK
overview: Simplify the agent SDK package by removing dead code, consolidating duplicated annotations into commons/metadata/, and merging fragmented test files by behavior.
todos:
  - id: create-metadata-pkg
    content: Create commons/metadata/ package with SDKAnnotations() and MergeAnnotations()
    status: completed
  - id: update-agent-imports
    content: Update agent/proto.go to use commons/metadata, delete agent/annotations.go
    status: completed
  - id: update-workflow-imports
    content: Update workflow/proto.go to use commons/metadata, delete workflow/annotations.go
    status: completed
  - id: update-mcpserver-imports
    content: Update mcpserver/proto.go to use commons/metadata, remove inline functions
    status: completed
  - id: delete-ref-helpers
    content: Delete agent/ref_helpers.go and remove TestRefHelpers_toExpression from tests
    status: completed
  - id: consolidate-error-tests
    content: Merge errors_test.go and error_cases_test.go into single errors_test.go
    status: completed
  - id: consolidate-parsing-tests
    content: Merge smart_parsing_test.go and ref_integration_test.go into parsing_test.go
    status: completed
  - id: consolidate-builder-tests
    content: Merge agent_skills_test.go, agent_subagents_test.go, agent_environment_test.go into builder_test.go
    status: completed
  - id: validate-build
    content: Run go build ./... && go test ./... to verify all changes
    status: completed
isProject: false
---

# Simplify Agent SDK Implementation

## Problem Statement

The agent SDK package has 23 files (~10,000 lines) with:

- Dead code (`ref_helpers.go`)
- Duplicated code (`annotations.go` exists in 3 packages)
- Fragmented tests (13 test files)

## Changes Overview

### Phase 1: Create `commons/metadata/` Package

Move SDK annotation logic to a shared location. Currently duplicated in:

- `agent/annotations.go`
- `workflow/annotations.go`
- `mcpserver/proto.go` (inline)

**Create:**

```
sdk/go/commons/metadata/
├── doc.go
└── annotations.go    # SDKAnnotations(), MergeAnnotations(), constants
```

**Key code from [agent/annotations.go](sdk/go/agent/annotations.go):**

```go
const (
    SDKLanguage = "go"
    SDKVersion  = "0.1.0"
    AnnotationSDKLanguage    = "stigmer.ai/sdk.language"
    AnnotationSDKVersion     = "stigmer.ai/sdk.version"
    AnnotationSDKGeneratedAt = "stigmer.ai/sdk.generated-at"
)

func SDKAnnotations() map[string]string { ... }
func MergeAnnotations(userAnnotations map[string]string) map[string]string { ... }
```

### Phase 2: Update Resource Packages

Update imports in all resource packages:

- `agent/proto.go` → import `commons/metadata`, delete `agent/annotations.go`
- `workflow/proto.go` → import `commons/metadata`, delete `workflow/annotations.go`
- `mcpserver/proto.go` → import `commons/metadata`, remove inline functions

### Phase 3: Delete Dead Code

**Delete `agent/ref_helpers.go`:**

- `toExpression()` function is never used in production code
- `Ref` and `StringValue` interfaces are unused

**Delete test for dead code:**

- Remove `TestRefHelpers_toExpression` from `ref_integration_test.go`

### Phase 4: Consolidate Test Files

Merge 13 test files → 7 test files organized by behavior:


| Current Files                                                                    | Target File       | Reason                      |
| -------------------------------------------------------------------------------- | ----------------- | --------------------------- |
| `errors_test.go` + `error_cases_test.go`                                         | `errors_test.go`  | Both test error handling    |
| `smart_parsing_test.go` + `ref_integration_test.go`                              | `parsing_test.go` | Both test reference parsing |
| `agent_skills_test.go` + `agent_subagents_test.go` + `agent_environment_test.go` | `builder_test.go` | All test builder methods    |


**Keep separate:**

- `agent_test.go` - Core creation
- `agent_builder_test.go` - Rename to `builder_test.go`, merge others into it
- `proto_integration_test.go` - Proto conversion
- `validation_test.go` - Validation rules
- `benchmarks_test.go` - Performance
- `edge_cases_test.go` - Boundary conditions

### Files to Keep (No Changes)

These files are necessary and well-structured:


| File                  | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `agent.go`            | Core Agent struct and builder methods                    |
| `proto.go`            | ToProto() conversion                                     |
| `parsing.go`          | Smart org/slug parsing for AddSkill/UseMCP               |
| `errors.go`           | Type aliases for API ergonomics                          |
| `validation.go`       | SDK-specific name validation (complements protovalidate) |
| `skill_options.go`    | SkillOption functional options                           |
| `subagent_helpers.go` | SubAgent builder helpers                                 |
| `doc.go`              | Package documentation                                    |


## Validation

After each phase:

```bash
cd sdk/go
go build ./...
go test ./...
```

## Impact Summary

- **Before:** 23 files in agent package
- **After:** 15 files in agent package + 2 files in `commons/metadata/`
- **Net reduction:** ~6 files, cleaner organization
- **Eliminated:** Dead code, duplication, test fragmentation

