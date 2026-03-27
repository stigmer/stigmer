# Notes: 20260326.02.hitl-approval-flow-hardening

**Created**: 2026-03-26

---

## 2026-03-26 20:52 - Gap Analysis Complete

Full HITL flow analysis completed across all four codebases. Key findings:

### Gaps by Severity

| Severity | Gap | Area |
|----------|-----|------|
| Medium | ApprovalStateManager bypassed on hot paths | Python hitl.py |
| Medium | Sub-agent fingerprint map not populated | Python status_builder.py |
| Medium | Optimistic dismissal masks signal failures | React useSessionConversation.ts |
| Low-Medium | Single-shot poll fallback | React useSessionConversation.ts |
| Low | Dead `_remove_from_pending` code | Python status_builder.py |
| Low | Batch resume abort not user-visible | Python execute_graphton.py |

### Deferred Items (Not in scope for this project)

These were identified but deprioritized:

- **Go/Java handler parity** (Gap 8): No automated mechanism to detect behavioral divergence between the two handler implementations. Would need shared proto-level contract tests. This is a larger architectural concern.
- **CheckpointFallback empty PA correlation** (Gap 9): The defense-in-depth path can't correlate multi-tool batches when `pending_approvals` is empty. The primary fix (preserving PAs) addresses root cause.
- **ApprovalCard comment field** (Gap 4): The `onSubmit` prop supports `comment` but the UI has no input field. Deliberate simplicity for now.
- **clearApprovalError not exposed in UI** (Gap 6): Error persists until next send. Auto-clears on next `submitApproval` call anyway.

### Key Architecture Context

**Six state representations** for approval status (root cause of most bugs):
1. Flat `tool_calls` list on `AgentExecutionStatus`
2. Message-embedded `ToolCall` copies on `MESSAGE_AI.tool_calls`
3. `pending_approvals` list on `AgentExecutionStatus`
4. LangGraph interrupt objects (in-memory, from `aget_state()`)
5. Temporal approval decisions (`ApprovalDecisionList` in workflow signals)
6. UI-derived state (stream snapshots + optimistic updates)

`ApprovalLifecycleState` was introduced to be the single source of truth via `PendingApproval.lifecycle_state`, but enforcement is incomplete.

### File Size Context

- `execute_graphton.py`: 1983 lines (was 4284 before extraction)
- `hitl.py`: 791 lines (extracted from execute_graphton)
- `status_builder.py`: large -- contains `_fingerprint_to_tool_call_id`, `_populate_pending_approval`, dedup logic
- `useSessionConversation.ts`: 564 lines -- session conversation orchestrator

---

*Add timestamped notes below as you work*

---

## 2026-03-26 21:15 - Task 1 Complete: ApprovalStateManager Enforcement

### What Changed
- All 4 direct `lifecycle_state` assignment bypass sites in `hitl.py` now route through `ApprovalStateManager.advance()`
- `_try_enrich_phase1_entry` promoted from standalone function to `InterruptCapture._try_enrich_phase1_entry()` (DDD alignment — groups behavior with owning class)
- `ResumeReconciler` now accepts `state_manager: ApprovalStateManager` in its constructor
- `execute_graphton.py` updated: imports, wiring, removed backward-compat re-export
- 3 test files refactored + new `TestAdvanceEnforcement` class added

### Files Modified
- `backend/services/agent-runner/worker/activities/graphton/hitl.py` (91 lines changed)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (8 lines changed)
- `backend/services/agent-runner/tests/test_hitl_contracts.py` (125 lines changed)
- `backend/services/agent-runner/tests/test_approval_resume.py` (39 lines changed)
- `backend/services/agent-runner/tests/test_status_builder.py` (53 lines changed)

### Surprise Dependencies (not in original plan)
- `test_approval_resume.py` and `test_status_builder.py` imported `_try_enrich_phase1_entry` via the backward-compat re-export in `execute_graphton.py`. Removing that re-export required refactoring both files to instantiate `InterruptCapture` directly.

### Decisions
- **Clear-signal sentinel stays direct**: The `PendingApproval(tool_call_id="", lifecycle_state=CLEARED)` is a protocol marker, not a lifecycle transition — `advance()` would emit misleading logs for a non-existent tool call
- **New PAs start at REQUESTED, then advance**: Preserves full audit trail even for PAs that skip Phase 1
- **No idempotent advance mode**: The existing flow guarantees single-pass processing via `matched_tc_ids` dedup

---

## 2026-03-27 - Tasks 3 + 4 Complete: Frontend HITL Resilience

### What Changed

Both tasks modify `sdk/react/src/session/useSessionConversation.ts` (the behavior hook that orchestrates the full conversation lifecycle).

**Task 3 — Exponential Backoff Polling:**
- Replaced single-shot `setTimeout(3s)` with a self-scheduling timeout chain: 3s → 6s → 12s → 24s → 30s (cap)
- Uses `pollAttemptRef` (useRef) for attempt count, `approvalPollRef` for the active timeout
- Changed condition from filtered `pendingApprovals.length === 0` to raw `activeStreamExecution?.status?.pendingApprovals?.length ?? 0 === 0`
- This is a key design decision: the poll only fires when the *server* hasn't delivered data, not when the user has dismissed all cards. The dismissed case is Task 4's domain.

**Task 4 — Staleness Detection:**
- Internal state changed from `ReadonlySet<string>` to `ReadonlyMap<string, number>` (toolCallId → Date.now())
- Public API stays `ReadonlySet<string>` via `useMemo(() => new Set(dismissedAtMap.keys()), [dismissedAtMap])`
- New `useEffect` with `setInterval(5_000)` checks for entries where `Date.now() - ts > 15_000`
- Uses `dismissedAtMapRef` (useRef) synced on every render to avoid stale closures in the interval callback
- Stale entries are removed → derived Set shrinks → `pendingApprovals` filter stops excluding them → card reappears
- Also triggers `refetch()` when stale entries detected, to catch missed phase transitions

### Files Modified
- `sdk/react/src/session/useSessionConversation.ts` (both tasks, ~50 lines changed)
- `sdk/react/src/session/__tests__/useSessionConversation.test.tsx` (10 new tests, ~330 lines added)

### Constants Added (module-level, not exported)
- `APPROVAL_POLL_INITIAL_MS = 3_000`
- `APPROVAL_POLL_MAX_MS = 30_000`
- `STALE_DISMISSAL_MS = 15_000`
- `STALE_CHECK_INTERVAL_MS = 5_000`

### Design Rationale: Separation of Failure Modes
The two mechanisms handle different failures and deliberately don't overlap:
- **Poll (Task 3)**: Server didn't deliver approval data. Condition: raw approvals empty. Recovery: keep refetching.
- **Staleness (Task 4)**: User submitted but Temporal signal failed. Condition: dismissed entry age > 15s. Recovery: card reappears.

If the poll checked *filtered* approvals (post-dismissal), it would fire every 3s after the user submits an approval — wasteful because the server already has the data, and refetching won't change anything until the Temporal signal processes.

### Stale Closure Handling
The staleness `setInterval` callback needs the latest `dismissedAtMap` state. Since `useState` values in closures can go stale between interval ticks, we use the standard "latest ref" pattern:
```typescript
const dismissedAtMapRef = useRef(dismissedAtMap);
dismissedAtMapRef.current = dismissedAtMap; // sync on every render
```
The interval reads `dismissedAtMapRef.current` to always get the fresh map.

### Test Results
- All 95 SDK React tests pass (7 files)
- 20 tests in useSessionConversation (up from 10)
- Zero regressions

---

