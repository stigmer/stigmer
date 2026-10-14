# HITL Authorization-Provenance Contract

This directory pins **authorization provenance** — the `ApprovalPolicySource`
the runner records on every gated or auto-approved tool call, and the word the
session's `stigmer.permission.asked` event carries for it (`policy_source`). It
answers *which policy layer decided this call's approval requirement*, so every
authorization is auditable and the gate can be explained ("required: marked
destructive by the server") while a tool is still waiting.

## Why a shared corpus

The provenance is produced in one place, the runner, and read by the server
from the asked event's word. The risk is the **runner's union->enum mapping
drifting from the enum's numbering, or from the word the log carries**.

Each vector pins one source to its enum `name_proto`, its `number` and its
word (`policySource`):

- the runner: `toProtoPolicySource` in
  `backend/services/runner/src/shared/approval-policy.ts` maps the internal
  `PolicySource` union (or `undefined`) to the runner's enum; the test asserts
  it lands on `number`, with one vector per enum value, so a new value cannot
  land without its vector;
- the server: its lease-scope corpus test
  (`backend/services/stigmer-server/src/domain/run/approval/__tests__/lease-scope-corpus.test.ts`)
  reads each lease vector's enum name as the word this corpus pairs it with.

## Contract

For each vector:

- `policySource` is the runner's `PolicySource` union string, or `null` for the
  `UNSPECIFIED` default (a call that needed no approval — a read-only built-in,
  an MCP tool its server does not mark destructive — or a legacy execution
  predating the field).
- `name_proto` is the fully-qualified proto enum value name.
- `number` is the proto enum field number. A retired value is reserved, number
  and name, and never renumbered or reused: values 1 to 3 recorded the removed
  per-tool approval policies and are reserved in the proto, so the corpus no
  longer lists them. Clients fall back to `UNSPECIFIED` for a number they do
  not know, exactly as for an unset `tool_kind`.
