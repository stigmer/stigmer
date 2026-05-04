# Task Plan: Proxy-Side Billing Metering

**Created**: 2026-05-04 13:29
**Status**: PENDING REVIEW (T01 SSE parser completed)
**Type**: Sub-Project of 20260503.03.stripe-billing-integration
**Architecture Plan**: `_cursor/plans/secure_billing_metering_344ab189.plan.md`

## Problem

The agent runner is open source. A user who forks it can modify `UsageTracker` to report zero tokens via `updateStatus` or `ReportLlmCallUsage`, getting free LLM usage on Stigmer's API keys. Both billing surfaces are runner-attested with no server-side verification.

## Solution

The LLM and Cursor proxy controllers already route all cloud-mode LLM calls. They currently act as transparent pass-throughs. We add SSE stream parsing to extract provider-reported token usage, write it via a new operator-only `updateResourceUsage` RPC (which also debits billing), and strip the untrusted runner-reported `llm_metrics`. The `updateStatus` response then checks billing state and returns STOP/WARNING signals.

## Complete Task Breakdown

Eight tasks covering the full solution end-to-end.

---

### T01: SSE Usage Parser (Java utility) — COMPLETED

**Scope**: Reusable `SseUsageParser` utility class that extracts token usage from SSE byte streams for Anthropic and OpenAI response formats.

**Status**: Done. `OpenAiUsageExtractor` exists at `ai.stigmer.proxy.usage`.

---

### T02: `updateResourceUsage` RPC (proto + Java handler)

**Scope**: New operator-only RPC that is the single entry point for writing trusted usage to an execution and triggering billing debits. Called by the proxy in-process after parsing SSE usage.

