# HITL Approval Fingerprint Contract

This directory pins the **approval fingerprint** — the exact-match enforcement
identity the HITL tool-execution gate compares at the moment a side
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

## The form it hashes

`HMAC(key, canonicalToolActionJson(input))`: the gate sees the full arg shape
at both approve-time and execute-time, so it matches at full fidelity.

## vectors.json

`computeApprovalFingerprint(key, input)` must equal each `full[].expected` in
every edition. The TS implementation is
`backend/services/runner/src/shared/approval-fingerprint.ts`; any other
implementation loads this same file and must reproduce every value
byte-for-byte against the fixed key.

These values are machine-generated (an HMAC hex is not hand-writable). To
regenerate after an intentional contract change, recompute with the TS
implementation and the fixed key above, and bump `version` if the canonical form
or MAC primitive changed.
