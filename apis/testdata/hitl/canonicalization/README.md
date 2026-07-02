# HITL Approval Canonicalization Contract

This directory pins the **canonicalization** of a tool action — the single,
explicit normalization pass that erases incidental differences between two
representations of the same action before any hash is computed.

It exists because the rolled-back March 2026 dedup hashed *divergent*
representations of the same call (display args in one place, raw args in
another). The fix is to canonicalize at exactly one layer, deterministically,
and to lock that determinism with cross-language vectors so Go, Java, and TS all
agree byte-for-byte.

> Phase 1 scope: the canonical form is **defined and computed** only. It is not
> yet hashed. The approval fingerprint (an HMAC keyed on a Stigmer secret) is
> introduced in Phase 2 and consumes this canonical string. Nothing here is an
> enforcement key.

## The pass (in order)

1. **toolName** — trimmed only. Case and taxonomy are preserved (cross-harness
   naming is normalized separately by `ToolKind`); canonicalization must not
   silently merge distinct tools.
2. **mcpServerSlug** — trimmed and lowercased (slugs are case-insensitive
   identity); empty for built-in tools.
3. **paths** — each path: backslashes → forward slashes; absolute paths under
   `workspaceRoot` rewritten to workspace-relative; `.`/`..` collapsed. The list
   is then sorted (multi-file edits are an unordered set for identity).
4. **shellCommand** — internal whitespace runs collapsed to a single space, then
   trimmed. The command value is identity; incidental spacing is not.
5. **args** — passed through structurally; values of keys named in `secretKeys`
   are replaced by `sha256:<hex>` (unkeyed redaction so the canonical form is
   stable but never carries cleartext).

## Canonical JSON (RFC 8785 subset)

The normalized object is serialized with:

- object keys sorted by UTF-16 code unit,
- no insignificant whitespace,
- UTF-8 output (non-ASCII not escaped),
- `undefined`-valued keys dropped.

The input domain is constrained to strings, booleans, null, **integers**,
arrays, and plain objects. Non-integer numbers are rejected rather than
implementing RFC 8785's full number-formatting algorithm — this keeps each
language's serializer small and provably identical without a third-party
dependency.

## vectors.json

`canonicalToolActionJson(input)` must equal `expected` for every vector, in
every edition. The TS implementation lives at
`backend/services/runner/src/shared/approval-canonicalize.ts`; Go/Java
implementations added in Phase 2 must load this same file and pass it. Secret
redaction is verified by language-local tests (digests are not hand-writable).
