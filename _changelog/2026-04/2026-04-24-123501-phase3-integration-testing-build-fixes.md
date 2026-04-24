# Phase 3 Integration Testing: Build Fixes + Runner Hook Test Coverage

**Date**: April 24, 2026

## Summary

Completed T09 (Integration Testing) for Phase 3 Persistent Runners. Fixed three build-breaking issues across stigmer and stigmer-cloud (dead Java handler, stale test compilation errors, incomplete Go Bazel targets), added 18 automated React SDK tests for the runner hook module, and documented a manual integration testing checklist for end-to-end flows.

## Problem Statement

Phase 3 implemented 7 tasks (T02-T08) adding launch tokens, Docker placement, runner stop via command stream, SDK hooks, and Settings > Runners full CRUD. Three build/CI issues were left behind, and the new React SDK runner module had zero test coverage.

### Pain Points

- `SessionUpdateSandboxIdHandler.java` blocked **all** Java compilation in stigmer-cloud — the file imported proto types (`UpdateSessionSandboxIdRequest`, `SessionCommandController.Method.updateSandboxId`) that were removed during the April 2026 runner/Daytona cleanup, but the Java handler was never deleted
- `RunnerStopHandlerTest.java` had 5 pre-existing compilation errors: stale proto type name, stale `InterceptorContextHolder` API (migrated from thread-local to gRPC `Context.Key`), missing `throws Exception`, missing Bazel dep, and wrong Bazel rule type
- `stop.go` and `stop_test.go` in the Go runner controller were missing from `BUILD.bazel` — the stop functionality existed on disk but was invisible to Bazel CI
- `runner_stream_commands_test.go` in the Go CLI daemon had the same issue — written but never added to the Bazel test target
- The runner module in `@stigmer/react` (`useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner`) had zero automated tests despite being a critical user-facing surface

## Solution

### Build Fixes (stigmer-cloud)

1. **Deleted `SessionUpdateSandboxIdHandler.java`** — dead code. The `sandbox_id` field on `SessionSpec` is deprecated; sandbox lifecycle moved to runner metadata labels. No replacement handler needed.

2. **Fixed `RunnerStopHandlerTest.java`**:
   - `CheckAuthorizationOutput` → `CheckAuthorizationResult` (proto type renamed)
   - Rewrote `InterceptorContextHolder` usage from deprecated `setContext()`/`clearContext()` to gRPC `Context.current().withValue(getContextKey(), ctx).attach()` with proper `detach()` in teardown
   - Added `throws Exception` to `offlineRunner()` test method for `RunnerRepo.save()` checked exception
   - Added `//backend/libs/java/grpc/grpc-request` dep to BUILD.bazel
   - Changed `java_test` to `java_junit5_test` for consistency with all other test targets

### Build Fixes (stigmer)

3. **Fixed runner controller `BUILD.bazel`** — added `stop.go` to `go_library.srcs`, `stop_test.go` to `go_test.srcs`, plus deps: `//apis/stubs/go/.../apiresource`, `.../apiresourcekind`, `//backend/libs/go/store/sqlite`, `@org_golang_google_grpc//metadata`

4. **Fixed daemon `BUILD.bazel`** — added `runner_stream_commands_test.go` to `go_test.srcs` (same class of issue from T06)

### React SDK Tests

Added 18 tests across 3 files in `sdk/react/src/runner/__tests__/` following established Vitest + `@testing-library/react` + `happy-dom` patterns:

- **`useLaunchLocalRunner.test.tsx`** (8 tests): success flow with URL construction and `openUrl` callback, URL encoding of special characters, custom `openUrl` override, missing `expiresAt` handling, error states, non-Error rejection normalization, `clearError`, error recovery on retry
- **`useStopRunner.test.tsx`** (5 tests): proto message construction with `runnerId` + optional `reason`, default empty reason, error states, `clearError`, error recovery
- **`useDeleteRunner.test.tsx`** (5 tests): ID passthrough, error states, non-Error rejections, `clearError`, error recovery

## Implementation Details

### Java `InterceptorContextHolder` Migration

The test originally used:
```java
InterceptorContextHolder.setContext(ctx);  // throws UnsupportedOperationException
InterceptorContextHolder.clearContext();    // method doesn't exist
```

The class migrated from `ThreadLocal`-based storage to gRPC's `Context.Key` mechanism. The fix uses:
```java
previousGrpcContext = Context.current()
    .withValue(InterceptorContextHolder.getContextKey(), ctx)
    .attach();
// teardown:
Context.current().detach(previousGrpcContext);
```

### React SDK Test Pattern

Tests follow the established mock-client-in-provider pattern:
```tsx
const client = { runner: { createLaunchToken: vi.fn() } } as unknown as Stigmer;
const wrapper = ({ children }) => (
  <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
);
const { result } = renderHook(() => useLaunchLocalRunner({ openUrl }), { wrapper });
```

## Benefits

- stigmer-cloud Java builds are unblocked — `LaunchTokenServiceTest` and `RunnerStopHandlerTest` both pass
- Go runner controller and daemon stream command tests now run in Bazel CI (previously invisible)
- Runner hook module has test coverage: success paths, error handling, state management, edge cases
- Manual integration checklist provides structured verification for end-to-end flows

## Impact

- **stigmer-cloud**: 1 file deleted, 2 files fixed. `stigmer_service_lib` compiles cleanly. Both runner test targets pass.
- **stigmer**: 2 BUILD.bazel files fixed, 3 test files added. Full SDK test suite: 114 tests pass (96 existing + 18 new).
- **Phase 3 project**: T09 complete. All automated tasks done. Manual integration testing checklist documented.

## Related Work

- Phase 3 project: `_projects/2026-04/20260423.02.phase3-persistent-runners-browser-launch/`
- T06 Runner Stop: `_changelog/2026-04/2026-04-24-*-runner-stop-via-command-stream.md`
- T07 SDK Hooks: `_changelog/2026-04/2026-04-24-*-sdk-runner-action-hooks.md`
- T08 Settings CRUD: `_changelog/2026-04/2026-04-24-*-settings-runners-full-crud.md`
- Runner/Daytona cleanup: `_changelog/2026-04/2026-04-22-125323-rename-agentrunner-to-runner.md`

---

**Status**: ✅ Production Ready
**Timeline**: Session 7 of Phase 3 project
