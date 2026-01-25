# SDK Code Generation Review and Improvements - Quick Resume

**Project**: sdk-codegen-review-and-improvements  
**Status**: IN_PROGRESS  
**Last Updated**: 2026-01-26

---

## Current State

**Phase**: Deep Audit Complete - Implementation Pending  
**Current Task**: Choose from Available Phases below (one at a time)  
**Build Status**: PASSES (`go build ./...` succeeds)

**Plan Reference**: `.cursor/plans/sdk_deep_audit_completion.plan.md`

---

## Executive Summary

The deep audit (Phase 1 of original plan) has been completed. Critical issues were discovered in:
1. **Code Generation Pipeline** - Dead code, debug statements, incomplete validation extraction
2. **Build System** - Bazel/Go inconsistency, deprecated GoReleaser config
3. **SDK Packages** - DEBUG statements in generated code, incomplete enum conversion

These must be addressed before proceeding to final tasks (tests, examples, docs).

---

## Available Phases (Choose ONE per session)

### Phase 1: Code Generation Pipeline Fixes

| Task | Severity | Description | Location |
|------|----------|-------------|----------|
| **1.1** | HIGH | Remove DEBUG print statements | `tools/codegen/generator/main.go:1032,1046` |
| **1.2** | HIGH | Remove dead code (generateHelpersFile) | `tools/codegen/proto2schema/main.go:515-569` |
| **1.3** | MEDIUM | Improve buf.validate extraction | `proto2schema/main.go:655-659` |
| **1.4** | MEDIUM | Extend namespace coverage (IAM, tenancy) | `proto2schema/main.go:247-310` |

### Phase 2: Build System Unification

| Task | Severity | Description | Location |
|------|----------|-------------|----------|
| **2.1** | HIGH | Document canonical build system decision | Decision: Go vs Bazel |
| **2.2** | HIGH | Fix/remove GoReleaser configuration | `.goreleaser.yml:32-48` |
| **2.3** | MEDIUM | Pin Go version consistently | CI: 1.22 vs MODULE.bazel: 1.24.6 |

### Phase 3: SDK Package Fixes

| Task | Severity | Description | Location |
|------|----------|-------------|----------|
| **3.1** | HIGH | Remove DEBUG statements from generated code | `sdk/go/gen/workflow/*.go` |
| **3.2** | HIGH | Fix subagent Scope/Kind enum conversion | `sdk/go/subagent/subagent.go:89-90` |
| **3.3** | MEDIUM | Implement Organization() for references | `sdk/go/subagent/subagent.go:157-159` |
| **3.4** | LOW | Fix environment warning system | `sdk/go/environment/environment.go:186-188` |

### Phase 4: Pulumi Pattern Adoption (Optional Enhancements)

| Task | Priority | Description |
|------|----------|-------------|
| **4.1** | MEDIUM | Add context.Context support to SDK Context |
| **4.2** | LOW | Enhance error types with structured fields |

### Phase 5: Documentation

| Task | Description |
|------|-------------|
| **5.1** | Create audit report checkpoint documents |
| **5.2** | Update architecture documentation |

### Final Tasks (After All Phases Complete)

| Task | Lines | Description |
|------|-------|-------------|
| **5a** | ~300 | Fix all test files to new APIs |
| **5b** | ~200 | Fix all 19 examples |
| **5c** | ~100 | Fix documentation (doc.go, README, api-reference) |

---

## Deep Audit Findings

### Code Generation Pipeline Audit (T01.1)

#### Files Analyzed
- `tools/codegen/proto2schema/main.go` (~585 lines)
- `tools/codegen/generator/main.go` (~735 lines)

#### Critical Issues Found

**1. DEBUG Print Statements in Production Code**
- Location: `generator/main.go` lines 1032, 1046
- Issue: `fmt.Printf("DEBUG %s JSON: %%s\\n", string(jsonBytes))`
- Impact: Unwanted console output in production

**2. Dead Code: generateHelpersFile**
- Location: `proto2schema/main.go` lines 515-569
- Issue: Duplicates `generateHelpers` (lines 459-513), appears unused
- Impact: Maintenance burden, confusion

**3. Brittle Validation Extraction**
- Location: `proto2schema/main.go` lines 655-659
- Issue: Uses string matching on proto text instead of protoreflect APIs
- Example: `if strings.Contains(protoText, "required:") { ... }`
- Impact: May miss edge cases, fragile to proto format changes

