# SDK Track Adaptation — Phase 4 of Project Declarative Track

**Date**: February 27, 2026

## Summary

Re-enabled the SDK-based `stigmer apply` flow by replacing the deleted `ProjectRuntime` proto enum with a domain-pure local `Runtime` value object, adapting the synthesis engine, and implementing full orchestration from SDK code execution through to project membership registration. This completes the fourth of five phases in the project declarative track initiative, restoring the SDK apply path under the new reference-based architecture.

## Problem Statement

Phase 1 of the project declarative track removed the `ProjectRuntime` proto enum and embedded resource fields from `ProjectSpec`, replacing them with `ApiResourceReference`-based membership. This broke the SDK synthesis engine and the `executeProjectApply` orchestrator, which both depended on the deleted proto enum. Phase 3 temporarily replaced the SDK path with an error stub directing users to declarative mode.

### Pain Points

- SDK track (`stigmer apply` with `entry_point` in `stigmer.yaml`) was completely non-functional after Phase 1
- `synthesize.go` and `synthesize_test.go` had dead imports to the deleted `ProjectRuntime` proto enum
- No way for SDK-synthesized resources to participate in the new reference-based project membership and reconciliation model
- Skills required special handling (push, not apply) and there was no mechanism to collect their slugs for reference construction

## Solution

Introduced a local `Runtime` value object with an `InferRuntime` constructor that derives the SDK runtime from the entry-point file extension. This replaces the proto enum with a domain-pure CLI-internal type that prevents invalid states at construction time. Built the full SDK orchestration pipeline that synthesizes resources from user code, pushes skills, applies other resources individually, collects `ApiResourceReference`s, and registers project membership for server-side reconciliation.

## Implementation Details

### New: `runtime.go` — Local Runtime Value Object

A typed string constant (`RuntimeGo`, `RuntimePython`, `RuntimeNode`) with an `InferRuntime(entryPoint string) (Runtime, error)` factory function. Maps file extensions (`.go`, `.py`, `.ts`, `.js`, `.mts`, `.mjs`) to runtimes. Returns a clear error with supported extensions listed for unrecognized extensions.

This design was chosen over raw strings (no validation), a new proto enum (couples CLI internals to the wire format), or an interface (unnecessary indirection for a simple value).

### Adapted: `synthesize.go` — Type Migration

Mechanical replacement of `projectv1.ProjectRuntime` with local `Runtime` across `SynthesizeOptions`, `getRuntimeCommand`, `prepareRuntime`, and `formatExecutionError`. Removed the `projectv1` import entirely from the `apply` package.

### New: `apply_project.go` — Full SDK Orchestration

Replaced the Phase 3 error stub with the complete SDK apply flow:

1. **`InferRuntime`** — Derive runtime from entry point extension
2. **`runSynthesis`** — Execute user SDK code, capture `.pb` output files, parse into resource protos
3. **`establishBackendConnection`** — Load config, resolve org, ensure daemon, create gRPC connection
4. **`pushSynthesizedSkills`** — Push each `SkillSynth` via `skill.Push` (local) or `skill.PushRemote` (git), collect slug from response
5. **`applySynthesizedResources`** — Apply agents, workflows, MCP servers via their individual `Apply()` functions
6. **`project.Apply`** — Register `Project.Spec.Members` for server-side reconciliation with optional pruning

### New: `apply_project_result.go` — Result Building

Extracted from `apply_project.go` to stay within file-size guidelines:
- `executeSDKDryRun` — Validates configuration and renders preview without backend connectivity
- `buildSDKResult` — Constructs structured `CommandResult` with member counts by kind

### Enhanced: `artifact/skill.go` — Slug Capture

Added `Slug` field to `SkillArtifactResult`. Populated from `Skill.Metadata.Slug` in the backend's Push RPC response. This is the only reliable source for the skill slug (avoids fragile local slugification logic).

### Tests: `synthesize_test.go` — Complete Rewrite

- Replaced `TestRuntimeFromProtoEnum` with `TestInferRuntime_SupportedExtensions`, `TestInferRuntime_UnrecognizedExtension`, `TestInferRuntime_NoExtension`
- Added `TestGetRuntimeCommand_AllRuntimes` covering valid and invalid runtime constants
- Updated all existing test cases from proto enum constants to local `Runtime` constants

## Benefits

- **SDK track restored**: Users can again use `entry_point` in `stigmer.yaml` to define resources programmatically
- **Domain purity**: `Runtime` is a CLI-internal value object with no proto dependency, following DDD principles
- **Consistent architecture**: SDK track now follows the same pattern as declarative track — apply individually, collect references, register membership
- **Reference-based reconciliation**: SDK-synthesized resources now participate in the same server-side set-difference reconciliation as declarative resources
- **Reliable skill references**: Slug obtained from backend response eliminates potential mismatches from local slug computation

## Impact

- **CLI users**: Can use SDK mode again with `stigmer apply` on projects that have `entry_point` set
- **Platform consistency**: All three apply tracks (atomic, declarative, SDK) now produce the same `ApiResourceReference`-based membership model
- **Maintainability**: The `apply` package no longer depends on the `project/v1` proto package for runtime classification

## Related Work

- Phase 1: Proto API redesign (`c2e69995`) — Removed `ProjectRuntime` enum, introduced `ApiResourceReference`
- Phase 2: Backend reconciliation simplification (`404296eb`) — Replaced reconciliation engine with set-difference
- Phase 3: CLI declarative track (`2026-02-27-205721`) — Implemented directory-scanning apply mode
- Phase 5 (next): Comprehensive testing across all three apply tracks

---

**Status**: ✅ Production Ready (pending commit)
**Timeline**: Single session (~2 hours)
