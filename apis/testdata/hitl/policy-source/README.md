# HITL Authorization-Provenance Contract

This directory pins **authorization provenance** — the `ApprovalPolicySource`
recorded on every gated or auto-approved tool call (`ToolCall.approval_policy_source`,
projected onto `PendingApproval`). It answers *which policy layer decided this
call's approval requirement*, so every authorization is auditable and the gate
can be explained ("required by agent override") while a tool is still waiting.

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
  `UNSPECIFIED` default (a tool no policy layer governs — e.g. a read-only
  built-in, or a legacy execution predating the field).
- `name_proto` is the fully-qualified proto enum value name.
- `number` is the proto enum field number, which is **append-only**: existing
  values are never renumbered or removed (clients fall back to `UNSPECIFIED`
  exactly as for an unset `tool_kind`).
