# Integration Test Unification

**Date**: May 22, 2026

## Summary

Unified the four independent Go integration test suites under a single `make test-integration-all` meta-target, added CI coverage for the three previously uncovered suites, and extracted duplicated boilerplate into the shared harness package. Developers can now run all integration tests with one command and trust that CI validates all suites on every PR.

## Problem Statement

The integration test landscape was fragmented across four separate Go modules (`integration`, `integration-security`, `integration-session-routing`, `integration-wfexec-routing`), each with its own `TestMain`, `Makefile`, and infrastructure lifecycle. While separate modules are architecturally correct (each configures the Java service differently), the lack of unification created operational gaps.

### Pain Points

- No unified trigger — running all suites locally required knowing about 4+ separate `make` targets
- Two suites (`session-routing`, `wfexec-routing`) were invisible from the root Makefile
- Only 1 of 4 suites had CI coverage — the other three ran only when a developer remembered
- `findServiceJar()`, `provisionTestBillingAccount()`, and `seedDefaultAgent()` were copy-pasted across suites
- No consistent way to say "run everything, including provider-backed tests"

## Solution

Applied a six-part unification without disturbing the module boundaries or `TestMain` patterns:

1. **Root Makefile targets** for session-routing and wfexec-routing
2. **`test-integration-all` meta-target** with `PROVIDERS=true` flag
3. **Shared harness functions** replacing duplicated boilerplate
4. **CI offline workflow expansion** to run all 4 suites
5. **CI providers workflow expansion** to include session-routing Tier 3
6. **Test taxonomy documentation** in `test/README.md`

## Implementation Details

### Files Modified

| Area | Files | Change |
|------|-------|--------|
| Root Makefile | `Makefile` | Added 4 new targets (`test-integration-session-routing`, `-providers`, `test-integration-wfexec-routing`, `test-integration-all`) |
| Harness | `harness/service.go` | Added `FindServiceJar()` exported function |
| Harness | `harness/fixture.go` | Added `SeedDefaultAgent()`, `ProvisionTestBillingAccount()`, exported `TestOrg`/`TestAPIVersion` constants |
| Harness | 8 harness files | Updated internal references from `testOrg`/`testAPIVersion` to exported `TestOrg`/`TestAPIVersion` |
| Suite files | 4 `suite_test.go` | Replaced local boilerplate with harness function calls, removed ~180 lines of duplication |
| Routing tests | 2 `routing_offline_test.go` | Updated constant references to `harness.TestOrg`/`harness.TestAPIVersion` |
| CI | `ci.integration-offline.yaml` | Added path triggers, Node.js setup, steps for security/session-routing/wfexec-routing, per-suite artifact uploads and JUnit reports |
| CI | `ci.integration-providers.yaml` | Added session-routing Tier 3 step with `CURSOR_API_KEY`, Node.js setup, artifact upload |
| Docs | `test/README.md` | New file documenting test taxonomy, usage, prerequisites |

### Design Decisions

- **Sequential execution** in `test-integration-all` — parallel would risk resource contention with multiple JVMs and Docker container sets on a developer machine.
- **Single CI workflow** for all offline suites rather than 4 separate workflows — avoids rebuilding the same JAR 4 times, each step uses `if: always()` so one suite failure doesn't block others.
- **Exported constants** (`TestOrg`, `TestAPIVersion`) — the constants were already duplicated across suites; exporting from the canonical harness location enables DRY usage everywhere.

## Benefits

- **One command to rule them all**: `make test-integration-all` runs all offline suites; `PROVIDERS=true` adds provider-backed tests
- **CI coverage for all suites**: Security, session-routing, and wfexec-routing tests now run on every PR touching backend/test code
- **~180 lines of duplication removed**: `findServiceJar()`, `provisionTestBillingAccount()`, and `seedDefaultAgent()` consolidated into the harness
- **Discoverable**: `test/README.md` documents the full test taxonomy, prerequisites, and usage

## Impact

- **Developers**: Can validate all integration suites with a single command before pushing
- **CI**: Three previously uncovered test suites now have automated regression protection
- **Maintainability**: New test suites follow the established pattern — add a Makefile, delegate from root, add a step in the CI workflow

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
