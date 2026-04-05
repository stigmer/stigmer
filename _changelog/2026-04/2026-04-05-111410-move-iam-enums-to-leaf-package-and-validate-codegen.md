# Move IAM Enums to Leaf Package and Validate Full Codegen Pipeline

**Date**: April 5, 2026

## Summary

Relocated `IamRole` and `IamPermission` enums from the `ai.stigmer.iam.iampolicy.v1` proto package to a new dedicated leaf package `ai.stigmer.iam.v1`, resolving a Go import cycle that prevented SDK codegen. Validated the entire codegen and build pipeline end-to-end across both stigmer (OSS) and stigmer-cloud (backend) repositories — all stubs, SDK clients, backend compilation, and tests pass.

## Problem Statement

Running `make protos` after phases 1-6 of the IAM role/permission separation failed with a Go import cycle during SDK codegen.

### Pain Points

- The `iampolicy/v1` proto package is a "fat" package containing `api.proto`, `command.proto`, `query.proto`, `spec.proto`, and `io.proto` — all of which import from `apiresource` and `apiresourcekind`
- Adding `repeated IamRole grantable_roles` to `AuthorizationConfig` (in `apiresourcekind`) created a new dependency edge: `apiresourcekind` → `iampolicy/v1`
- The existing reverse edges (`iampolicy/v1` → `apiresource` → `apiresourcekind`) completed two import cycles
- Proto file-level imports don't cause cycles (proto resolves per-file), but Go combines all files from a proto package into one Go package, making the cycle fatal at the Go level
- Session 2's verification ("enum.proto is a leaf with zero imports") was correct at the proto level but insufficient for Go's package semantics

## Solution

Moved both `IamRole` and `IamPermission` to a new proto package `ai.stigmer.iam.v1` at `apis/ai/stigmer/iam/v1/enum.proto`. This package is a pure leaf — zero imports, zero dependencies. Any package can import it without inheriting transitive Go dependencies.

The `iampolicy/v1` package remains for the IamPolicy resource lifecycle (api.proto, spec.proto, command.proto, etc.) and no longer owns the enum definitions.

## Implementation Details

### Proto changes (stigmer repo)

- **Created** `apis/ai/stigmer/iam/v1/enum.proto` — package `ai.stigmer.iam.v1`, containing `IamPermission` (20 values) and `IamRole` (4 values)
- **Updated** `apis/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config.proto` — import path and type reference changed from `ai.stigmer.iam.iampolicy.v1.IamRole` to `ai.stigmer.iam.v1.IamRole`
- **Updated** `apis/ai/stigmer/commons/rpc/authorization_config.proto` — import path and type reference changed from `ai.stigmer.iam.iampolicy.v1.IamPermission` to `ai.stigmer.iam.v1.IamPermission`
- **Deleted** `apis/ai/stigmer/iam/iampolicy/v1/enum.proto` — old location

### Backend changes (stigmer-cloud repo)

- Updated 51 Java files: import path `protos.ai.stigmer.iam.iampolicy.v1.{IamPermission,IamRole}` → `protos.ai.stigmer.iam.v1.{IamPermission,IamRole}`
- Fixed pre-existing Temporal SDK bug in `CleanupSandboxWorkflowImpl.java` (`Workflow.getMemo` API mismatch)

### Codegen validation

- `make protos` in stigmer: buf lint, stubs (Go/Java/Python/TS), proto2schema, SDK codegen (Go/MCP/TS/Python/Java) — all passed
- `make protos` in stigmer-cloud: stubs (Java/Go/Python/TS/Dart) — all passed
- `make build-java` in stigmer-cloud: 56 Bazel targets built successfully
- `make test-backend` in stigmer-cloud: 7/7 tests passed

## Benefits

- **Unblocked codegen**: The full `make protos` pipeline runs end-to-end without errors
- **Architectural clarity**: IAM vocabulary types (roles, permissions) now live in a dedicated package that communicates "these are shared IAM primitives" rather than being buried inside the iampolicy resource package
- **Import safety**: The leaf package pattern ensures no future Go import cycles from packages needing `IamRole` or `IamPermission`
- **End-to-end validation**: Phases 1-6 of the IAM role/permission separation are now proven correct across proto definitions, 4 stub languages, SDK clients, MCP server, Java backend compilation, and test suite

## Impact

- **stigmer repo**: Proto sources, all generated stubs (Go/Java/Python/TS), SDK codegen outputs, MCP server codegen, JSON schemas
- **stigmer-cloud repo**: All regenerated stubs, 51 Java handler/service/test files with import updates
- **Downstream consumers**: Any code importing `IamPermission` or `IamRole` needs to use the `iam.v1` package path instead of `iam.iampolicy.v1`

## Related Work

- Part of the IAM role/permission separation project (`20260405.01.iam-role-permission-separation`)
- Follows up on the `grantable_roles` addition (2026-04-05-103958 changelog)
- Prerequisite for Phase 7 (backend FGA tuple code and SDK/web role selectors)

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour (diagnosis, fix, full validation)
