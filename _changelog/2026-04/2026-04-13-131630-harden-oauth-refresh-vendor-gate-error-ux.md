# Harden OAuth Refresh, Vendor Approval Gate, and Connect Error UX

**Date**: April 13, 2026

## Summary

Three surgical backend hardening fixes for MCP server OAuth in stigmer-cloud: execution-path token refresh now fails immediately instead of letting agents run with expired tokens, vendor approval status is enforced at the API level (not just the UI), and MCP connect workflow errors are layered with human-readable messages instead of raw Temporal metadata.

## Problem Statement

The MCP server OAuth integration had three gaps that produced confusing user experiences and left security/correctness holes:

### Pain Points

- **Silent expired token injection**: When `refreshIfExpired` failed during agent execution, the exception was swallowed and the expired token (still physically stored in the managed environment) was injected. The downstream validator only checks key presence, so validation passed and the agent ran with a bad token, getting a 401 from the MCP server with no useful context.
- **UI-only vendor approval gating**: The frontend disabled the sign-in button when `VendorApprovalStatus` was PENDING or REJECTED, but the backend `initiateOAuthConnect` RPC had no check. Direct API callers could bypass the gate entirely.
- **Cryptic connect errors**: All connect workflow exceptions mapped to `DEADLINE_EXCEEDED` with raw Temporal exception messages containing workflow IDs, close event types, and retry state metadata that were meaningless to users.

## Solution

Three focused edits to three existing handler/step files, following established codebase patterns.

## Implementation Details

### GAP 4: Execution-Path OAuth Refresh Hard Failure

**File**: `CreateExecutionContextStep.java`

Removed the try/catch around `oauthTokenRefreshService.refreshIfExpired()` inside `injectMcpOAuthFromManagedEnvironment`. `McpOAuthException` now propagates naturally to the outer `execute` method, which catches it specifically (before the generic `Exception` catch) and maps to `FAILED_PRECONDITION`. The exception messages from `OAuthTokenRefreshService` are already user-friendly with server name and remediation hints — no double-wrapping needed.

The second try/catch (managed env read) remains non-fatal: transient read failures leave the key absent, and the `McpEnvironmentValidator` catches those via missing-key detection.

### GAP 8: Vendor Approval Backend Enforcement

**File**: `McpServerInitiateOAuthConnectHandler.java`

Added a `VendorApprovalStatus` check in the vendor OAuth path of `ExecuteInitiate`, after the `OAuthApp` is resolved and before credentials are read. Returns `FAILED_PRECONDITION` with a message naming the provider and suggesting manual token entry. Defense in depth: the enricher gates the UI button, the handler gates the API.

### GAP 9: Layered Connect Error Handling

**File**: `McpServerConnectHandler.java`

Replaced the single `catch (Exception e) → DEADLINE_EXCEEDED` with three catches following the established pattern from `AgentExecutionResumeHandler`, `AgentExecutionPauseHandler`, and `WorkflowExecutionTerminateHandler`:

- `WorkflowFailedException` → `INTERNAL` with root cause extracted via `extractWorkflowFailureCause` (traverses Temporal exception chain to find the deepest meaningful message)
- `WorkflowServiceException` → `UNAVAILABLE` with "Connection service temporarily unavailable"
- `Exception` → `INTERNAL` with server name and original message

## Benefits

- Agents no longer silently proceed with expired OAuth tokens — users get an immediate, actionable error message telling them to re-authenticate
- Vendor approval is enforced at the API level, closing a security gap for direct API callers
- Connect failures show human-readable messages with remediation hints instead of raw Temporal internals

## Impact

- **Backend (stigmer-cloud)**: 3 files changed, 68 insertions, 11 deletions
- **Users**: Clearer error messages when OAuth tokens expire, vendor approval is blocked, or MCP connections fail
- **Security**: Vendor approval gate can no longer be bypassed via direct API calls
- **Project**: Closes GAPs 4, 8, 9 from the 10-gap analysis; completes T03 of the OAuth BYOA integration project

## Related Work

- Part of project `20260413.01.oauth-byoa-integration` (T03 of 7 tasks)
- Depends on T01 proto layer (`32c8b932f` in stigmer, `a7fa27fc` in stigmer-cloud)
- Unblocks T06 (frontend disconnect + health + error UX)

---

**Status**: Production Ready
**Commit**: stigmer-cloud `22cc3ca5`
