# Cursor Runner Error Introspection — Surfacing the Real SDK Failure Reason

**Date**: June 3, 2026

## Summary

When a cloud Cursor execution failed, the runner often reported a generic
`Cursor run failed (no detail from SDK)` while the real cause (a transport or
routing failure, an auth rejection, a rate limit) was silently discarded by the
`@cursor/sdk`. This change teaches the runner to recover that detail from two
additional sources — the failing `run.conversation()` turn and a thrown
`CursorSdkError`'s structured fields — and feeds them through the existing error
classifier so failures surface an actionable reason instead of a dead-end
message. This was the durable observability follow-up to the BiDi ingress-route
fix that resolved the underlying `grpc-status 12` routing bug.

## Problem Statement

The Cursor SDK has a confirmed habit of swallowing the real failure reason: a
failed `run.wait()` frequently resolves to a bare `{ status: "error" }` with no
usable message, and some Connect RPC errors escape as process-level
`unhandledRejection` rather than surfacing through the run handle. During the
BiDi-route incident, an inference stream that was being misrouted to the main
gRPC server returned `grpc-status 12 UNIMPLEMENTED`, but the runner only logged
the generic fallback — the routing root cause was invisible until it was
reproduced and traced at the network layer.

### Pain Points

- `run.wait()` returning `{ status: "error" }` produced `Cursor run failed
  (no detail from SDK)` with no category and no next step.
- The SDK's richer error surface — `run.conversation()` (which retains the error
  turn) and `CursorSdkError.toJSON()` (`code`, `status`, `endpoint`,
  `requestId`) — was never read on the failure path.
- A thrown `CursorSdkError` fell through to the generic outer catch and was
  flattened to `[CursorAgentError] <message>`, losing its structured fields and
  bypassing the classifier entirely.
- Operators debugging a failed cloud execution had no signal distinguishing a
  routing failure from an auth failure from a transient network blip.

## Solution

Extend the runner's error classifier with two new, backward-compatible sources
and wire them into the execution activity's failure handling — strictly as
best-effort enrichment that never alters success-path behavior.

1. **`sdkError`** — structured fields lifted from a caught `CursorSdkError`,
   classified at the highest priority.
2. **`conversationErrorText`** — the human-meaningful text recovered from the
   failing `run.conversation()` turn, classified just above the
   transport-timeout heuristic so a specific message always beats the generic
   fallback.

## Implementation Details

### `error-classifier.ts`

- Added optional `sdkError?: SdkErrorFields` and `conversationErrorText?: string`
  to `SynthesizeErrorOpts`, plus a new `"conversation"` value in the
  `ClassifiedError.source` union.
- `classifyFromSources` now resolves in this precedence:
  `sdkError > sdkResultFields > stream > rejection > conversation >
  transport-timeout heuristic > resumed-handle fallback > unknown`.
- `sdkError` is classified across `code`/`status`/`message` together, so a
  `code` alone (e.g. `unavailable`, `resource_exhausted`) still resolves a
  category even when no message text is present.
- The diagnostic log line now includes the two new sources.

### `execute-cursor/index.ts`

- New best-effort helper `introspectConversation(run, executionId)`: guarded by
  `run.supports("conversation")`, fully wrapped in try/catch, logs the bounded
  raw turns for deep diagnostics, and returns a concise error string. It can
  never throw into the execution's error path.
- New schema-agnostic `extractConversationErrorText(turns)`: walks the last
  conversation turn collecting error-status payloads and `text`/`message`/
  `reason` strings, deduplicated and length-bounded. Schema-agnostic by design
  so it tolerates future SDK conversation-shape changes.
- The `run.wait()` `case "error"` path now captures `conversationErrorText`
  before classifying; the poisoned-handle retry path mirrors the same capture.
- The outer catch now detects a thrown `CursorSdkError`, logs its `toJSON()`,
  and routes it through `synthesizeError` (via a hoisted `errorContext` carrying
  model/mode/agentId) so it receives a proper classified message instead of the
  flattened generic format.

### Tests

- New `__tests__/error-classifier-introspection.test.ts` (11 tests): covers
  `sdkError` classification (network/auth/rate-limit, and code-only inputs),
  empty-`sdkError` fall-through, `conversationErrorText` surfacing, and the full
  source precedence chain.

## Benefits

- A misrouted or transport-failed execution now surfaces the real reason
  (e.g. the conversation's `unimplemented`/`Method not found` text) instead of
  "no detail from SDK".
- Thrown `CursorSdkError`s are classified consistently and retain their
  structured diagnostics (`code`, `status`, `endpoint`, `requestId`) in logs.
- Failure categories (`auth`, `rate-limit`, `network`, `agent-stale`, `model`)
  remain accurate and continue to drive the existing retry decisions.
- Zero behavioral change on the success path; all introspection is best-effort.

## Impact

- **Runner (cloud + local)**: richer, actionable failure messages and logs on
  the Cursor execution path. No change to successful executions.
- **Operators**: a future transport/routing regression surfaces its real cause
  in `runner.log` and the execution status, rather than requiring live
  network-layer reproduction.
- **Deployment**: the runner is baked into the `agent-sandbox-full` image; this
  change reaches cloud only after a sandbox image rebuild, `prod.sandbox-image`
  repoint, and `stigmer-service` deploy.

## Related Work

- Follows the BiDi ingress-route fix (`handoff-cursor-bidi-route-fix.md`) that
  resolved the `grpc-status 12` routing root cause; this is its observability
  follow-up (TODO 4.3).
- Companion infra documentation (`README.md` cataloguing the supplementary
  `infra-hub/kubernetes` resources) was added in the `stigmer-cloud` repo to
  make the BiDi route durable against environment rebuilds (TODO 4.2).
- Builds on the prior `rejection-capture.ts` mechanism for correlating
  `unhandledRejection` ConnectErrors to executions.

---

**Status**: ✅ Production Ready (pending sandbox image rebuild + deploy)
**Timeline**: Focused observability enhancement
