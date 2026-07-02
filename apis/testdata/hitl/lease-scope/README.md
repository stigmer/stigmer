# HITL Lease-Scope Derivation Contract

This directory pins **lease-scope derivation** — the reduction of a single tool
call to the class of actions its `APPROVE_ALL` decision leases for the rest of an
execution.

`APPROVE_ALL` ("approve all of this kind") is no longer an all-or-nothing gate
bypass. It grants a run-lifetime lease scoped to ONE class:

- a gated built-in's approval **category** (`write` / `delete` / `shell`), where
  file *write* and *edit* deliberately collapse to one `write` class, or
- an MCP tool's **server** (the slug), covering all of that server's tools.

A read-only built-in or an unknown name has **no** leasable scope (`null`): an
`APPROVE_ALL` on it leases nothing, so no other call is auto-approved by it.

## Why a shared corpus

Three editions derive this scope independently and must never disagree, or an
`APPROVE_ALL` clicked in one edition would auto-approve a different set of
co-pending calls than another:

- **TS** (runner): `deriveLeaseScope` in
  `backend/services/runner/src/shared/approval-policy.ts` (the per-call core of
  `deriveActiveLeases`).
- **Go** (OSS): `DeriveLeaseScope` in
  `backend/services/stigmer-server/pkg/domain/agentexecution/approval/lease_scope.go`.
- **Java** (Cloud): `LeaseScope.deriveKey` in
  `ai.stigmer.domain.agentic.approval.LeaseScope`.

Each edition has a test that loads `vectors.json` and asserts every vector, so a
drift fails one of the three suites.

## Contract

For each vector, `derive(input.toolName, input.mcpServerSlug)` must equal
`expected`:

- `{ "category": "write" | "delete" | "shell" }` for a gated built-in,
- `{ "server": "<slug>" }` for an MCP tool, or
- `null` for a tool with no leasable scope.

The MCP server slug **takes precedence** over the built-in category and is
compared **raw** (no case folding) — the slug is the server's identity exactly as
stored on the tool call. (A real built-in never carries a slug and a real MCP
tool never resolves to a category, so the precedence is parity insurance, not a
behavioral choice — but it is locked here so the three editions cannot drift on
the edge case.)

The category classification itself (name -> `write`/`delete`/`shell`) is the
shared approval-category oracle, already mirrored across editions; these vectors
pin the thin scope-derivation wrapper on top of it.
