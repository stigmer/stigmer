# Wire JUnit 5 Tests into Bazel for stigmer-cloud

**Date**: March 19, 2026

## Summary

Enabled JUnit 5 test execution within the Bazel build system for the stigmer-cloud backend. The repo had ~70 existing test files that were never wired into Bazel due to a JUnit 5 compatibility gap. Using `contrib_rules_jvm`, 5 reconciliation unit tests now run as part of `bazelw test //backend/...`, eliminating the `ERROR: No test targets were found` message during `make check`.

## Problem Statement

Running `make check` in stigmer-cloud produced the error:

```
ERROR: No test targets were found, yet testing was requested
no test targets found — skipping
```

### Pain Points

- The Makefile's `test-backend` target runs `./bazelw test //backend/...` which found zero test targets
- ~70 JUnit 5 test files existed but none were registered as Bazel test targets
- The BUILD.bazel had a comment citing JUnit 5 / Bazel incompatibility (bazelbuild/bazel#6681)
- The Makefile gracefully handled exit code 4, but CI gave confusing output suggesting something was wrong

## Solution

Used `contrib_rules_jvm` (v0.32.0 from Bazel Central Registry) which provides the `java_junit5_test` macro — a drop-in replacement for `java_test` that supports JUnit 5. Wired up 5 pure value-object unit tests that have no Spring context or infrastructure dependencies.

## Implementation Details

Three files changed in stigmer-cloud:

**`MODULE.bazel`**:
- Added `bazel_dep(name = "contrib_rules_jvm", version = "0.32.0")`
- Added `junit-platform-launcher:1.11.4` and `junit-platform-reporting:1.11.4` to Maven artifacts (required at runtime by the JUnit 5 runner)

**`backend/services/stigmer-service/BUILD.bazel`**:
- Replaced the "tests can't run" comment with a `JUNIT5_DEPS` list and 5 `java_junit5_test` targets
- Each test target specifies `test_class` with the fully-qualified class name (required by the runner)
- Tests wired: `ReconciliationErrorTest`, `ResourceChangeTest`, `DesiredStateTest`, `ReconciliationResultTest`, `ReconciliationPlanTest`

Key learnings during implementation:
- `java_junit5_test` requires `junit-jupiter-engine`, `junit-platform-launcher`, and `junit-platform-reporting` as explicit deps
- The `test_class` attribute must be the fully-qualified Java class name; without it the runner looks for a class matching the Bazel target name

## Benefits

- `make check` no longer shows the confusing "No test targets found" error
- 5 tests (with dozens of assertions) now run in Bazel CI in ~2 seconds
- The JUnit 5 + Bazel plumbing is in place — wiring additional tests is just adding more `java_junit5_test` targets
- `JUNIT5_DEPS` list is reusable for all future test targets

## Impact

- **Build system**: `./bazelw test //backend/...` now finds and executes 5 test targets
- **CI**: `make check` completes cleanly without the exit-code-4 workaround being triggered
- **Developer experience**: Clear path to wiring up the remaining ~65 test files incrementally

## Related Work

- Follows up on commit `36041a0f fix(repo): tolerate missing test targets in make check` which added the exit-code-4 handling as a stopgap

---

**Status**: ✅ Production Ready
**Timeline**: Single session
