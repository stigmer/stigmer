# Follow-Up Tasks: Waterfall Timeline Backend Enrichment

**Created:** 2026-05-23 (during T07 — Execution Waterfall Timeline)
**Context:** The waterfall renders task-level bars from existing events today. These backend changes would unlock richer bar segments (agent sub-spans, retry backoff gaps, queue delays, streaming phases) without any frontend code changes — the derivation layer and component architecture are already designed to consume them.

---

## 1. Agent Call Event Emission (High Priority)

**What:** The runner does not emit `agent_call_started`, `agent_call_progress`, or `agent_call_completed` events. The proto types, frontend event handling (in `WorkflowExecutionEventStore` and `WorkflowExecutionTimelineEvent`), and waterfall derivation (`WaterfallSpan.children`) are all ready.

**Where to change:**
- `backend/services/runner/src/workflows/call-agent.ts` or `orchestrateAgentCall` — emit `agent_call_started` when the `CallAgent` activity is dispatched
- Same location — emit `agent_call_completed` when the activity completes or fails
- Optionally emit `agent_call_progress` at intervals during long-running agent calls

**Impact when done:** Waterfall will automatically render nested purple sub-span bars inside `agent_call` task rows, showing exactly how long the agent ran within the overall task duration.

**Also documented in:** `checkpoints/runner-task-io-followups.md` (item #5)

---

## 2. Task Retrying Event Emission (Medium Priority)

**What:** `task_retrying` events (with `delay_ms` for backoff) are defined in the proto and handled in the event store, but the runner does not emit them. The waterfall derivation reads `taskRetrying` events to set `retrying` status on accumulators.

**Where to change:**
- `backend/services/runner/src/workflows/engine-core.ts` — in the retry loop, emit a `task_retrying` event between `task_failed` (with `willRetry: true`) and the next `task_started`
- Include `delay_ms` from the retry policy's backoff calculation

**Impact when done:** Waterfall retry attempt segments will show visible backoff gaps between failed and retried attempts, matching the AWS Step Functions red/gray segment pattern.

---

## 3. Queue Delay Modeling (Low Priority / Future)

**What:** No proto field or event exists for queue/scheduling delay (the time between an execution being created and the runner picking it up). This is relevant for concurrency-limited or resource-constrained workflows.

**What would be needed:**
- A new field on `TaskStartedPayload` (e.g., `queue_duration_ms`) or a new event type (e.g., `task_queued`)
- Runner would need to track when a task was scheduled vs. when it actually started executing

**Impact when done:** Waterfall could show a light gray "queue" segment before the execution bar, similar to Inngest's compound bars.

---

## 4. Streaming Phase Segmentation (Low Priority / Future)

**What:** Distinguishing "LLM streaming tokens" from "executing" within a single task bar. Currently, an `llm_call` task shows as one solid bar from `task_started` to `task_completed`.

**What would be needed:**
- A new event (e.g., `task_streaming_started` / `task_streaming_completed`) emitted by the LLM call builder when the first token arrives and when the stream completes
- Or a sub-event on `task_started` that includes a streaming flag

**Impact when done:** Waterfall could show a compound bar: solid for setup/request, striped/animated for streaming, solid for post-processing.

---

## 5. subscribeEvents Push Delivery (Medium Priority)

**What:** The `subscribeEvents` RPC currently polls SQLite every 500ms. For smoother waterfall animation during live executions, events could be pushed through the `StreamBroker` alongside execution snapshots.

**Where to change:**
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/subscribe_events.go` — currently polls on a timer
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/update_status.go` — `BroadcastToStreamsStep` currently only pushes full execution snapshots
- Add event broadcasting to the `StreamBroker` channel alongside the snapshot push

**Impact when done:** Waterfall bars would update within a single frame of an event arriving (currently up to 500ms delay). Most noticeable for fast-running workflows where 500ms polling creates visible lag in bar growth.
