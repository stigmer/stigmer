# Unit Tests for ValidateGrantableRole Pipeline Step

**Date**: April 5, 2026

## Summary

Added 7 unit tests for the `ValidateGrantableRole` pipeline step in `IamPolicyCreateHandler`, completing the test coverage for the grantable role validation guardrail introduced in Session 4. Tests use pure JUnit 5 with real protobuf objects — no Mockito needed — and double as contract tests for the authorization model.

## Problem Statement

The `ValidateGrantableRole` step was shipped in Session 4 without test coverage. This step is a critical guardrail preventing invalid FGA tuples from being created through the user-facing IAM policy create path. Without tests, regressions could silently allow invalid role grants.

### Pain Points

- No automated verification that the three error branches (unknown kind, no grantable roles, non-grantable role) produce correct error responses
- No contract test ensuring the proto-defined authorization model (grantable roles per resource kind) matches expectations
- Pre-existing `FormatString` bug in `ValidateSsoFields.java` blocked the build, preventing test execution

## Solution

Wrote focused unit tests that exercise the step's pure validation logic against real proto metadata. Avoided introducing Mockito as a new Bazel dependency by leveraging the step's zero-dependency design — it only reads from the request context and a static utility.

## Implementation Details

- **Test file**: `IamPolicyCreateHandlerTest.java` in the same package as the handler (package-private inner class access)
- **7 test cases**:
  - 4 happy paths: owner/viewer on agent, admin/member on organization
  - 3 error paths: unknown resource kind, system-managed resource (iam_policy), non-grantable role (admin on agent)
- **Test approach**: Build `CustomOperationContextV2` with Lombok `@Builder`, set a real `IamPolicySpec` request, call `step.execute(context)`, assert on `RequestPipelineStepResultV2`
- **Bazel wiring**: Added `iam_policy_create_handler_test` target with strict deps (`grpc-request`, `grpc_api`)
- **Bug fix**: Fixed Java operator precedence bug in `ValidateSsoFields.java` where `.formatted(org)` was applied to the wrong string

## Benefits

- Regression safety for the grantable role validation guardrail
- Contract tests that break if the proto-defined authorization model changes unexpectedly
- Zero new build dependencies (pure JUnit 5)
- Serves as a template for testing other pipeline steps without Mockito

## Impact

- **Backend test suite**: Grows from 7 to 8 Bazel test targets
- **IAM domain**: First dedicated test coverage for IAM policy handler logic
- **Build infra discovery**: Surfaced that Mockito is not wired into Bazel and several existing test files are dead code

## Related Work

- Session 4: `ValidateGrantableRole` step implementation
- Session 1-3: IamRole/IamPermission enum separation and grantable_roles metadata

---

**Status**: Production Ready
**Timeline**: 1 session
