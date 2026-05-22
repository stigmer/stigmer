# Session Notes: 2026-05-19 — Phase 3c (Session 8)

## Accomplishments

- Completed Phase 3c: HITL interrupt/resume, approval gate middleware, sub-agent concurrency limiter, sub-agent middleware wiring
- 4 new files, 4 new test files, 7 modified files
- 38 new tests (341 total), typecheck clean, build clean

## Design Decisions Made

- **DD-8: Middleware-based approval gating.** Approval checks happen in a `wrapToolCall` middleware (`ApprovalGateMiddleware`) rather than wrapping each tool individually. Keeps all execution controls in the middleware stack.
- **DD-9: Platform tool defaults included.** Safe tools (read, ls, glob, grep, think) auto-approved. Dangerous tools (write, edit, delete, execute, shell) require approval when no explicit policy exists. Unknown tools default to auto-approved.
- **DD-10: Summarization deferred to Phase 4.** Custom `ContextSummarizationMiddleware` (880 Python lines + utilities) is independent from HITL. Phase 4 will verify DeepAgents JS built-in vs custom porting.

## New Files

| File | Lines | Tests | Purpose |
|------|-------|-------|---------|
| `middleware/approval-gate.ts` | ~150 | 9 | Middleware checking merged policies via `wrapToolCall`, calling `interrupt()` for approval-required tools. Platform tool defaults. |
| `activities/execute-deep-agent/hitl.ts` | ~190 | 7 | `resolveResumeInput()` (DB-driven resume, interrupt→decision matching, `Command(resume=...)` builder), `reconcileToolCallStatuses()` |
| `shared/subagent-gate.ts` | ~80 | 7 | `SubAgentGate` — Promise-based semaphore (max 3), non-blocking rejection, slot tracking |
| `activities/execute-deep-agent/subagent-wiring.ts` | ~55 | 5 | `buildSubAgentMiddleware()` — per-sub-agent stack: loop detection + periodic budget (30/4) + truncation + cost cap view |

## New Test Files

| File | Tests |
|------|-------|
| `middleware/__tests__/approval-gate.test.ts` | 9 |
| `activities/execute-deep-agent/__tests__/hitl.test.ts` | 7 |
| `shared/__tests__/subagent-gate.test.ts` | 7 |
| `activities/execute-deep-agent/__tests__/subagent-wiring.test.ts` | 5 |
| `activities/execute-deep-agent/__tests__/hitl-integration.test.ts` | 5 (StatusBuilder integration + post-stream skip) |

## Modified Files

| File | Changes |
|------|---------|
| `middleware/types.ts` | Added `ApprovalGateConfig` to `MiddlewareStackConfig` |
| `middleware/index.ts` | Integrated `ApprovalGateMiddleware` in stack (after graceful-stop, before cost-cap) |
| `status-builder.ts` | Added `ApprovalPolicyProvider`, `setApprovalProvider()`, `checkApprovalRequirement()`, WAITING_FOR_APPROVAL on tool start, argsPreview sanitization |
| `streaming.ts` | Detect WAITING_FOR_APPROVAL after stream ends, return terminal status without setting COMPLETED |
| `post-stream.ts` | Skip all post-stream processing when phase is WAITING_FOR_APPROVAL |
| `setup.ts` | Resolve approval policies via `mergeApprovalPolicies()`, pass to middleware stack. Added `approvalPolicies`, `toolServerMap`, `autoApproveAll` to SetupResult |
| `index.ts` | Wire HITL resume: `resolveResumeInput()`, rejection fast-path, approval provider on StatusBuilder |

## Architecture Notes

- **Middleware-based approval**: The `ApprovalGateMiddleware` uses `wrapToolCall` to check policies and call `interrupt()`. This is structurally cleaner than the Python pattern of wrapping each tool individually.
- **DB-driven resume**: On reinvocation, `resolveResumeInput()` reads approval decisions from the persisted execution status (via `client.getExecution()`). Decisions are matched to LangGraph checkpoint interrupts by `tool_call_id`.
- **Sub-agent interrupt propagation**: Sub-agents compiled with `checkpointer=null` inherit the parent graph's checkpointer. `interrupt()` in a sub-agent propagates to the parent checkpoint automatically.
- **Non-blocking rejection**: `SubAgentGate` returns an error-shaped message when at capacity rather than queuing. The LLM adapts its plan.
- **Sub-agent periodic budget**: Always interval=30 rounds, max 4 advisories (matching Python `compile_subagent`).

## Critical Invariants Verified

1. DB-driven resume — decisions read from persisted status, not Temporal args
2. Don't complete while waiting — WAITING_FOR_APPROVAL phase prevents COMPLETED transition
3. Post-stream skip — artifact/writeback processing skipped during approval wait
4. Idempotent on resume — interrupt() returns decision value on replay
5. Args sanitization — sensitive fields (password, token, secret, api_key) redacted in argsPreview

## Next Session Plan

1. **Phase 4: Supporting Activities** — EnsureThread, MCP discovery, classify tool approvals; multi-provider model support; MCP package pre-installer; skill relevance filtering; summarization middleware verification