**4. Incomplete buf.validate Parsing**

| Validation Type | Status |
|-----------------|--------|
| `required` | Supported |
| `min_len` / `max_len` | Supported |
| `gte` / `lte` | Supported |
| `min_items` / `max_items` | Supported |
| `string.in` (enums) | **NOT extracted** |
| `pattern` | **Field exists but NOT extracted** |
| `float.gte` / `double.gte` | **NOT supported** |
| `oneof` fields | **NOT handled** |

**5. Missing Namespace Generation**
- Location: `proto2schema/main.go` lines 247-310 (comprehensive mode)
- Issue: Only scans `agentic` namespace, misses:
  - `apis/ai/stigmer/iam/` (ApiKeySpec, IamPolicySpec, IdentityAccountSpec)
  - `apis/ai/stigmer/tenancy/` (OrganizationSpec)

**6. No Cycle Detection for Nested Types**
- Location: `proto2schema/main.go` lines 437-478 (`collectNestedTypes`)
- Issue: Recursively traverses without cycle detection or depth limit
- Impact: Could hang on circular type references

#### Map/Array Generation Gaps

Unsupported combinations emit TODOs:
- `map[K]V` where K is not string or V is not string/message
- Arrays of types other than string, int32, int64, or message pointers

---

### Build System Audit (T01.3)

#### Current State: INCONSISTENT

**Bazel Integration Status: PARTIAL**
- 117 BUILD.bazel files exist
- CLI Makefile uses `bazel build` (line 48)
- Root Makefile uses `go build` (line 27)
- CI workflows use `go build` (not Bazel)

#### Critical Issues Found

**1. Dual Build Paths for CLI**

| Entry Point | Build Tool | Command |
|-------------|------------|---------|
| Root Makefile | `go build` | `go build -o bin/stigmer ./client-apps/cli` |
| CLI Makefile | `bazel build` | `bazel build //client-apps/cli:stigmer` |

**2. GoReleaser References Deprecated Architecture**
- Location: `.goreleaser.yml` lines 32-48
- Issue: References `stigmer-server` binary
- Root Makefile comment (lines 33-34): "stigmer-server and workflow-runner are now part of the CLI (BusyBox pattern)"

**3. Go Version Mismatch**

| Location | Go Version |
|----------|------------|
| CI workflows | 1.22 |
| MODULE.bazel | 1.24.6 |

**4. CI Doesn't Use Bazel**
- File: `.github/workflows/release-embedded.yml`
- Lines 140, 195, 249: All use `go build` directly

#### Build Flow Diagram

```
protos (apis/Makefile)
  └─> build (root Makefile)
       └─> bin/stigmer (via go build)

Proto generation correctly uses Gazelle to generate BUILD.bazel files,
but the actual builds don't use Bazel.
```

#### Recommendation

**Option A (Recommended): Standardize on Go Build**
- Remove Bazel configuration (if not actively used)
- Update CLI Makefile to use `go build`
- Simpler, fewer moving parts, matches CI

**Option B: Standardize on Bazel**
- Update root Makefile to use `bazel build`
- Update all CI workflows to use Bazel
- Better reproducibility, but higher complexity

---

### Pulumi Pattern Comparison (T02.1)

#### Patterns Already Adopted by Stigmer

| Pattern | Status |
|---------|--------|
| Struct args for resource creation | Adopted |
| `ctx` as first parameter | Adopted |
| `name` as second parameter | Adopted |
| Variadic options pattern | Partial (resource options) |
| Error returns (not panics) | Adopted |
| Nil-safe args handling | Adopted |

#### Patterns to Consider Adopting

**1. context.Context Integration**

Current Stigmer:
```go
type Context struct {
    variables    map[string]Ref
    workflows    []*workflow.Workflow
    // ... no standard context
}
```

Pulumi approach:
```go
type Context struct {
    ctx   context.Context  // Standard Go context
    state *contextState
    Log   Log
}
```

**2. Output Types with Apply**

Pulumi has rich `Output[T]` types for async value handling:
```go
type Output[T any] interface {
    ElementType() reflect.Type
    Apply(func(T) U) Output[U]
}
```

**3. Structured Error Types**

```go
type ValidationError struct {
    Resource string
    Field    string
    Reason   string
    Code     string  // Machine-readable
}
```