**Deliverables**:
- Proto definition: `updateResourceUsage` RPC on `AgentExecutionCommandController` (or a new billing-internal controller)
- Input message: `execution_id`, `sequence` (1-based LLM call number), `model`, `provider`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`
- FGA permission: **`can_operate`** — granted only to the stigmer-service operator identity, NOT to regular users. In OSS (no FGA), call succeeds.
- Handler logic:
  1. Compute `providerCostMicros` server-side using the trusted model registry (ModelPricingService or equivalent) — never accept cost from the caller
  2. Resolve `harness` and `costTier` from model registry metadata
  3. Call `ExecutionBillingService.reportLlmCallUsage()` — debits credits, updates reservation, returns billing signal
  4. Write proxy-observed usage metrics to a billing-authoritative field on `AgentExecution` (e.g., `status.billed_usage` or a new `ProxyUsageMetrics` repeated field) so the UI/CLI can display usage from a trusted source
- Return: billing signal (CONTINUE/WARNING/STOP) so the proxy can log it
- Idempotency: `(execution_id, sequence)` — same key as existing `ReportLlmCallUsage`
- Unit tests

**Why this is needed**:
- Clean API boundary for proxy → billing flow
- Server-side cost computation (don't trust caller for cost)
- Writes display-ready usage to execution (since we strip runner's `llm_metrics`)
- FGA-gated so a tampered runner cannot call it in cloud mode

**Estimated size**: Medium

---

### T03: Wire SSE parser into LlmProxyController + call `updateResourceUsage`

**Scope**: Replace `inputStream.transferTo(outputStream)` in `LlmProxyController` with a tee. After stream completes, call the new RPC (in-process).

**Deliverables**:
- `TeeInputStream` or `StreamTee` utility that writes to `OutputStream` (runner) while feeding the SSE parser
- `LlmProxyController.proxy()` updated to use the tee
- After stream completes: if `X-Stigmer-Execution-Id` present → call `updateResourceUsage` handler/service in-process with parsed usage
- Inject `stream_options: {include_usage: true}` into OpenAI request body
- Error handling: if parsing or billing fails, log and continue (don't break the LLM response to the runner)
- Maintain a per-execution sequence counter (atomic int keyed by execution_id, or derive from proxy call order)
- Integration test

**Depends on**: T01, T02

**Estimated size**: Medium-Large

---

### T04: Wire SSE parser into CursorProxyController

**Scope**: Same as T03 but for the Cursor proxy. Research Cursor's response format.

**Deliverables**:
- Research: capture Cursor API responses to identify where usage metadata appears in the gRPC-Connect/SSE stream
- If Cursor uses OpenAI-compatible format, reuse existing parser. If different, extend or create `CursorUsageParser`
- `CursorProxyController.proxy()` updated with tee + call `updateResourceUsage`
- Error handling: same as T03

**Depends on**: T01, T02, T03 (reuse tee pattern)

**Estimated size**: Medium (smaller if Cursor uses OpenAI-compatible format)

---

### T05: Strip `llm_metrics` + wire billing signal in `updateStatus`

**Scope**: Two changes in `AgentExecutionUpdateStatusHandler`:
1. Strip untrusted `llm_metrics` from runner messages (cloud mode)
2. Wire the billing signal in `BuildUpdateStatusResponseStep` (the existing TODO)

**Deliverables**:
- Add config flag `stigmer.proxy.enabled` (or derive from proxy config presence)
- In `BuildNewStateWithStatusStep`: when proxy enabled, iterate messages and clear `llm_metrics` on each `AgentMessage` before writing to DB. Same for `sub_agent_executions[].messages[]`
- In `BuildUpdateStatusResponseStep` (the TODO at line 349):
  - Read the execution's billing state (from reservation or billing service query)
  - If credits exhausted → `EXECUTION_CONTROL_SIGNAL_STOP`
  - If credits low → `EXECUTION_CONTROL_SIGNAL_WARNING`
  - Otherwise → `EXECUTION_CONTROL_SIGNAL_UNSPECIFIED`
- In OSS mode (proxy not enabled): `llm_metrics` preserved, billing signal stays UNSPECIFIED (no billing in OSS)
- Unit tests for both: stripping logic + signal logic

**Depends on**: T02 (billing data must be written by proxy before this step checks it)

**Estimated size**: Medium

---

### T06: Dual-header proxy access control (execution_id + mcp_server_id)

**Scope**: Add `X-Stigmer-Mcp-Server-Id` header support to both proxies. Require at least one scope header. Remove soft enforcement.

**Deliverables**:
- Both `LlmProxyController` and `CursorProxyController`: recognize `X-Stigmer-Mcp-Server-Id`
- Authorization logic: `X-Stigmer-Execution-Id` → FGA `can_edit` on `agent_execution` (existing). `X-Stigmer-Mcp-Server-Id` → FGA `can_connect` on `mcp_server`. Neither → 403
- Only `X-Stigmer-Execution-Id` triggers billing (T03/T04). `X-Stigmer-Mcp-Server-Id` authorizes but does not meter
- Cursor metadata paths (`/v1/models`, `/v1/me`) continue to bypass (existing allowlist)
- Remove `require-execution-id` config flag — hard enforcement is the default
- Unit tests for all authorization paths

**Depends on**: None (can be done in parallel with T02-T05)

**Estimated size**: Small-Medium

---

### T07: Pass `mcp_server_id` through classify workflow + caching guardrail

**Scope**: Small runner change — pass `mcp_server_id` to `classify_tool_approvals` so it sets `X-Stigmer-Mcp-Server-Id`. Add caching to skip redundant calls.

**Deliverables**:
- `discover_mcp_server.py` (`ConnectMcpServerWorkflow`): pass `mcp_server_id` into `ClassifyToolApprovalsInput`
- `classify_tool_approvals.py`: accept `mcp_server_id`, pass to `build_llm_kwargs(mcp_server_id=mcp_server_id)`
- `config.py` `build_llm_kwargs()`: add `mcp_server_id` parameter → sets `X-Stigmer-Mcp-Server-Id` header
- Caching: in `ConnectMcpServerWorkflow`, compare `hash(tool_names + tool_schemas)` with previous stored on McpServer status. If unchanged, skip LLM call
- Unit tests

**Depends on**: T06 (proxy must accept the new header)

**Estimated size**: Small-Medium

---

### T08: Deprecate runner-side billing calls

**Scope**: Remove or disable the runner's direct calls to `ReportLlmCallUsage` gRPC, since the proxy now handles billing.

**Deliverables**:
- Python agent-runner: Remove or disable `BillingReporter` integration in `StatusBuilder.process_event()` (the `on_chat_model_end` billing hook). The runner no longer calls `ReportLlmCallUsage` gRPC.
- TypeScript cursor-runner: Remove or disable `BillingClient` per-turn usage reporting
- `BillingStopMiddleware` in graphton: Instead of activating on runner-received billing signal (from deprecated RPC), it now activates on `ExecutionControlSignal` from `UpdateStatusResponse` (which was already the direction from the changelog)
- Verify: runner still functions correctly without the billing gRPC client
- The `ReportLlmCallUsage` RPC handler can be left in place (dormant) or removed — no urgency since it's `is_skip_authorization`

**Depends on**: T03, T05 (proxy billing + updateStatus signal must work first)

**Estimated size**: Medium

---

## Execution Order

```
T01 (SSE parser) ✅ DONE
        ↓
T02 (updateResourceUsage RPC) ──→ T03 (LlmProxy wiring) ──→ T04 (CursorProxy wiring)
                                          ↓
                                   T05 (strip llm_metrics + billing signal)
                                          ↓
                                   T08 (deprecate runner billing calls)

T06 (dual headers) ──→ T07 (mcp_server_id + caching)
```

T02 and T06 can start in parallel. T08 is the final cleanup task.

## Success Criteria

1. A tampered runner reporting zero tokens has no effect on billing — credits are debited based on proxy-observed usage
2. `updateStatus` response carries accurate STOP/WARNING signals based on proxy-written billing state
3. No runner code changes except: passing `mcp_server_id` through classify workflow (T07) and removing deprecated billing calls (T08)
4. OSS path works exactly as before (no proxy, no billing, `llm_metrics` preserved for display)
5. Every proxy LLM call requires at least one scope header (execution_id or mcp_server_id)
6. UI/CLI can display usage from proxy-written trusted data (not runner-reported)

## Review Process

**What happens next**:
1. **You review this plan** — consider the task breakdown and sizing
2. **Provide feedback** — adjust task boundaries, reorder, split/merge
3. **I'll revise the plan** — create T01_1_review.md with feedback, then T01_2_revised_plan.md
4. **You approve** — give explicit approval to proceed
5. **Execution begins** — pick tasks one at a time
