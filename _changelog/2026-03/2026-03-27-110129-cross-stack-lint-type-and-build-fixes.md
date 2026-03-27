# Cross-Stack Lint, Type, and Build Fixes

**Date**: March 27, 2026

## Summary

Resolved all `make check` failures across the stigmer and stigmer-cloud repositories, spanning Go, Python, TypeScript, and Java. Fixes addressed static analysis violations, type mismatches, and incorrect Protobuf message construction to bring both codebases to a clean build state.

## Problem Statement

Running `make check` surfaced failures across multiple language ecosystems and services, blocking CI and preventing clean merges of recent feature work (MCP server discovery, ExecutionContext, approval policies).

### Pain Points

- Go lint errors in `discover_capabilities.go` — non-constant format strings passed to `grpclib.FailedPreconditionError`
- Java compile errors in `McpServerDiscoverCapabilitiesHandler.java` — incorrect `CustomOperationContextV2` key type and `void` return from `executionContextRepo.save()` being assigned
- Python ruff/mypy failures across agent-runner — unused imports, unused variables, incorrect `getattr` defaults, and type mismatches with third-party `MultiServerMCPClient`
- TypeScript build errors in `useTriggerApprovalPolicySession.ts` — plain object literal passed where a typed Protobuf message was expected, `string` passed as `Uint8Array`, and wrong field names

## Solution

Systematically ran `make check`, triaged each failure by language and service, applied targeted fixes aligned with existing codebase patterns, and verified each fix passed before moving to the next category.

## Implementation Details

### Go (stigmer-server)

Corrected `grpclib.FailedPreconditionError` calls to pass format string and variadic arguments directly instead of wrapping with `fmt.Sprintf`, matching the function's printf-style signature.

### Java (stigmer-cloud/stigmer-service)

- Changed `CTX_WORKFLOW_OUTPUT` from a `String` constant to an `io.grpc.Context.Key<Map>`, consistent with the `CustomOperationContextV2` API that expects `Context.Key` objects for `put`/`get`.
- Refactored `createExecutionContext` to pre-generate the resource ID via `ApiResourceDefaultIdBuilder.build()` before calling `executionContextRepo.save()`, since the repository's `save()` method returns `void`.

### Python (agent-runner)

- Auto-fixed 20 ruff violations (unused imports, import sorting, quoted type annotations) via `ruff check --fix`.
- Manually resolved 4 remaining issues: removed dead code (`VolumeMount` import, `volume_mounts` variable, `events_processed` variable, `params` variable in tests).
- Restored intentional re-exports with `# noqa: F401` annotations to preserve test compatibility.
- Fixed mypy errors: corrected `getattr` default from `""` to `None` for optional attributes, added justified `type: ignore[arg-type]` for `MultiServerMCPClient` third-party type mismatch, and used defensive `getattr` for optional `initialize_result`.

### TypeScript (sdk/react)

- Constructed `UploadAttachmentRequest` using `create(UploadAttachmentRequestSchema, {...})` from `@bufbuild/protobuf` instead of a plain object literal, satisfying the `$typeName` requirement.
- Encoded `mcpServerYaml` string content to `Uint8Array` via `TextEncoder` for the `content` field.
- Corrected `fileName` to `filename` to match the Protobuf schema's field naming.
- Added `contentType: "application/x-yaml"` for proper attachment metadata.

## Benefits

- Both repositories pass `make check` cleanly (stigmer has 2 pre-existing unrelated test failures confirmed by baseline comparison)
- Eliminates CI blockers for the recent MCP discovery and approval policy feature branches
- Strengthens type safety across all four language stacks
- Maintains alignment with SDK-first architecture — TypeScript fixes use schema-driven Protobuf construction rather than ad-hoc object literals

## Impact

- **Backend teams**: Clean builds for Go server and Python agent-runner
- **SDK consumers**: `useTriggerApprovalPolicySession` hook now compiles with strict TypeScript and constructs valid Protobuf messages
- **Platform builders**: Correct Protobuf message construction ensures runtime correctness when embedding approval policy flows

## Related Work

- [Secure Discovery with ExecutionContext](2026-03-27-102916-secure-discovery-with-execution-context.md) — the feature branch whose code introduced the Go and Java compilation issues
- [Fix Discovery Credential Security](2026-03-27-094850-fix-discovery-credential-security.md) — prior credential resolution refactoring
- [HITL Frontend Approval Resilience](2026-03-27-094233-hitl-frontend-approval-resilience.md) — approval policy feature that introduced the TypeScript hook

---

**Status**: Production Ready
**Timeline**: Single session
