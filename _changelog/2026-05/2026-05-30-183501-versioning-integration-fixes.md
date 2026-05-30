# Versioning Integration Fixes

**Date**: May 30, 2026

## Summary

Fixed 10 TypeScript compilation errors in the React SDK's workflow versioning hooks, added `versionMessage` support to all four SDK codegens (Go, TypeScript, Python, Java), and wired CLI version operations into the existing verb-first command pattern via `--version`/`--version-history` flags on `stigmer get` and a new `stigmer tag` top-level command.

## Problem Statement

After the workflow versioning infrastructure was scaffolded, the React SDK hooks had integration mismatches with the generated proto stubs and SDK client, causing `npm run typedoc:json` to fail with 10 TypeScript errors. Additionally, the `versionMessage` field was missing from all SDK `*Input` types (the codegen never wired `metadata.version.message`), and the CLI version commands were not registered.

### Pain Points

- `make codegen` followed by TypeScript compilation produced 10 errors across 5 files
- React hooks imported version types from `io_pb` instead of `version_pb`
- `getVersion()` was called with wrong argument patterns (2 positional args instead of 1 object)
- Result unwrapping assumed a wrapper object (`result.version`) when the SDK returns the entry directly
- Field names copied from Skill versioning (`pushedAt`/`pushedBy`) didn't match Workflow proto fields (`appliedAt`/`appliedBy`)
- `artifactStorageKey` referenced on `WorkflowVersionEntry` (a Skill-only field)
- `useWorkflowSave` set `input.versionMessage` but `WorkflowInput` had no such field
- CLI version commands (`list`, `get`, `tag`) were implemented but not registered in the command tree

## Solution

### Codegen: `versionMessage` for versioned resources

Extended all four SDK code generators to conditionally emit `versionMessage` support for versioned resource kinds (workflow, skill). The `versionedKinds` map already existed (used by MCP codegen) but was not wired into SDK input/builder generation.

Changes to `tools/codegen/generator/`:
- `sdk_client.go`: Added `isVersioned bool` to `sdkResourceConfig`, `isVersionedKind()` helper, `VersionMessage` field in Go input struct, and `metadata.Version` wiring in `toProto()`
- `sdk_client_ts.go`: `versionMessage?: string` in TS input interface, `metadata.version` spread in `buildWorkflowProto()` (both oneof and regular paths)
- `sdk_client_python.go`: `version_message: str` in Python dataclass, `metadata.version.CopyFrom()` in `_to_proto()`
- `sdk_client_java.go`: `versionMessage` field/constructor/builder/setter in Java input class, `metaBuilder.setVersion()` in `toProto()`

### React SDK hook fixes

- `useWorkflowVersions.ts`: Fixed import source (`io_pb` -> `version_pb`), field names (`pushedAt` -> `appliedAt`, `pushedBy` -> `appliedBy`), removed phantom `artifactStorageKey` references
- `useWorkflowVersion.ts`: Fixed import, wrapped `getVersion` with `create(GetWorkflowVersionInputSchema, ...)`, fixed result unwrapping
- `useWorkflowVersionDiff.ts`: Same `create()` fix, fixed result unwrapping
- `useWorkflowExecutionGraph.ts`: Changed 2-arg `getVersion` call to single `create()` object

### CLI: verb-first integration

Instead of introducing a `stigmer workflow versions` command tree (which would collide with the existing `stigmer version` config command), version operations were integrated into the existing verb-first CLI pattern:
- `stigmer get workflow <ref> --version <hash-or-tag>`: fetches a specific historical version's YAML
- `stigmer get workflow <ref> --version-history`: displays the version timeline table
- `stigmer tag <type> <ref> <hash> <tag>`: new top-level command for tagging versions

## Benefits

- **Compilation fixed**: React SDK typechecks cleanly (0 errors)
- **Cross-language consistency**: All four SDK languages (Go, TS, Python, Java) now support `versionMessage` on versioned resource inputs
- **Pattern reuse**: The `isVersioned` codegen flag automatically applies to any resource with `is_versioned: true` in its kind metadata
- **CLI consistency**: Version operations follow the existing verb-first pattern instead of introducing a new command hierarchy

## Impact

- All SDK consumers (React, TypeScript, Go, Python, Java)
- CLI users working with workflow version history
- Future versioned resources (agent versioning) get `versionMessage` support automatically

## Related Work

- Workflow Versioning Infrastructure (2026-05-30-175736) — the scaffolding this fixes
- Skill versioning (established the pattern)
- Agent versioning design (proto defined, will benefit from the `isVersioned` codegen)

---

**Status**: Production Ready
**Timeline**: Single session
