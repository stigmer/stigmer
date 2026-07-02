# HITL Approval-Stream Sequence Corpus

Cross-edition test data for the **stateful, persisted-append** approval path. Where
`../scenarios/*.json` lock a single input → `pending_approvals` projection, these
sequences replay a *series of write sites* over a carried-forward
`approval_event_stream` — the exact path the production reconciler mutates — and
assert, after **every** step, that:

1. the message-scan projection and the event-stream projection agree (the
   **equality-at-every-write-site** property the eventual source-of-truth flip
   rides on), and
2. both editions author the same approval-event **lifecycle**.

The OSS (Go) and Cloud (Java) editions load these exact files, so a behavioral
drift in either reconciler fails one of the two suites. This is the shared,
data-driven counterpart to the per-edition unit tests in
`retraction_test.go` / `RetractionReconcileTest.java`.

It lives only here, in OSS `apis/`. The Java test vendors it from the same pinned
OSS tag used for proto stubs (`make sync-hitl-fixtures`) — never a hand-maintained
duplicate.

## Why a sequence corpus exists at all

The `scenarios/` corpus builds the events side with a **fresh**
`EmitApprovalEvents(...)` re-derived from the current scan. That can never catch a
bug in the *append* path, because it never appends — it re-derives. The whole
reason `pending_approvals` is not yet flipped to the stream is that the
append-only stream needs a *total* lifecycle (a terminal event for every gate
exit). This corpus drives that append path directly: it carries the authored
stream forward and re-runs the real `EnsureApprovalRequests` (and, at decision
sites, `RecordDecisionEvent`) at each step.

## Layout

```
sequences/*.json   ordered write-site sequences (see schema.json)
schema.json        JSON Schema for a sequence file
```

## File format

```jsonc
{
  "name": "approve-supersede-orphan-complete",
  "description": "...",
  "execution_id": "exec-seq",
  "steps": [
    {
      "name": "seed: root + sub-agent calls gated",
      "status": {
        "phase": "EXECUTION_WAITING_FOR_APPROVAL",
        "messages": [ /* AgentMessage protos as protojson */ ],
        "sub_agent_executions": [ /* SubAgentExecution protos as protojson */ ]
      },
      "expected": {
        "pending_approvals": [ /* PendingApproval protos as protojson */ ],
        "stream_events": [ { "approval_request_id": "...", "event_type": "..." } ]
      }
    }
  ]
}
```

- Proto bodies are **protojson** (proto3 JSON): `snake_case` field names, enums as
  their string constant, proto3 defaults omitted. Parsers use the generated types,
  so a malformed step is a contract error, not a silent skip.
- The driver **owns the stream**: `status` carries only author-visible state
  (`phase`, `messages`, `sub_agent_executions`) and never the
  `approval_event_stream`. The stream is the carried-forward output of the prior
  step.

### The two write-site types

Each step is one of the two write sites production has, and the driver reproduces
each faithfully:

- **UpdateStatus site** (no `decisions`): runs `EnsureApprovalRequests` only.
- **SubmitApproval site** (`decisions` present): authors `EnsureApprovalRequests`
  **while the clicked call is still gated**, *then* applies each decision (sets
  `approval_action` / `approval_decided_at` / `approved_by` on the call and
  authors the decision event) — the same order as the handler.

The order is not cosmetic: if the decision were applied *before*
`EnsureApprovalRequests`, the call would be neither gated nor yet resolved and the
retraction reconciler would **falsely retract it**. So a decision step's `status`
MUST show each `decisions[].tool_call_id` in its **pre-decision gated state**
(`TOOL_CALL_WAITING_APPROVAL`, `APPROVAL_ACTION_UNSPECIFIED`); the driver asserts
this and fails loudly otherwise. A multi-entry `decisions` list models an
APPROVE_ALL that resolves co-pending calls (the clicked APPROVE_ALL plus one
APPROVE per co-pending), which is exactly what the handler authors via repeated
`RecordDecisionEvent`.

### What `expected` pins

- `pending_approvals` — the seam (`ProjectPendingApprovals` /
  `PendingApprovalProjector.project`) result after the step, compared
  order-independently by `tool_call_id`. A terminal phase projects an empty list
  (the phase-aware seam).
- `stream_events` — a **normalized** view of the authored stream:
  `{ approval_request_id, event_type, reason? }`, compared order-independently.
  Here, unlike `scenarios/`, the events ARE the subject under test, so the
  lifecycle (transition type, correlation id, retraction reason) is asserted —
  while still **not** pinning `event_id` / `timestamp` / `actor`, which are
  internal and stay locked by the per-edition unit tests (`emit.go`,
  `project_test.go`).

## Scope boundary

The corpus operates at the approval-package authoring layer
(`EnsureApprovalRequests` / `RecordDecisionEvent` / `ProjectPendingApprovals`). It
locks the **authoring + projection** contract. The APPROVE_ALL co-pending
*selection* logic (`bulkApproveCoPendingToolCalls`, a controller concern) is
covered by handler tests; here we model its *result* (the per-call decisions it
authors), not the selection.

## Deliberately not covered: retract-then-re-request

A sequence where a `tool_call_id` is RETRACTED and then the **same** id re-enters
the gate is intentionally absent. Because `event_id = approval_request_id:type` is
deterministic (and `approval_request_id == tool_call_id` by design), a second
REQUESTED for a retracted id is swallowed by append-if-absent, so the event
projection would keep it resolved while the scan re-reports it pending — a
deliberate divergence, not an equality case this corpus can express. This is the
recorded **mint-trigger** hazard; see
`_projects/2026-06/20260624.01.hitl-approval-architecture/design-decisions/approval-request-id-equals-tool-call-id.md`
and the `TestApprovalRequestIDEqualsToolCallID_DeliberateInvariant` /
`approvalRequestIdEqualsToolCallIdDeliberateInvariant` guards. It is not reachable
in production today (tool-call ids are run-unique and status advances forward).

## Who reads this

- Go: `backend/services/stigmer-server/pkg/domain/agentexecution/approval/sequence_corpus_test.go`
- Java: `SequenceFixtureTest` (Cloud), loading the same files.

Each replays every sequence and asserts the per-step equality property and
lifecycle, plus a once-per-sequence check that the divergence counter never moved.
