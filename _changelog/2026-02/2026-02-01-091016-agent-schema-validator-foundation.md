# Agent Schema Validator: Proto-First Validation with Minimal Go Logic

**Date**: February 1, 2026

## Summary

Implemented Sub-task 2 of the Agent YAML-First initiative by strengthening proto validation rules at the source and creating a minimal Go validator for cross-field business logic. This establishes a clean architectural pattern where proto definitions are the single source of truth for schema validation, with Go code handling only relationships that cannot be expressed in proto constraints.

## Problem Statement

The Agent CLI needs robust validation to ensure YAML configurations are correct before sending to the backend. However, we identified that duplicating validation between proto files and Go code creates technical debt and inconsistency - a problem already present in the MCP Server loader.

### Pain Points

- **Validation duplication**: MCP Server loader manually validates fields that proto already defines
- **Missing proto validations**: `ApiResourceReference` lacked format validation for org/slug fields despite documented requirements
- **Cross-field validation needed**: SubAgent mcp_access references and tool subsets require runtime validation
- **Maintenance burden**: Keeping Go validation in sync with proto rules is error-prone

## Solution

A two-layer validation approach:

1. **Proto layer (schema validation)**: Strengthen proto files with complete validation rules using buf.validate
2. **Go layer (business logic)**: Minimal validator for cross-field relationships that cannot be expressed in proto

This follows the principle: **Proto is the single source of truth for schema validation.**

## Implementation Details

### 1. Enhanced Proto Validation

**File**: `apis/ai/stigmer/commons/apiresource/io.proto`

Added comprehensive validation to `ApiResourceReference`:

```proto
message ApiResourceReference {
  string org = 1 [
    (buf.validate.field).required = true,
    (buf.validate.field).string.pattern = "^[a-z][a-z0-9-]*$",
    (buf.validate.field).string.min_len = 1,
    (buf.validate.field).string.max_len = 63
  ];

  string slug = 3 [
    (buf.validate.field).required = true,
    (buf.validate.field).string.pattern = "^[a-z][a-z0-9-]*$",
    (buf.validate.field).string.min_len = 1,
    (buf.validate.field).string.max_len = 63
  ];
  // ...
}
```

**Benefits**:
- Format validation enforced across all clients (Go, Python, Java, TypeScript)
- Self-documenting - the proto file is the contract
- No duplication in CLI, SDK, or backend code

### 2. Minimal Go Validator

**File**: `client-apps/cli/internal/cli/agent/validator.go` (180 lines)

Cross-field validation only:

```go
// Validate performs cross-field business logic validation.
// Schema validation is handled by protovalidate in Load().
func Validate(agent *agentv1.Agent) error {
    // Only validates relationships between fields:
    // 1. Unique mcp_server_usages (no duplicate slugs)
    // 2. SubAgent.mcp_access references parent's mcp_server_usages
    // 3. SubAgent.enabled_tools subset of parent's enabled_tools
}
```

**Key functions**:
- `validateUniqueMcpServerUsages()` - Prevents duplicate MCP server references
- `validateSubAgentMcpAccess()` - Ensures SubAgents only access parent's MCP servers
- `validateToolsSubset()` - Enforces permission inheritance (SubAgent ⊆ Parent tools)

### 3. Comprehensive Test Coverage

**File**: `client-apps/cli/internal/cli/agent/validator_test.go` (250 lines)

14 test functions covering:
- Nil/empty agent handling (3 tests)
- Valid agents with MCP servers and sub-agents (2 tests)
- Duplicate MCP server detection (2 tests)
- SubAgent reference validation (4 tests)
- Tool subset enforcement (2 tests)
- Error message quality (1 test with 3 sub-tests)

**Total**: 28 tests passing (14 loader + 14 validator)

### 4. What We're NOT Validating in Go

The following are handled by protovalidate and therefore NOT duplicated:
- `apiVersion == "agentic.stigmer.ai/v1"`
- `kind == "Agent"`
- `metadata` required
- `instructions` min 10 characters
- `skill_refs[].kind == 43` (skill)
- `mcp_server_usages[].mcp_server_ref.kind == 44` (mcp_server)
- `mcp_server_ref` required
- `org`/`slug` format and length

## Benefits

### 1. Reduced Technical Debt
- Avoids duplication pattern present in MCP Server loader
- Single source of truth for validation rules
- Easier to maintain and evolve

### 2. Better Error Messages
Each validation error includes actionable guidance:
- Duplicate MCP server: "Remove the duplicate entry"
- Undefined MCP server: "Add an mcp_server_usages entry with slug: X"
- Invalid tool: "Either add X to parent's enabled_tools or remove from sub-agent"

### 3. Reusability
Proto validations automatically apply to:
- CLI (Go)
- Backend services (Java)
- Python SDK (future)
- TypeScript web clients

### 4. Type Safety
Pattern validation (`^[a-z][a-z0-9-]*$`) catches invalid slugs/orgs at parse time, before they reach the backend.

## Impact

### Developer Experience
- Clear separation: schema validation (proto) vs business logic (Go)
- Comprehensive test coverage gives confidence when refactoring
- Error messages guide users to fix issues

### Code Quality
- 180 lines of focused Go code (vs 250+ if duplicating proto rules)
- 100% test coverage of cross-field validation logic
- Clean architecture pattern for future YAML-first resources

### Platform Consistency
- All clients get same slug/org validation
- Consistent error messages across languages
- Proto files serve as the validation contract

## Related Work

- **Previous**: [Agent YAML Loader Foundation](2026-02-01-075912-agent-yaml-loader-foundation.md) - Sub-task 1
- **Next**: Agent Applier & Display - Sub-task 3 (gRPC integration)
- **Parent Initiative**: [CLI Agent YAML-First](../_projects/2026-01/20260131.02.cli-agent-yaml-first/)

## Technical Details

### Files Modified/Created

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `apis/.../io.proto` | Modified | +14 | Added slug/org validation |
| `client-apps/cli/internal/cli/agent/validator.go` | Created | 180 | Cross-field validation |
| `client-apps/cli/internal/cli/agent/validator_test.go` | Created | 250 | Comprehensive tests |
| `client-apps/cli/internal/cli/agent/BUILD.bazel` | Modified | +8 | Build config |
| `apis/stubs/go/**` | Regenerated | - | Proto stubs |
| `apis/stubs/python/**` | Regenerated | - | Proto stubs |

### Test Results

```
28 tests passing:
- 14 loader tests (Sub-task 1)
- 14 validator tests (Sub-task 2)

0.9s total test time
```

### Design Decisions

1. **Proto validation first**: Always strengthen proto before writing Go code
2. **Cross-field validation only**: Go code validates relationships, not schema
3. **Actionable errors**: Each error explains how to fix the problem
4. **Permission inheritance**: SubAgents can restrict but not expand parent tools

---

**Status**: ✅ Production Ready  
**Timeline**: 60 minutes (actual) vs 45-60 minutes (estimated)  
**Sub-task**: 2 of 7 in Phase 1
