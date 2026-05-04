# Dual-Header Proxy Access Control (T06)

**Date**: May 4, 2026

## Summary

Added `X-Stigmer-Mcp-Server-Id` header support to both LLM and Cursor proxy controllers, enabling FGA-based authorization for MCP server-scoped proxy calls alongside existing execution-scoped calls. This security hardening prepares for T07 (runner sends the header during MCP connect classifier LLM calls) while preserving deployment safety via soft enforcement.

## Problem Statement

The proxy layer authorized requests using a single scope header (`X-Stigmer-Execution-Id`), which maps to a running agent execution. However, MCP server connect workflows make LLM calls for tool classification where no agent execution exists yet. These calls had no FGA scope — they relied on soft enforcement (warn and allow) to pass through.

### Pain Points

- MCP connect classifier LLM calls had no FGA authorization scope
- Authorization logic was duplicated between `LlmProxyController` and `CursorProxyController`
- The `require-execution-id` config property was semantically too narrow for a dual-header world
- No observability for which proxy requests were MCP-server-scoped vs execution-scoped

## Solution

Introduced a dual-header authorization model: proxy requests can be scoped by execution ID (metered, billed) or MCP server ID (authorized, not metered), or both. Centralized the authorization logic in `ProxyAuthorizationService.authorizeProxyScopes()` to eliminate controller duplication.

## Implementation Details

**New `ProxyScopeResult` record** — encapsulates scope state with `executionId`, `mcpServerId`, and `metered` flag. Includes a static `UNSCOPED` sentinel for the soft-enforcement fallback path.

**`ProxyAuthorizationService` additions**:
- `authorizeMcpServerAccess()` — FGA `can_connect` on `mcp_server`, same 5-minute caching
- `authorizeProxyScopes()` — shared dual-header logic returning `ProxyScopeResult`. Validates each present header against FGA, determines metering eligibility, and handles soft/hard enforcement for the no-scope case

**Controller refactoring** — both `LlmProxyController` and `CursorProxyController` replaced their private `authorizeExecution()` methods with a single `authorizeProxyScopes()` call. Metering decisions now use `scope.metered()` instead of null-checking execution IDs.

**Config rename** — `stigmer.proxy.require-execution-id` → `stigmer.proxy.require-scope-header` (env: `STIGMER_PROXY_REQUIRE_SCOPE_HEADER`). Semantics broadened to mean "require at least one scope header (execution or MCP server)". Default remains `false`.

**Deployment ordering** — soft enforcement is preserved in T06. Hard enforcement will be flipped to `true` after T07 deploys (T07 makes the runner send `X-Stigmer-Mcp-Server-Id` for connect classifier calls).

## Benefits

- **Security**: MCP server proxy calls now have a defined FGA authorization path (`can_connect` on `mcp_server`)
- **DRY**: Authorization logic consolidated in one place instead of duplicated across two controllers
- **Observability**: MCP-server-scoped calls are logged at INFO level for visibility
- **Deployment safety**: No breaking changes — soft enforcement preserved, no caller sends the new header yet
- **Incremental hardening**: Clear path to hard enforcement after T07

## Impact

- **Proxy controllers**: Authorization and metering flow refactored (no behavioral change for existing callers)
- **Config**: Environment variable renamed from `STIGMER_PROXY_REQUIRE_EXECUTION_ID` to `STIGMER_PROXY_REQUIRE_SCOPE_HEADER` — operators should update deployment configs if they set the old name
- **No runner changes**: T07 will add client-side header support

## Files Changed

| File | Change |
|------|--------|
| `ProxyScopeResult.java` | New — scope result record |
| `ProxyAuthorizationService.java` | Added 3 methods (+77 lines) |
| `LlmProxyController.java` | Refactored auth + metering |
| `CursorProxyController.java` | Refactored auth + metering |
| `application.yaml` | Config property rename |
| `BUILD.bazel` | New test target |
| `ProxyScopeAuthorizationTest.java` | New — 15 unit tests |

## Related Work

- **T01–T05**: Proxy-side billing metering pipeline (this sub-project)
- **T07** (next): Pass `mcp_server_id` through classify workflow
- **Parent**: `20260503.03.stripe-billing-integration`

---

**Status**: Production Ready
**Timeline**: 1 session
