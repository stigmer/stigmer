# Eliminate org: local from Secondary API Docs and Validation Rules

**Date**: March 3, 2026

## Summary

Removed all remaining `org: local` from secondary API documentation and the agent-creator validation rules, completing the org portability sweep across the entire OSS codebase. This is the final cleanup pass — all hand-written source files are now free of hardcoded `org: local`.

## Problem Statement

After T01.9 eliminated `org: local` from skill-generation-attached docs and product docs, ~14 hits remained in secondary API resource docs (workflow, workflowinstance, agentexecution, project) and the agent spec proto comments. These docs weren't attached to skill generation scripts but were still browsable and could mislead users or agents reading them.

### Pain Points

- Secondary API docs showed `org: local` in getting-started YAML examples
- Proto comments in `spec.proto` showed `org: local` in cross-reference examples despite org being optional since T01.3
- Validation rules in `agent-creator` skill still described org as required in references and used `org: local` in all YAML examples
- Pitfall I ("Missing required fields") incorrectly stated all three fields (org, kind, slug) were required

## Solution

Applied the established T01.9 YAML example org strategy:
- **Metadata `org`**: `local` → `default` (getting-started examples)
- **Cross-references** (mcp_server_ref, skill_refs): remove `org` entirely (relative reference pattern from T01.3)
- **Validation rules**: updated documentation and examples to reflect org as optional

## Implementation Details

### API Docs (6 files)
- `tenancy/project/docs/examples.md`: 1 metadata hit → `org: default`
- `agentic/workflow/docs/examples.md`: 2 metadata hits → `org: default`
- `agentic/workflowinstance/docs/examples.md`: 2 metadata hits → `org: default`
- `agentic/agentexecution/docs/examples.md`: 1 metadata hit → `org: default`
- `agentic/agentexecution/docs/hitl-approvals.md`: 1 cross-ref → removed org
- `agentic/agent/v1/spec.proto`: 5 cross-ref examples in proto comments → removed org

### Validation Rules (1 file)
- `seedpack/skills/agent-creator/references/validation-rules.md`:
  - Removed `org` from 8 cross-reference YAML examples (Pitfalls D, H, L)
  - Rewrote Pitfall I: org is now optional, `kind` and `slug` are the required fields
  - Updated pre-apply checklist: org omitted for same-org references, explicit org must match pattern

### Generated files (need regeneration)
- `apis/stubs/go/.../spec.pb.go` — regenerate via `make protos`
- `tools/codegen/schemas/agentic/agent/*.json` (3 files) — regenerate via codegen pipeline
- `mcp-server/gen/agentic/agent/agent_gen.go` — regenerate via MCP codegen

## Benefits

- Zero `org: local` in any hand-written source file across the entire OSS codebase
- Validation rules now correctly teach the optional-org relative reference pattern
- Getting-started examples use `default` org consistently
- Agents reading these docs will produce portable YAML (no hardcoded org in cross-refs)

## Impact

- **API docs**: All secondary resource docs now match the portable reference patterns
- **Agent-creator skill**: Validation rules teach correct patterns — agents will stop generating `org: local` in references
- **Generated files**: 4 files still contain stale proto comments; cleared by next `make protos` + codegen run

## Related Work

- T01.3: Made org optional in ApiResourceReference (`4f423b9f`)
- T01.9: Primary docs cleanup (`93fd3314`)
- This change: Final secondary docs cleanup (`ca03d434`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~15 minutes)
