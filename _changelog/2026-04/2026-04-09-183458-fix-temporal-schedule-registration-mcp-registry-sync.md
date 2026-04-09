# Fix Temporal Schedule Registration for MCP Registry Sync

**Date**: April 9, 2026

## Summary

The daily MCP Registry sync schedule (`mcp-registry-sync-daily`) was never appearing in the Temporal UI despite being deployed. The root cause was that `McpRegistrySyncScheduleRegistrar` manually constructed a `ScheduleClient` from raw `WorkflowServiceStubs`, bypassing the fully configured bean that `temporal-spring-boot-starter` already provides. Refactored the registrar to inject the auto-configured `ScheduleClient`, which carries the correct namespace, data converter, and interceptors.

## Problem Statement

After deploying the MCP Registry sync feature (Temporal workflow + daily schedule), the `mcp-registry-sync-daily` schedule never appeared in the Temporal UI. The workflow, activities, and worker registration were all correct, but the schedule itself was invisible.

### Pain Points

- The schedule was silently failing to register on every application startup
- The original `log.warn` catch-all swallowed the real error with no stacktrace
- Manual `ScheduleClient` construction duplicated configuration that the Spring Boot starter already handles
- No fail-fast behavior: the app started successfully even when schedule registration was broken

## Solution

Replaced the manual `ScheduleClient` construction with injection of the `@Primary` bean auto-configured by `temporal-spring-boot-starter:1.31.0`. This is the idiomatic approach that aligns with how `WorkflowClient` and `WorkerFactory` are already consumed elsewhere in the service.

## Implementation Details

### What changed in `McpRegistrySyncScheduleRegistrar`

**Removed:**
- `WorkflowServiceStubs` constructor dependency
- `@Value("${spring.temporal.namespace:default}")` namespace injection
- Manual `ScheduleClient.newInstance(stubs, opts)` call inside the event handler

**Added:**
- `ScheduleClient` as a constructor-injected field (the `@Primary` `temporalScheduleClient` bean)
- Restored `@RequiredArgsConstructor` for clean Lombok wiring

**Preserved:**
- `ApplicationReadyEvent` listener for create-or-update schedule logic
- `ScheduleAlreadyRunningException` handling for idempotent restarts
- `log.error` with full stacktrace on failure

### Why the auto-configured bean matters

The `temporal-spring-boot-starter` `RootNamespaceAutoConfiguration` creates the `ScheduleClient` with:
- `setNamespace(namespace)` from `spring.temporal.namespace` (resolves `TEMPORAL_NAMESPACE` env var)
- `setDataConverter(...)` from the auto-configured `DataConverter`
- `setInterceptors(...)` from any registered `ScheduleClientInterceptor` beans

The manual construction missed the data converter and interceptors, and initially also missed the namespace entirely (defaulting to `"default"`).

### Fail-fast behavior

If the `ScheduleClient` bean cannot be injected (e.g., auto-configuration isn't active), Spring now fails at startup instead of silently ignoring the missing schedule at runtime.

## Benefits

- Schedule registration uses the same fully-configured `ScheduleClient` that the rest of the Temporal infrastructure uses
- Fail-fast: broken configuration surfaces at startup, not as a silent runtime gap
- Less code: removed ~15 lines of manual client construction and namespace plumbing
- Consistent with how `WorkflowClient` and `WorkerFactory` are already consumed

## Impact

- **MCP Registry sync**: The daily sync schedule (`0 0 * * *`) will now register correctly in the production Temporal namespace
- **Observability**: The schedule becomes visible in the Temporal UI, with run history, next-run time, and pause/resume controls
- **Reliability**: Each app restart idempotently creates or updates the schedule

## Related Work

- `2026-04-08-165622-automated-mcp-registry-sync-pipeline.md` — Original MCP Registry sync implementation
- `2026-04-09-111611-mcp-connect-flow-proto-fga-codegen.md` — MCP connect flow that depends on synced servers

### Collateral finding (not addressed here)

The custom `temporal-starter` library (`TemporalWorkflowClientConfig`) creates a `WorkflowClient.newInstance(stubs)` without setting namespace. It coexists alongside the auto-configured `@Primary` `temporalWorkflowClient` bean which IS namespace-aware. Thanks to `@Primary`, injection points get the correct client, but the redundant bean is technically wrong and should be cleaned up in a separate change.

---

**Status**: Production Ready
**Repo**: stigmer-cloud
**Commits**: `c3ed6ea5` (namespace fix), `0629699a` (auto-configured ScheduleClient injection)
