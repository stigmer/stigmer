---
name: Agent Schema Validator
overview: Implement Sub-task 2 by first strengthening proto validations (slug/org format), then creating a minimal validator.go for cross-field business logic that cannot be expressed in proto.
todos:
  - id: proto-validation
    content: Add slug/org format validation rules to ApiResourceReference in io.proto
    status: completed
  - id: regen-protos
    content: Regenerate proto stubs with bazel run //apis:protos
    status: completed
  - id: validator-go
    content: Create validator.go with cross-field validation (SubAgent mcp_access, unique mcp_server_usages)
    status: completed
  - id: validator-tests
    content: Create validator_test.go with comprehensive table-driven tests
    status: completed
  - id: build-bazel
    content: Update BUILD.bazel if needed
    status: completed
isProject: false
---

# Sub-task 2: Agent Schema Validator

## Analysis: What Protovalidate Already Handles

The loader.go already validates via protovalidate:

- `apiVersion` == `"agentic.stigmer.ai/v1"` (via `buf.validate.field.string.const`)
- `kind` == `"Agent"` (via `buf.validate.field.string.const`)
- `metadata` required (via `buf.validate.field.required`)
- `spec.instructions` min 10 chars (via `buf.validate.field.string.min_len = 10`)
- `skill_refs[].kind` == 43/skill (via CEL expression)
- `mcp_server_usages[].mcp_server_ref.kind` == 44/mcp_server (via CEL expression)
- `mcp_server_ref` required (via `buf.validate.field.required`)
- `mcp_access.mcp_server` required (via `buf.validate.field.required`)

**No Go code should duplicate these.** The loader handles them already.

---

## Gap Analysis: What's Missing in Proto

### 1. Missing Format Validation in ApiResourceReference

The proto comment says `slug` should be "lowercase alphanumeric with hyphens" but there's **no validation rule enforcing this**:

```13:15:apis/ai/stigmer/commons/apiresource/io.proto
  // Resource slug (user-friendly identifier, unique within org).
  // Format: lowercase alphanumeric with hyphens (e.g., "web-search", "code-reviewer").
  string slug = 3;  // NO VALIDATION!
```

The `org` field is required but also lacks format validation.

### 2. Cross-Field Validation (Cannot Express in Proto)

These require runtime Go validation:

- **SubAgent.mcp_access[].mcp_server** must reference a slug from parent's `mcp_server_usages[]`
- **SubAgent.mcp_access[].enabled_tools** must be subset of parent's enabled_tools
- **Unique mcp_server_usages** (no duplicate mcp_server_ref.slug values)

---

## Implementation Plan

### Step 1: Add Missing Proto Validations (io.proto)

Add format validation to `ApiResourceReference` in [apis/ai/stigmer/commons/apiresource/io.proto](apis/ai/stigmer/commons/apiresource/io.proto):

```proto
message ApiResourceReference {
  // Organization that owns the referenced resource. Required.
  string org = 1 [
    (buf.validate.field).required = true,
    (buf.validate.field).string.pattern = "^[a-z][a-z0-9-]*$"
  ];

  // Resource slug (user-friendly identifier).
  string slug = 3 [
    (buf.validate.field).required = true,
    (buf.validate.field).string.pattern = "^[a-z][a-z0-9-]*$",
    (buf.validate.field).string.min_len = 1,
    (buf.validate.field).string.max_len = 63
  ];
  // ... rest unchanged
}
```

**Rationale**: Slug/org format validation belongs in proto because:

1. It's reusable across all clients (Go, Python, Java, TypeScript)
2. It's declarative and self-documenting
3. It avoids duplication in CLI, SDK, and backend

### Step 2: Regenerate Proto Stubs

After proto changes:

```bash
cd /Users/suresh/scm/github.com/stigmer/stigmer
bazel run //apis:protos
```

Then sync to stigmer-cloud.

### Step 3: Create Minimal validator.go

Create [internal/cli/agent/validator.go](client-apps/cli/internal/cli/agent/validator.go) for **only** cross-field validations:

```go
// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
    "fmt"
    agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
)

// Validate performs cross-field business logic validation on an Agent.
// Schema validation is handled by protovalidate in Load().
// This function validates relationships between fields that cannot
// be expressed in proto validation rules.
func Validate(agent *agentv1.Agent) error {
    if agent.Spec == nil {
        return nil // Schema validation handles required fields
    }

    if err := validateSubAgentMcpAccess(agent.Spec); err != nil {
        return err
    }

    if err := validateUniqueMcpServerUsages(agent.Spec); err != nil {
        return err
    }

    return nil
}
```

**Key functions (~80 lines total):**

1. `validateSubAgentMcpAccess(spec)` - Ensures SubAgent.mcp_access references only parent's mcp_server_usages
2. `validateUniqueMcpServerUsages(spec)` - Ensures no duplicate mcp_server_ref.slug in mcp_server_usages

### Step 4: Create validator_test.go

Create [internal/cli/agent/validator_test.go](client-apps/cli/internal/cli/agent/validator_test.go) with table-driven tests:

**Test cases (~120 lines):**

- Valid agent passes validation
- SubAgent references non-existent mcp_server → error
- SubAgent tools not subset of parent → error
- Duplicate mcp_server_usages → error
- Empty mcp_server_usages (valid)
- Empty sub_agents (valid)

---

## Files Summary


| File                                   | Action | Lines (est) |
| -------------------------------------- | ------ | ----------- |
| `apis/.../apiresource/io.proto`        | Modify | +10 lines   |
| `internal/cli/agent/validator.go`      | Create | ~80 lines   |
| `internal/cli/agent/validator_test.go` | Create | ~120 lines  |
| `internal/cli/agent/BUILD.bazel`       | Modify | +3 lines    |


---

## Design Decision: Why This Approach

### What We're NOT Doing (per user directive)

- NOT duplicating apiVersion/kind/metadata validation (already in proto)
- NOT duplicating instructions min_len validation (already in proto)
- NOT duplicating skill_refs/mcp_server_usages kind validation (already in proto via CEL)

### What We ARE Doing

1. **Strengthening proto**: Adding slug/org format validation where it belongs
2. **Minimal Go code**: Only for cross-field logic that CANNOT be proto

This follows the principle: **Proto is the single source of truth for schema validation.**

---

## Alternative Considered

**Alternative**: Skip proto changes, add all validation in Go.

**Rejected because**:

- Creates technical debt (MCP Server already has this problem)
- Duplicates validation across clients
- Violates user's explicit directive about proto validate
- Proto validations are declarative and self-documenting

---

## Quality Checklist

- No duplication of proto validations in Go
- Every error wrapped with specific context
- Functions under 50 lines
- Files under 250 lines
- Table-driven tests with comprehensive edge cases
- Follows existing loader_test.go patterns

