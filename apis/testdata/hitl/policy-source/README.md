# HITL Authorization-Provenance Contract

This directory pins **authorization provenance** — the `ApprovalPolicySource`
recorded on every gated or auto-approved tool call (`ToolCall.approval_policy_source`,
projected onto `PendingApproval`). It answers *which policy layer decided this
call's approval requirement*, so every authorization is auditable and the gate
can be explained ("required: marked destructive by the server") while a tool is
still waiting.

## Why a shared corpus

The provenance is produced in one place — the runner (TS) — and consumed in two
others — the Go (OSS) and Java (Cloud) backends, which copy the persisted enum
through `update_status` and the `pending_approvals` projection without
re-deriving it. The cross-edition risk is therefore not three derivations
disagreeing (as with lease-scope) but the **runner's union->enum mapping drifting
from the proto enum the backends consume**, or the proto enum being renumbered in
one edition. Either would make a persisted `approval_policy_source` mean
different things in different editions.

Each vector pins one source to its proto enum `name_proto` and `number`:

- **TS** (runner): `toProtoPolicySource` in
  `backend/services/runner/src/shared/approval-policy.ts` maps the internal
  `PolicySource` union (or `undefined`) to the generated enum; the test asserts
  it lands on `number`.
- **Go** (OSS): the generated `ApprovalPolicySource_value` map must resolve
  `name_proto` to `number`.
- **Java** (Cloud): `ApprovalPolicySource.valueOf(name_proto).getNumber()` must
  equal `number`.

A drift in the runner mapping, or a renumbering of the enum in any edition, fails
one of the three suites.

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
