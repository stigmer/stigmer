# Rename `env_refs` to `environment_refs` in WorkflowInstanceSpec

**Date**: March 20, 2026

## Summary

Standardized the environment reference field name across Instance specs. `WorkflowInstanceSpec` used `env_refs` while `AgentInstanceSpec` used `environment_refs` — same concept, different names. This rename brings naming parity across the domain and adds a missing validation rule.

## Problem Statement

`AgentInstance` and `WorkflowInstance` both reference Environment resources via a repeated `ApiResourceReference` field. But they used different names for the identical concept:

### Pain Points

- `AgentInstanceSpec.environment_refs` vs `WorkflowInstanceSpec.env_refs` — inconsistent naming for the same domain concept
- Developers reading one spec and switching to the other had to remember two field names
- `WorkflowInstanceSpec.env_refs` had no CEL validation, while `AgentInstanceSpec.environment_refs` validated `kind=environment` — a correctness gap
- The abbreviation `env_refs` violated the ubiquitous language principle: the domain term is "Environment," not "Env"

## Solution

Renamed `env_refs` to `environment_refs` in the proto definition and propagated the change through the full code generation pipeline across both repos. Added the same CEL validation rule that `AgentInstanceSpec` already had.

## Implementation Details

**Proto source** (stigmer):
- Renamed field in `WorkflowInstanceSpec` from `env_refs` to `environment_refs` (field number 3 unchanged — binary wire compatible)
- Added `buf.validate` CEL rule: `this.kind == 52` (environment enum value)
- Updated 6 comment references across `command.proto`, `query.proto`, `io.proto`

**Generated code** (both repos):
- Regenerated proto stubs in Go, Java, TypeScript, Python, Dart
- Regenerated SDK gen files in Go, TypeScript, Java, Python
- Regenerated MCP server gen file

**Hand-written backend** (stigmer-cloud):
- `WorkflowInstanceCreateHandler.java` — `getEnvRefsList()` → `getEnvironmentRefsList()`
- `CreateExecutionContextStep.java` — accessor, variable names, comments, log messages
- `EnvironmentMergeServiceTest.java` — test method name and `@DisplayName`

## Benefits

- **Naming consistency**: Both Instance specs now use `environment_refs` — one name, one concept
- **Validation parity**: WorkflowInstance now rejects invalid environment references at the proto validation layer, matching AgentInstance behavior
- **Ubiquitous language**: Field name matches the domain term "Environment" exactly

## Impact

- **Proto API**: Field name change from `env_refs`/`envRefs` to `environment_refs`/`environmentRefs` (JSON wire format changes, binary format unchanged)
- **All SDK languages**: TypeScript, Java, Go, Python, Dart — all updated via codegen
- **Backend**: Three Java files updated in stigmer-cloud
- **No migration needed**: Confirmed no persisted WorkflowInstance data exists

## Related Work

- Part of the [secrets-flow-hardening](../_projects/2026-03/20260319.06.secrets-flow-hardening/) project (T03)
- Companion commits: `bd1fca76` (stigmer), `a307f32c` (stigmer-cloud)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
