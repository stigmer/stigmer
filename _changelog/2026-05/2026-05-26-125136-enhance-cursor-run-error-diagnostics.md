# Enhance Cursor Run Error Diagnostics and MCP Pre-flight Validation

**Date**: May 26, 2026

## Summary

Replaced the opaque "Cursor run failed" error with actionable diagnostic output. Added API key pre-flight validation, MCP server env health checks, and an integration test covering the workflow → Cursor harness failure path. These changes ensure that Cursor SDK failures surface enough context to identify root cause without manual log trawling.

## Problem Statement

The `daily-notification-plan` workflow execution failed with `"Cursor run failed"` — a generic fallback message that provided zero diagnostic context. The Cursor SDK's `run.wait()` returned `{ status: "error", result: undefined }` after ~24 seconds of streaming, giving no indication of whether the failure was due to missing credentials, MCP server crashes, model errors, or platform issues.

### Pain Points

- Error message "Cursor run failed" tells nothing about the cause
- No pre-flight validation catches missing API keys before the SDK call
- MCP servers start without required env vars (declared but unprovisioned secrets) and crash silently during the agent run
- The test suite has no coverage for the workflow → CallAgent → Cursor harness path with incomplete configuration

## Solution

Three targeted improvements to the `ExecuteCursor` activity:

1. **Enhanced error extraction**: When the SDK returns `status: "error"`, probe for `.error`, `.message`, `.reason` fields on the result object. If all are empty, include diagnostic context (model, mode, agentId) in the error message.

2. **API key pre-flight check**: Before `Agent.create()`, validate that `effectiveApiKey` is non-empty and not the placeholder `"proxy-managed"`. Fail fast with a clear message explaining which credential source is misconfigured.

3. **MCP server env health validation**: After MCP resolution (Phase 4), validate that resolved stdio servers don't have empty env vars for keys they declare. Log prominent warnings so the cause is visible in runner stderr before the agent even starts.

## Implementation Details

### Files Modified

| File | Change |
|------|--------|
| `execute-cursor/index.ts` | Enhanced error case (line ~595), added API key check (line ~264), added Phase 4c MCP validation |
| `execute-cursor/mcp-resolver.ts` | Added `validateMcpServerEnv()` export function |
| `workflow_cursor_harness_env_test.go` | New integration test for Cursor harness failure mode |

### Error Enhancement (index.ts)

```typescript
case "error": {
  const resultAny = result as unknown as Record<string, unknown>;
  const sdkError = result.result ?? resultAny.error ?? resultAny.message ?? resultAny.reason;
  status.error = sdkError
    ? String(sdkError)
    : `Cursor run failed (no detail from SDK). Model=${validatedModel}, mode=${agentMode}, agentId=${resolution.agentId}`;
}
```

### API Key Pre-flight (index.ts)

Throws immediately with credential source diagnosis if the key is empty, preventing a cryptic SDK failure seconds later.

### MCP Validation (mcp-resolver.ts)

`validateMcpServerEnv()` iterates resolved servers, checks for empty env var values in stdio-type servers, and returns actionable warnings that the executor logs before agent.send().

## Benefits

- **Actionable errors**: "Cursor run failed" now includes model, mode, and agentId at minimum; better errors include the specific credential or MCP issue
- **Fast failure**: Missing API keys fail in milliseconds with a clear message instead of 20+ seconds of streaming followed by an opaque error
- **Visible MCP issues**: Warnings about empty env vars appear in runner stderr BEFORE the agent starts, making it trivial to identify secret provisioning gaps
- **Test coverage**: New integration test catches regressions in the CallAgent → Cursor harness failure path

## Impact

- **Runner**: Three enhancements in the Cursor executor (error quality, pre-flight, MCP validation)
- **Integration tests**: One new test covering a previously untested scenario
- **Users**: Workflow failures in the Cursor harness now produce errors that point to the fix

## Related Work

- RCA plan: `_projects/2026-05/20260525.01.v3-streaming-migration/` (deferred investigation)
- Structured output fix: `2026-05-26-121306-fix-structured-output-extraction-pipeline-v3.md`
- Env forwarding test: `test/integration/workflow_agent_call_env_forwarding_test.go`

---

**Status**: Production Ready
**Timeline**: Single session