---

### SDK Package Audit Summary

#### Package Status

| Package | Quality | Critical Issues |
|---------|---------|-----------------|
| `agent/` | High | None |
| `workflow/` | High | None |
| `mcpserver/` | High | None |
| `subagent/` | Good | Incomplete enum conversion, Organization() not implemented |
| `environment/` | High | Unused warning code |
| `skillref/` | High | No tests |
| `internal/validation/` | High | No direct tests |
| `gen/workflow/` | Good | **DEBUG statements in production** |

#### Critical Issues in SDK

**1. DEBUG Statements in Generated Code**
- Files: `sdk/go/gen/workflow/trytaskconfig.go`, `switchtaskconfig.go`, `fortaskconfig.go`, `forktaskconfig.go`
- Issue: `fmt.Printf("DEBUG ...")` statements left in production

**2. Incomplete Enum Conversion in subagent**
- Location: `sdk/go/subagent/subagent.go:89-90`
- Issue: `convertSkillRefs()` doesn't convert Scope/Kind from strings to enums
- Comment: "Note: types.ApiResourceReference uses string for Scope/Kind, proto uses enums. These would need proper conversion if used."

**3. Unimplemented Organization() Method**
- Location: `sdk/go/subagent/subagent.go:157-159`
- Issue: Returns empty string for referenced sub-agents
- Comment: "For references, we need to parse from agentInstanceRef. For now, return empty - this will be handled by CLI"

**4. Unused Warning in Environment**
- Location: `sdk/go/environment/environment.go:186-188`
- Issue: Warning message created but discarded
- Code: `_ = fmt.Sprintf("warning: secret variable %s has no description", v.Name)`

---

## Session History

### Session 5 (Current) - Deep Audit

**Completed**: Full audit of code generation pipeline, build system, Pulumi patterns, SDK packages.

**Key Findings**:
- Code generation has dead code and debug statements
- Build system is inconsistent (Bazel partially integrated but not used)
- SDK packages are production-ready with minor issues

### Session 4 - Protovalidate Migration

**Completed**: Major architectural change - migrated SDK validation to protovalidate.
- Net reduction: 1,175 lines
- Single source of truth for validation (proto files)

### Session 3 - Standardize Validation

**Completed**: Created `sdk/go/internal/validation/` package, migrated all SDK packages.

### Session 2 - Fix codegen FromProto

**Completed**: Eliminated all 18 TODOs in generated code.

### Session 1 - Foundation

**Completed**: Deleted mcpserver/options.go, skill package refactoring.

---

## Uncommitted Changes

**Status**: 10 files modified from Session 4 (protovalidate migration), NOT committed

```
Build: PASSES
Tests: FAILING (pre-existing - need updates to new APIs)
```

---

## Design Decisions Made

| Decision | Rationale |
|----------|-----------|
| Proto-first approach | Use proto types directly, thin helpers only |
| Skills are external | SDK references skills via `skillref`, doesn't create them |
| Struct args pattern | Pulumi-aligned, consistent across all SDK packages |
| Delete dead code first | Clean foundation before fixing tests |
| Generated types for VolumeMount/PortMapping | Eliminates duplication, single source of truth |
| subagent uses InlineArgs | Consistent with agent, mcpserver patterns |
| protovalidate for validation | Single source of truth, backend/SDK alignment, -1,175 lines |
| SDK-specific validations only | Name formats, uniqueness checks not in proto |

---

## Key Principles

1. **Small units of work** - Complete one phase fully before next
2. **Update this file** - Track progress after each session
3. **Build must pass** - Verify after each change
4. **Tests come last** - Fix foundations first
5. **Single source of truth** - Validation rules in proto, not duplicated in SDK
6. **No technical debt** - Fix issues properly, don't leave them for later

---

## Quick Resume

To continue this project:
```
@_projects/2026-01/20260125.03.sdk-codegen-review-and-improvements/next-task.md
```

Then choose ONE phase from "Available Phases" section and complete it fully.

---

## Reference Documents

- **Plan**: `.cursor/plans/sdk_deep_audit_completion_18b8ab64.plan.md`
- **Original Plan**: `_projects/2026-01/20260125.03.sdk-codegen-review-and-improvements/tasks/T01_0_plan.md`
- **Architecture**: `tools/codegen/README.md`, `sdk/go/docs/codegen-architecture.md`
