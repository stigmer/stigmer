# T07: Pass mcp_server_id Through Classify Workflow + Short-Circuit

**Date**: May 4, 2026

## Summary

Threaded `X-Stigmer-Mcp-Server-Id` through the MCP tool approval classify workflow's LLM proxy calls, added a deterministic short-circuit to skip reclassification when tools haven't changed (stability guarantee against LLM non-determinism), and fixed a scope header gap in sub-agent title generation. All changes in the agent-runner (stigmer OSS), no stigmer-cloud changes needed.

## Problem Statement

The proxy (T06) already accepts `X-Stigmer-Mcp-Server-Id` and performs FGA `can_connect` authorization, but no runner code sends it yet. When `require-scope-header` is flipped to `true`, two LLM call sites would be 403'd:

### Pain Points

- **Classify tool approvals**: The `ClassifyToolApprovals` Temporal activity calls the LLM proxy without any scope header (no `execution_id`, no `mcp_server_id`). Once hard enforcement is enabled, classify breaks.
- **Sub-agent title generation**: `_generate_sub_agent_subject()` calls the LLM proxy without `execution_id` even though it runs inside an agent execution. Same 403 risk.
- **Approval instability on reconnect**: When a user reconnects an MCP server whose tools haven't changed, LLM non-determinism could flip approval policies (safe → requires-approval or vice versa), surprising users.

## Solution

Three-part change:

1. **Header plumbing**: Add `mcp_server_id` parameter to `LLMConfig.build_llm_kwargs()`, wire through `classify_tools()` and `ClassifyToolApprovalsInput`, pass from `ConnectMcpServerWorkflow`.
2. **Short-circuit**: Add `tools_fingerprint()` (deterministic SHA-256 of tool name + description + schema, sorted by name). The discover activity returns the previous fingerprint and approvals from McpServer status. The workflow compares fingerprints — if identical and previous approvals exist, skips the classify activity entirely.
3. **Sub-agent fix**: Pass `execution_id` through `_generate_sub_agent_subject()` to `build_llm_kwargs()`.

## Implementation Details

### Header plumbing (`config.py`, `classify_tool_approvals.py`, `discover_mcp_server.py`)

`build_llm_kwargs()` now accepts both `execution_id` and `mcp_server_id` as independent optional parameters. Both can be set simultaneously (the proxy handles the "both present" case from T06). Each produces its respective `X-Stigmer-*` header in the `default_headers` dict.

The classify activity passes `mcp_server_id=input.mcp_server_id` down to `classify_tools()` → `build_llm_kwargs()`. The workflow passes `input.mcp_server_id` into `ClassifyToolApprovalsInput`.

### Short-circuit (`discover_mcp_server.py`)

`tools_fingerprint()` is a pure function that computes a deterministic SHA-256 hex digest over the canonical JSON of `(name, description, input_schema)` sorted by tool name. Safe in Temporal workflow context (no I/O, fully deterministic).

The discover activity already fetches the full `McpServer` via gRPC. It now also extracts `status.discovered_capabilities.tools` and `status.tool_approvals` from the response, computes the previous fingerprint, and returns both in `DiscoverMcpServerOutput`.

The workflow computes the new fingerprint and compares:
- Match + previous approvals exist → skip classify, reuse previous approvals, log decision
- Mismatch or first connect → call classify as before

### Sub-agent fix (`sub_agent.py`)

Added `execution_id: str | None = None` parameter to `_generate_sub_agent_subject()`. Call site passes `sb.execution_id`. Backward-compatible (default `None`).

## Files Changed

| File | Change |
|------|--------|
| `worker/config.py` | `mcp_server_id` param + dual header dict |
| `activities/classify_tool_approvals.py` | Accept + forward `mcp_server_id` |
| `activities/discover_mcp_server.py` | `tools_fingerprint()`, `_extract_previous_state()`, expanded output, workflow short-circuit |
| `activities/graphton/handlers/sub_agent.py` | `execution_id` param + call site |
| `tests/test_proxy_scope_headers.py` | 9 tests: header + classify forwarding |
| `tests/test_connect_workflow_short_circuit.py` | 9 tests: fingerprint determinism |
| `tests/test_sub_agent_scope_header.py` | 2 tests: execution_id forwarding |
| `client-apps/cli/embedded/agentrunner/source/` | Sync (4 files) |

## Benefits

- **Unblocks hard enforcement**: When `require-scope-header` is flipped to `true`, classify and sub-agent title generation will not be 403'd.
- **Approval stability**: Users who reconnect an MCP server with unchanged tools will not see their approval policies change due to LLM non-determinism.
- **Observability**: The proxy can now attribute classify LLM calls to specific MCP servers via the scope header + FGA authorization cache.
- **Zero runner-execution-path changes**: This is an infrastructure/connect-flow change. The main agent execution path is untouched.

## Impact

- **Agent runner** (Python): 4 source files changed, 3 test files added
- **Embedded runner** (CLI): Synced copy updated
- **Proxy** (Java): No changes needed — T06 already supports `X-Stigmer-Mcp-Server-Id`
- **Deployment**: Safe to deploy independently. The proxy already accepts the new header. The short-circuit is purely additive (degrades gracefully to existing behavior if no previous state exists).

## Related Work

- **T06**: [Dual-header proxy access control](2026-05-04-190536-dual-header-proxy-access-control-t06.md) — server-side support for `X-Stigmer-Mcp-Server-Id`
- **T03**: [Proxy controller usage wiring](2026-05-04-165632-proxy-controller-usage-wiring-t03.md) — established `ProxyUsageReporter` + `ProxyCallSequencer`
- **Next**: T08 (deprecate runner-side billing calls), then flip `require-scope-header` to `true`

---

**Status**: Production Ready
**Commit**: `02c272fc6` on `feat/react-sdk-streaming-ux`
