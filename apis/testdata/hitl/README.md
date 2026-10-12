# HITL Shared Fixture Corpus

Test data for human-in-the-loop (HITL) approvals. The scenarios pin the message
scan that describes each tool call waiting for an answer: from the same rows it
must produce the same `pending_approvals`. Which calls wait is the session's
event log (an `agent.tool_use` with `evaluated_permission` `ask` that no
`user.tool_confirmation` or result has closed), so the scenarios pin the
description alone.

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
    "sub_agent_runs": [ /* SubAgentRun protos as protojson */ ]
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

## Who reads this

- `backend/services/stigmer-server/src/domain/run/approval/__tests__/scenarios-corpus.test.ts`
  runs the message scan over every scenario and asserts it equals
  `expected.pending_approvals`.
