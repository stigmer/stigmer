# Follow-Up Tasks: Runner Task Status Enrichment

**Created:** 2026-05-23 (during Runner Task Status Enrichment implementation)
**Context:** Deferred items from the task I/O population work. These are NOT blockers for the T05 Inspector showing data, but represent gaps in completeness.

---

## 1. pending_approvals Race Condition (Bug)

**Severity:** Medium (affects fork + agent_call scenarios only)
**Root cause:** Every `emitWorkflowEvents` call sends a status proto with nil `pending_approvals`. The Go server's merge logic unconditionally assigns `pending_approvals` from the request (`updated.Status.PendingApprovals = requestStatus.PendingApprovals`), which clears any active approvals set by `call-agent-status.ts`.

**Why it can't be fixed without a proto change:** In proto3, empty repeated fields and nil repeated fields are indistinguishable on the wire. The server cannot differentiate "runner didn't include this field" from "runner explicitly cleared it."

**Proposed fix:** Add a `bool clear_pending_approvals` flag to `WorkflowExecutionUpdateStatusInput` or change the merge logic to only assign when a separate signal indicates intentional update.

**Impact today:** Only manifests in `fork` workflows where one branch has an `agent_call` with HITL while another branch makes progress (emitting events that clear the approval).

---

## 2. Budget Enforcement Wiring

**Context:** `BudgetTracker` exists at `backend/services/runner/src/budget/tracker.ts` (complete, tested) but is NOT wired into the execution loop.

**What needs to happen:**
1. Add `budget?: WorkflowBudget` to `ExecuteServerlessWorkflowInput`
2. Hydrate budget from Workflow spec in `hydrate-workflow-execution.ts`
3. In `do-executor.ts` after each task: `tracker.record(costInfo)` → `tracker.check()` → policy enforcement
4. Emit `budget_checkpoint` events at configurable intervals

**Why deferred:** Budget enforcement has UX implications (what does "budget exceeded" look like?) and is orthogonal to data capture for the inspector.

---

## 3. Resolved Config Capture (Builder-Level)

**Context:** The Inspector's "Input" tab currently shows the pipeline value (`effectiveInput` from `resolveTaskInput`). Users also want to see "what was this HTTP call configured with?" (the resolved URL, headers, body after jq evaluation).

**Architectural constraint:** `resolveConfigExpressions` happens INSIDE each task builder (`CallHttpTaskBuilder.build()`, `CallAgentTaskBuilder.build()`, etc.), not in `do-executor.ts`. The resolved config is not accessible from the do-executor loop.

**Proposed approaches:**
- A) Modify each builder to return `{ output, resolvedConfig }` tuple
- B) Have builders set metadata on the accumulator via ctx
- C) Add a pre-execution hook that resolves config outside the builder

**Recommended:** Option B — have builders call `ctx.taskStatusAccumulator?.setTaskMetadata(name, { resolved_config: ... })` after resolving expressions. Least invasive, no return-type changes.

---

## 4. Agent Call Live Status Propagation

**Context:** An `agent_call` task shows "started" for its entire duration (could be 20 minutes). The user sees no progress until it completes.

**Desired behavior:** Task status transitions through `running → waiting_human → running → completed` as the child agent progresses.

**Challenge:** The `call-agent-orchestrator.ts` handles signals inside the Temporal deterministic isolate. Updating the `TaskStatusAccumulator` from the signal handler is safe (it's in-process, sandbox-safe), but emitting events from within the signal handler would require careful sequencing.

**Proposed approach:** In the signal handler for `child_approval_required`, call `accumulator.taskWaitingApproval(taskName)` and trigger an `emitEvents` call. When the signal is resolved (approval granted), transition back to "started."

---

## 5. Agent Call Event Emission

**Context:** The `AgentCallStartedEvent` and `AgentCallCompletedEvent` types exist in `types.ts` and `toProtoEvent` handles them, but nothing in the engine actually emits them.

**What needs to happen:**
- Emit `agent_call_started` when the `CallAgent` activity is dispatched (in `orchestrateAgentCall`)
- Emit `agent_call_completed` when the activity completes or fails

**Useful for:** The execution waterfall timeline (T07) needs these events to show agent call duration bars.

---

## 6. Artifact Reference Model

**Context:** The research report recommends `inputRef`/`outputRef`/`streamChunkRef` for large payloads — external storage with ID references instead of inline data.

**Current state:** We use `truncatePayload` (64KB cap) as a safety net. This is adequate for now but not ideal for:
- Large agent responses (full conversation transcripts)
- HTTP responses with large bodies
- For-each outputs with many iterations

**Required infrastructure:** An artifact storage service (S3-compatible or similar) that doesn't exist yet.

---

## 7. LLM Cost Attribution (Pricing Table)

**Context:** `call:llm` tasks return `input_tokens` and `output_tokens` but NOT `cost_micros`. Computing cost requires a model pricing table (model → cost per input token, cost per output token).

**Current state:** LLM tasks show tokens in the inspector but cost shows as $0.00.

**What needs to happen:**
1. Create a model pricing registry (can start as a static config)
2. After each LLM call, compute `cost_micros = input_tokens * price_per_input + output_tokens * price_per_output`
3. Inject `__stigmer_cost_micros` into the LLM result

---

## 8. task_id Generation

**Context:** The proto has a `task_id` field (string) meant to uniquely identify each task execution instance. Useful for retry correlation, deduplication, and linking events to specific attempts.

**Current state:** Never populated (always empty string).

**Proposed:** Generate a deterministic `task_id` from `workflowExecutionId + taskName + attemptNumber`. This requires wiring attempt tracking into the accumulator.
