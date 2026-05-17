# Fix All CI Gate Failures Across the Full Stack

**Date**: May 17, 2026

## Summary

Resolved all `make check` failures in both the Stigmer OSS and Stigmer Cloud repositories. The fixes span Python linting, Java compilation, mypy type checking, ESLint configuration, Vale documentation linting, TypeDoc validation, Prettier formatting, Next.js build errors, and Go test assertion drift — bringing both repos to a fully green CI state.

## Problem Statement

Running `make check` in both repositories produced multiple failures across different stages of the CI pipeline, blocking any clean commit or PR.

### Pain Points

- **Stigmer OSS**: Failed at 8 different stages — `fix` (Python N806), `lint` (mypy attr-defined, ESLint rule-not-found), `lint-docs` (Vale repetition), `tsdoc-check` (unresolved symbol link), `format-docs-check` (Prettier drift), `libs-build` (React memo test), `build-web` (Next.js client/server conflict), and `test` (Go converter assertion drift)
- **Stigmer Cloud**: Failed at `build-backend` — Java compilation errors in two test files (`RunnerHeartbeatServiceTest`, `ProxyScopeAuthorizationTest`) plus a missing Bazel dependency

## Solution

Systematically ran each CI target, identified root causes, applied minimal targeted fixes, and re-verified only the affected targets to iterate quickly.

## Implementation Details

### Stigmer Cloud (3 fixes)

1. **RunnerHeartbeatServiceTest.java** — `RunnerRepo.save()` gained a checked exception; added `throws Exception` to 6 test method signatures in the `MultiProcessTests` inner class
2. **BUILD.bazel** — Added `@maven//:com_google_protobuf_protobuf_java` to `runner_heartbeat_service_test` deps (strict dependency enforcement)
3. **ProxyScopeAuthorizationTest.java** — `authorizeProxyScopes()` gained a new `workflowExecutionId` parameter; inserted `null` for the new parameter in all 19 call sites across 4 test classes

### Stigmer OSS (10 fixes)

1. **Python lint (N806)** — Renamed `_PLAN_MODE` → `plan_mode` and `_PLAN_SAFE_TOOLS` → `plan_safe_tools` in both copies of `agent.py` (graphton lib + embedded CLI copy)
2. **mypy (attr-defined)** — Reinstalled proto stubs into agent-runner venv so `ExecutionConfig.interaction_mode` is recognized
3. **mypy (import)** — Fixed `TraceContextTextMapPropagator` import path from `opentelemetry.trace.propagation` to `opentelemetry.trace.propagation.tracecontext` (both copies of `otel.py`)
4. **ESLint** — Removed orphaned `eslint-disable-next-line react-hooks/exhaustive-deps` comments from `WorkflowYamlEditor.tsx` and `useWorkflowCanvas.ts` (rule not registered in flat config)
5. **TypeDoc** — Added `useContextWindow` to `externalSymbolLinkMappings` in `sdk/ink/typedoc.json`
6. **Vale** — Restructured Mermaid diagram in `docs/concepts/environments.mdx` to avoid word-repetition false positive
7. **Prettier** — Ran `make format-docs` to fix formatting drift in 20 documentation files
8. **Next.js build** — Split `client-apps/web/src/app/executions/[id]/page.tsx` into a server component (with `generateStaticParams`) and a client component (`ExecutionRoute.tsx`) to resolve Turbopack error
9. **React memo test** — Updated `SessionComposer-memo.test.ts` to accept `forwardRef` object type (not just plain function) as the inner type of a `React.memo` wrapper
10. **Go converter tests** — Updated 5 assertions across `proto_to_yaml_test.go` and `integration_test.go` to match current YAML output format for switch, raise, and run tasks

## Benefits

- Both repositories now pass `make check` end-to-end
- Unblocks commits and PRs for all in-flight feature work
- Each fix is minimal and targeted — no unnecessary refactoring

## Impact

- **Stigmer Cloud**: All 68 Bazel Java tests pass, full build succeeds
- **Stigmer OSS**: All targets pass — `tidy`, `fix`, `lint`, `lint-docs`, `format-docs-check`, `tsdoc-check`, `gen-sdk-docs`, `gen-sdk-docs-check`, `check-links`, `build`, `test`, `validate-demos`

## Related Work

- Proto stub regeneration for `interaction_mode` field (eval task, execution config additions)
- Converter YAML format changes for switch/raise/run tasks

---

**Status**: ✅ Production Ready
**Timeline**: ~1 hour
