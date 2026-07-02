# HITL Shared Fixture Corpus

Cross-edition test data for human-in-the-loop (HITL) approvals. This corpus is
the **single source of truth** that keeps the OSS (Go) and Cloud (Java) approval
projections behaviorally identical: both editions load these exact files and must
produce the same `pending_approvals` from the same inputs.

It lives only here, in OSS `apis/`. The Java test vendors it from the same pinned
OSS tag used for proto stubs (a local sibling checkout in dev) — never a
hand-maintained duplicate, which would recreate the very drift this corpus
exists to prevent.

## Layout

```
scenarios/*.json       parity scenarios (input -> expected pending_approvals)
canonicalization/      the tool-action canonicalization contract (see its README)
schema.json            JSON Schema for a scenario file
```

## Scenario format

```jsonc
{
  "name": "single-pending",
  "description": "one gated tool call -> one pending approval",
  "input": {
    "messages": [ /* AgentMessage protos as protojson */ ],
    "sub_agent_executions": [ /* SubAgentExecution protos as protojson */ ]
  },
  "expected": {
    "pending_approvals": [ /* PendingApproval protos as protojson */ ]
  }
}
```

- Bodies are **protojson** (proto3 JSON): `snake_case` field names, enums as
  their string constant (e.g. `"TOOL_CALL_WAITING_APPROVAL"`), and proto3
  default values omitted. Parsers use the generated proto types, so a scenario
  that fails to parse is a contract error, not a silent skip.
- `expected.pending_approvals` is compared **order-independently** by
  `tool_call_id` using proto semantic equality.

### Why no `expected.approval_events`

The Phase-1 contract this corpus locks is *projection parity*: the message scan
and the shadow event-stream projection must yield the same `pending_approvals`.
The intermediate event-stream representation (event ids, actor strings) is an
internal Phase-1 detail that will evolve, so pinning its exact JSON here would
over-specify it across editions. The event shape is locked instead by
language-local unit tests (Go `project_test.go`, the Java mirror). The schema
keeps `approval_events` as an optional field for when a later phase promotes the
stream to the source of truth.

## Who reads this

- Go: `backend/services/stigmer-server/pkg/domain/agentexecution/approval/fixtures_test.go`
- Java: `PendingApprovalFixtureTest` (Cloud), loading the same files.

Each runs BOTH the message scan and the event-stream projection and asserts both
equal `expected.pending_approvals`.
