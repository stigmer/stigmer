# Fix Codegen: Stale Bazel Go Dependencies and Cascading Build Failures

**Date**: May 22, 2026

## Summary

Resolved `make codegen` failure caused by a stale `use_repo(go_deps, ...)` block in `MODULE.bazel`, along with three cascading issues uncovered once the primary blocker was removed: Go dependency version mismatches, a protobuf-es v2 API incompatibility in the React SDK, and a missing Node.js package export condition for the TypeScript proto stubs.

## Problem Statement

Running `make codegen` failed at the Bazel/Gazelle step with:

```
ERROR: module extension "go_deps" from "@@gazelle+//:extensions.bzl" does not generate repository "com_github_fullstorydev_grpcurl"
```

This blocked all downstream code generation (Go stubs, SDK clients, documentation).

### Pain Points

- 18 repositories listed in `use_repo` no longer existed in any `go.mod` file
- 3 new direct dependencies were missing from `use_repo`
- `go.temporal.io/api` and `golang.org/x/oauth2` had inconsistent versions across workspace modules
- Once Bazel passed, the React SDK `typedoc` step failed on a stale `Struct.fromJson()` call (protobuf-es v1 API used in a v2 codebase)
- Once docs generation passed, CLI doc generation failed due to an ambiguous `google.golang.org/genproto` import (old monolithic vs split modules)
- Once CLI passed, narration generation failed because `@stigmer/protos` only exported for ESM, not CJS-compatible resolution

## Solution

Applied a layered fix addressing each issue in dependency order:

1. `bazel mod tidy` to regenerate the `use_repo` block
2. Version alignment across all `go.work` modules
3. `go.work` replace directive to pin `google.golang.org/genproto` and resolve the ambiguous import from `improbable-eng/grpc-web`
4. Migrate `Struct.fromJson()` to protobuf-es v2 API (`JsonObject` type assertion)
5. Add `"default"` export condition to `@stigmer/protos` package.json

## Implementation Details

### Bazel Module Sync

- Ran `./bazelw mod tidy` which automatically removed 18 stale entries and added 3 missing entries (`com_github_golang_jwt_jwt_v5`, `com_github_stigmer_stigmer_test_integration`, `org_mongodb_go_mongo_driver_v2`)
- Reclassified 2 repos from direct to indirect

### Go Dependency Alignment

- Updated `go.temporal.io/api` v1.62.1 → v1.62.12 in `backend/services/stigmer-server`, `test/integration`, `test/integration-security`
- Updated `golang.org/x/oauth2` v0.35.0 → v0.36.0 in `client-apps/cli`, `backend/libs/go`, `mcp-server`, `test/integration`, `test/integration-security`
- Added `replace google.golang.org/genproto => google.golang.org/genproto v0.0.0-20260519071638-aa98bba5eb94` in `go.work` to resolve the conflict introduced by `improbable-eng/grpc-web@v0.15.0`

### React SDK TypeScript Fix

In `sdk/react/src/workflow/useWorkflowExecutionActions.ts`:
- Removed import of `Struct` from `@bufbuild/protobuf/wkt` (type-only in v2)
- Imported `JsonObject` type from `@bufbuild/protobuf`
- Replaced `Struct.fromJson(formData)` with `formData as JsonObject | undefined` (protobuf-es v2 uses `JsonObject` directly for Struct fields in `create()`)

### TypeScript Proto Package Exports

In `apis/stubs/ts/package.json`:
- Added `"default": "./dist/*.js"` to the exports map alongside `"import"`
- Ensures the wildcard export resolves in both ESM and CJS-compatible contexts (fixes `tsx`-based narration scripts)

## Benefits

- `make codegen` runs end-to-end successfully (exit 0)
- All SDK code generation (Go, TypeScript, Python, Java) produces correct output
- All documentation generation (proto docs, React SDK docs, Ink docs, CLI docs) passes
- Narration generation completes with all 25 scenarios and 117 cached audio files
- Dependency graph is consistent — no Bazel warnings about implicit version bumps

## Impact

- **Developers**: Unblocked from running `make codegen` locally
- **CI**: Codegen verification gate will pass again
- **SDK consumers**: No API changes — only internal build infrastructure was affected

## Related Work

- The 18 removed packages (go-openai, go-anthropic, posthog, grpcurl, gojq, godotenv, semver, viper, serverlessworkflow/sdk-go, etc.) were intentionally removed from the dependency tree in prior sessions — they no longer appear in any `go.mod` and the codebase compiles without them
- The `improbable-eng/grpc-web` genproto conflict is a known issue pattern with archived Go libraries; a future cleanup could replace it with a maintained alternative

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
