# Task T03: Backend — Harden Execution Refresh + Vendor Gate + Error UX

**Created**: 2026-04-13 11:03
**Status**: NOT STARTED
**Repo**: stigmer-cloud
**Estimated scope**: ~4-6 files
**Depends on**: T01 (proto stubs)

## Objective

Three focused backend hardening fixes: make execution-path token refresh a hard failure (GAP 4), enforce vendor approval status at the backend (GAP 8), and wrap Temporal errors in user-friendly messages (GAP 9).

## Context

### GAP 4: Execution Path Soft-Fails OAuth Refresh
`CreateExecutionContextStep.injectMcpOAuthFromManagedEnvironment` catches refresh exceptions with `warn` log only. If token refresh fails during agent execution, the agent proceeds with a bad token, gets 401 from MCP server, and fails with a confusing runtime error.

### GAP 8: Vendor Approval Gating Is UI-Only
`McpServerInitiateOAuthConnectHandler.ExecuteInitiate` does not check `VendorApprovalStatus`. A direct API caller can initiate OAuth even when status is PENDING.

### GAP 9: Connect Failure Error UX Is Cryptic
The connect handler exposes raw Temporal `WorkflowException` metadata (workflowId, closeEventType, retryState) to the user.

## Deliverables

### 1. Harden Execution-Path Refresh (GAP 4)

In `CreateExecutionContextStep.injectMcpOAuthFromManagedEnvironment`:

**Current behavior:**
```java
try {
    refreshService.refreshIfExpired(mcpServer, identityAccountId, org);
} catch (Exception e) {
    log.warn("OAuth token refresh failed for server={}: {}", mcpServerId, e.getMessage());
    // continues execution with potentially expired token
}
```

**Target behavior:**
```java
try {
    refreshService.refreshIfExpired(mcpServer, identityAccountId, org);
} catch (McpOAuthException e) {
    throw new StatusRuntimeException(Status.FAILED_PRECONDITION
        .withDescription("OAuth token for MCP server '%s' has expired and could not be refreshed. "
            + "Please re-authenticate from the MCP server Connect page. Details: %s"
            .formatted(mcpServerName, e.getMessage())));
}
```

### 2. Vendor Approval Enforcement (GAP 8)

In `McpServerInitiateOAuthConnectHandler.ExecuteInitiate`, after resolving the OAuthApp in the vendor OAuth path, add:

```java
VendorApprovalStatus approvalStatus = oauthApp.getSpec().getVendorApprovalStatus();
if (approvalStatus == VendorApprovalStatus.VENDOR_APPROVAL_STATUS_PENDING
        || approvalStatus == VendorApprovalStatus.VENDOR_APPROVAL_STATUS_REJECTED) {
    return RequestPipelineStepResultV2.failure(getName(),
            Status.FAILED_PRECONDITION,
            "OAuth sign-in is unavailable: the platform's OAuth app is %s by the vendor. "
                + "Use 'Bring your own app' or enter a token manually."
                .formatted(approvalStatus == VENDOR_APPROVAL_STATUS_PENDING ? "pending approval" : "rejected"));
}
```

### 3. User-Friendly Connect Errors (GAP 9)

In `McpServerConnectHandler.ExecuteConnectWorkflow`, wrap the Temporal workflow exception:

**Current behavior:** Raw `WorkflowException` message surfaces as-is to the gRPC response.

**Target behavior:** Catch `WorkflowException`, extract the root cause, and return a clean message:
```java
} catch (WorkflowException e) {
    String cause = extractRootCause(e);
    return RequestPipelineStepResultV2.failure(getName(),
            Status.INTERNAL,
            "Connection to MCP server '%s' failed: %s. "
                + "Check that the server is reachable and your credentials are valid."
                .formatted(mcpServerName, cause));
}
```

The `extractRootCause` helper traverses the exception chain to find the first `ApplicationFailure` message (the actual error from the Python agent-runner), stripping Temporal metadata.

## Files to Create/Modify

| File | Action | What |
|------|--------|------|
| `CreateExecutionContextStep.java` | Modify | Hard-fail on refresh exception |
| `McpServerInitiateOAuthConnectHandler.java` | Modify | Add vendor approval check |
| `McpServerConnectHandler.java` | Modify | Wrap Temporal errors |

## Acceptance Criteria

- [ ] Execution fails cleanly with `FAILED_PRECONDITION` when OAuth token refresh fails (not warn-only)
- [ ] `initiateOAuthConnect` returns `FAILED_PRECONDITION` when vendor approval is PENDING or REJECTED
- [ ] Connect failures show human-readable error messages (no raw Temporal metadata)
- [ ] Error messages include remediation hints ("re-authenticate", "check credentials")
- [ ] Existing happy paths unchanged

## Predecessor Tasks

T01 (proto + stubs)

## Successor Tasks

T06 (frontend error display improvements)
