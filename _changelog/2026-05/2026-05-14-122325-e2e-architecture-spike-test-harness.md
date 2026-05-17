# E2E Architecture Spike: Integration Test Harness for Stigmer Cloud

**Date**: May 14, 2026

## Summary

Completed the architecture spike for Stigmer's end-to-end integration testing infrastructure. Proved that a Go test harness can start the Stigmer Cloud Java service in an isolated test environment (MongoDB, Redis, Temporal via Testcontainers) and make gRPC calls through the full pipeline -- all in under 8 seconds. Implemented a conditional auth bypass in stigmer-cloud that allows the service to run without Auth0/OpenFGA for testing.

## Problem Statement

The existing E2E test suite (15 tests in `test/e2e/`) targets the local Go `stigmer-server` with SQLite, not the production Java service. This gives false confidence -- regressions in the Java service, billing, usage tracking, and multi-tenant features are invisible to CI. The test harness couples to `~/.stigmer/stigmer.db` and requires a manually pre-started server.

### Pain Points

- No integration tests against the production Java service (`stigmer-service`)
- The Java service requires Auth0, OpenFGA, MongoDB, Redis, and Temporal -- no way to run it in a test mode
- Cross-repo dependency (test harness in `stigmer`, service under test in `stigmer-cloud`)
- No documented path for starting the full stack from a test

## Solution

A structured architecture spike that resolved four critical unknowns before committing to a full test harness design:

1. **Can the Java service run without Auth0/OpenFGA?** -- No, not originally. Added `stigmer.security.mode=test` conditional that bypasses the entire auth chain.
2. **How to start the Java service?** -- Fat JAR as a child process, built by Bazel.
3. **Infrastructure startup time?** -- ~8 seconds for MongoDB + Redis + Temporal + Java service.
4. **Can Go call the Java service's gRPC API?** -- Yes, with the test security mode active.

## Implementation Details

### stigmer-cloud: Conditional Auth Bypass (6 files)

Added `@ConditionalOnProperty(name = "stigmer.security.mode", havingValue = "production", matchIfMissing = true)` to production security beans, following the existing `@ConditionalOnProperty` pattern used by `StripeClientProvider`.

- `GrpcSecurityConfigBase` -- skips Auth0 JWT decoder, authentication manager, and gRPC auth interceptor
- `MachineAccountJwtProvider` -- skips Auth0 client credentials flow
- `HttpSecurityConfig` -- skips OAuth2 resource server configuration
- `InProcessMachineAccountTokenInjectorInterceptor` -- changed to `ObjectProvider<MachineAccountJwtProvider>` for graceful degradation when provider is absent (preserves `inProcessChannelAsSystem` bean chain)
- `GrpcRequestContextBuilderInterceptor` -- added `InterceptorContextHolder.hasContext()` early return to prevent identity resolution from overwriting test caller
- `IntegrationTestSecurityConfig` (new) -- activated by `stigmer.security.mode=test`, provides permit-all HTTP security, no-op AuthenticationManager, and gRPC interceptor that injects a synthetic test caller identity

### stigmer: Go Test Harness (7 files)

New `test/integration/` module with Testcontainers-Go for infrastructure and a Java service supervisor.

- `harness/infra.go` -- MongoDB + Redis containers via Testcontainers-Go modules
- `harness/temporal.go` -- Temporal CLI dev server on a free port with health polling
- `harness/service.go` -- Java fat JAR supervisor with env var injection, early exit detection, and log capture
- `harness/harness.go` -- parallel infrastructure startup coordinator
- Three tests proving the pipeline: `infra_test.go`, `service_test.go`, `smoke_test.go`

### Surprises Encountered and Resolved

1. MongoDB `char[]` password binding fails on empty string -- used `SPRING_DATA_MONGODB_URI` override
2. R2/S3 artifact stores unconditionally component-scanned -- included R2 profiles with dummy env vars
3. Stripe `@ConditionalOnProperty` fires on YAML empty default -- provided dummy key
4. Auth0 properties needed for `ProvisionMyAccountHandler` despite auth bypass -- included `auth0` profile with dummy values
5. `GrpcRequestContextBuilderInterceptor` overwrites test caller identity -- added `hasContext()` skip

## Benefits

- **Foundation for all future integration tests** -- the harness is ready for T03 (full harness) and beyond
- **8-second startup** -- fast enough for developer feedback loops and CI
- **Zero production risk** -- auth bypass requires explicit `stigmer.security.mode=test`, defaults to production
- **Cross-repo proven** -- Go harness in stigmer successfully controls Java service from stigmer-cloud
- **Parallel infrastructure** -- MongoDB, Redis, and Temporal start concurrently

## Impact

- **stigmer**: New `test/integration/` module added to `go.work`; three passing integration tests
- **stigmer-cloud**: Auth bypass infrastructure supports any future integration or E2E testing scenario
- **Architecture validation**: The T01 master plan is confirmed viable with the decisions documented in this spike

## Related Work

- T01 Master Plan: `_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/tasks/T01_0_plan.md`
- Research report: `_projects/2026-05/20260508.01.bring-workflows-to-foreground/research.workflow-e2e-testing-strategy/04.report.gpt.md`

---

**Status**: In Progress (spike complete, full harness build next)
**Timeline**: Spike completed in one session (~2 hours)
