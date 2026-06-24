# HITL Approval Fingerprint Contract

This directory pins the **approval fingerprint** — the exact-match enforcement
identity the HITL Tool Execution Gateway (Phase 2) compares at the moment a side
effect would happen. It builds directly on the canonical form pinned in
`../canonicalization/`.

```
fingerprint = version + ":" + hex( HMAC-SHA256( key, canonicalForm ) )
```

- **version** — `v1`. A skew re-asks (safe) rather than silently mismatching.
- **key** — the per-execution key (derived from a runner-held master secret). In
  these vectors the key is the **UTF-8 bytes** of the `key` field, so every
  language hashes the same bytes.
- **canonicalForm** — the RFC 8785-subset JSON from `../canonicalization/`.

## Two fidelities, one core

The two enforcement substrates can reproduce different amounts of the action, so
the fingerprint has two fidelities over the same canonicalization core:

- **full** — `HMAC(key, canonicalToolActionJson(input))`. The in-process
  deep-agent gateway sees the full arg shape at both approve-time and
  execute-time (LangGraph checkpoint replay), so it matches at full fidelity.
- **coarse** — `HMAC(key, canonicalJson(coarseToolIdentity(input)))`, where the
  coarse identity is `{ tool, mcpServerSlug, salient }`. The out-of-process Cursor
  deny-oracle hook names the same action with a different taxonomy (`Write` vs
  `edit`, `file_path` vs `path`) and cannot reproduce full args, so it matches on
  the category + salient resource only. `tool` is the cross-taxonomy approval
  **category** (`write`/`delete`/`shell`) for gated built-ins — which is why
  `coarse-write-hook-taxonomy` (`Write`) and `coarse-write-stream-taxonomy`
  (`edit`) share one fingerprint.

## vectors.json

`computeApprovalFingerprint(key, input)` must equal each `full[].expected`, and
`computeCoarseApprovalFingerprint(key, input)` each `coarse[].expected`, in every
edition. The TS implementation is
`backend/services/runner/src/shared/approval-fingerprint.ts`; the Go/Java editions
added in Phase 2 (Slice E) load this same file and must reproduce every value
byte-for-byte against the fixed key.

These values are machine-generated (an HMAC hex is not hand-writable). To
regenerate after an intentional contract change, recompute with the TS
implementation and the fixed key above, and bump `version` if the canonical form
or MAC primitive changed.
