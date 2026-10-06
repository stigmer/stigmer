# HITL Lease-Scope Derivation Contract

This directory pins **lease-scope derivation**: the reduction of a single tool
call to the class of actions its `APPROVE_ALL` decision leases for the rest of an
execution.

`APPROVE_ALL` ("approve all of this kind") is not an all-or-nothing gate
bypass. It grants a run-lifetime lease scoped to ONE class:

- when a hook asked (`approval_policy_source` is `HOOK`), **that hook's asks on
  that tool**: the deciding plugin's slug (`approval_policy_hook`, empty for the
  agent's own hooks block), the tool's name and its MCP server slug, if any. A
  later ask from the same hook on the same tool then counts as that hook's
  allow; nothing else is cleared, and the default keeps asking wherever the
  hook does not;
- otherwise a gated built-in's approval **category** (`write` / `delete` /
  `shell`), where file *write* and *edit* deliberately collapse to one `write`
  class, or
- an MCP tool's **server** (the slug), covering all of that server's tools.

A read-only built-in or an unknown name has **no** default scope (`null`): an
`APPROVE_ALL` on it leases nothing, unless a hook asked for it.

## Why a shared corpus

Two readers derive this scope independently and must never disagree, or an
`APPROVE_ALL` would auto-approve a different set of co-pending calls on the
server than the runner then lets through:

- the runner: `deriveLeaseScope` in
  `backend/services/runner/src/shared/approval-policy.ts` (the per-call core of
  `deriveActiveLeases`);
- the server: `deriveLeaseScope` in
  `backend/services/stigmer-server/src/domain/agentrun/approval/lease-scope.ts`,
  which `bulkApproveCoPendingToolCalls` matches co-pending calls with.

Each has a test that loads `vectors.json` and asserts every vector, so a drift
fails one of the two suites.

## Contract

For each vector, the scope derived from `input` (`toolName`, optional
`mcpServerSlug`, optional `policySource` as the proto enum name, optional
`policyHook`) must equal `expected`:

- `{ "hook": "<slug>", "tool": "<name>", "server": "<slug or empty>" }` when
  `policySource` is `APPROVAL_POLICY_SOURCE_HOOK`,
- `{ "category": "write" | "delete" | "shell" }` for a gated built-in,
- `{ "server": "<slug>" }` for an MCP tool, or
- `null` for a tool with no leasable scope.

The source decides: a hook slug on a row whose source is not `HOOK` is ignored.
The MCP server slug **takes precedence** over the built-in category and is
compared **raw** (no case folding): the slug is the server's identity exactly as
stored on the tool call. (A real built-in never carries a slug and a real MCP
tool never resolves to a category, so the precedence is parity insurance, not a
behavioral choice.)

The category classification itself (name -> `write`/`delete`/`shell`) is the
shared approval-category oracle; these vectors pin the thin scope-derivation
wrapper on top of it.
