---
name: T02 Session Proto volume_id
overview: Add a `volume_id` field to `SessionSpec` in the session proto (stigmer OSS repo) and regenerate stubs in stigmer-cloud. This is a small, precisely-scoped proto change that unblocks T03.
todos:
  - id: edit-proto
    content: Add `string volume_id = 6` with comment to SessionSpec in stigmer/apis/ai/stigmer/agentic/session/v1/spec.proto
    status: pending
  - id: regen-stubs
    content: Run `make build` in stigmer-cloud/apis to regenerate stubs for all 5 languages (Go, Python, Java, TypeScript, Dart)
    status: pending
  - id: verify-stubs
    content: Spot-check generated stubs to confirm volume_id field appears correctly
    status: pending
isProject: false
---

# T02: Add `volume_id` to SessionSpec Proto

## Correction from T01 Plan

The T01 plan stated this change lives in stigmer-cloud. It does not. The proto **source** is in the stigmer OSS repo. stigmer-cloud only generates stubs from it.

- **Proto source**: [apis/ai/stigmer/agentic/session/v1/spec.proto](apis/ai/stigmer/agentic/session/v1/spec.proto) (stigmer repo)
- **Stub generation**: [apis/Makefile](../stigmer-cloud/apis/Makefile) (stigmer-cloud repo, `make build`)

## Current State of SessionSpec

```proto
message SessionSpec {
  string agent_instance_id = 1;  // field 1
  string subject = 2;            // field 2
  string thread_id = 3;          // field 3
  string sandbox_id = 4;         // field 4
  map<string, string> metadata = 5;  // field 5
}
```

Next available field number: **6**.

## The Change

Add one field to `SessionSpec`:

```proto
  // Daytona volume ID (org-scoped, mounted with session subpath for workspace persistence).
  string volume_id = 6;
```

**Design rationale** (why store it explicitly rather than deriving from org_id):

- Follows the same pattern as `sandbox_id` -- direct ID lookup is more reliable than name-based search
- Decouples the session from the volume naming convention
- Provides an audit trail of which volume each session used
- The Daytona Volume API ID may differ from the human-readable name

## Comment Style

Matching the existing single-line comment pattern with parenthetical behavior notes:

- `sandbox_id`: "Daytona sandbox ID (created on first execution, reused for file persistence)."
- `volume_id`: "Daytona volume ID (org-scoped, mounted with session subpath for workspace persistence)."

## Steps

1. **Edit `spec.proto**` in the stigmer repo -- add the `volume_id` field as field 6
2. **Regenerate stubs** in stigmer-cloud via `make build` in `apis/` directory -- this picks up the proto change via the local directory reference (`../../stigmer/apis`)
3. **Verify** the generated stubs compile and the field appears correctly in Go, Python, Java, TypeScript, and Dart outputs

## What This Does NOT Touch

- No behavioral code changes (that's T03+)
- No changes to `sandbox_manager.py`, `execute_graphton.py`, or any service code
- No changes to other proto files (api.proto, query.proto, command.proto, io.proto)
- No changes to the `sandbox_id` field or its comment (even though the comment says "for file persistence" which volumes will partially replace -- that's a separate concern for later)

## Risk Assessment

- **Backward compatible**: Adding a new optional field to proto3 is always backward compatible. Existing consumers ignore unknown fields.
- **No breaking changes**: Field number 6 is unused. No field renumbering.
- **Generated stubs**: All 5 languages will get the new field automatically via buf generate.

