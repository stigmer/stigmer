# File-Change Digest Contract

This directory pins the **canonical digest** of a captured file change so the
file-review enforcement gate ("what you approve is what gets applied") computes
byte-identically in every edition. A `FileDecision.expected_digest` is matched
against these digests by the runner's reconcile (Phase 2); a Go/Java mismatch
would silently let one edition approve content the other would reject.

> Phase 1 scope: the digest functions are **defined, computed, and locked**.
> The runner that produces the captured changes and the reconcile that enforces
> the digest land in Phase 2; this corpus locks the determinism first.

## The functions

`file_digest(change)` — identity+content digest of one captured file change:

```
canonical = path_before + "\n" + path_after + "\n" + kind + "\n"
          + before_sha256 + "\n" + after_sha256
file_digest = lowercase_hex(sha256(utf8(canonical)))
```

- `kind` is the proto enum **value name** (`FileChangeKind`, e.g.
  `FILE_CHANGE_KIND_MODIFY`) — identical via Go `.String()` and Java `.name()`.
- `before_sha256` / `after_sha256` are the SHA-256 of the raw file bytes
  (computed by the runner over exact bytes; opaque inputs here). Empty for the
  absent side (ADD has no before, DELETE has no after).
- Digesting the content **hashes** (not the bytes) keeps the canonical string
  pure ASCII, so there is no line-ending or encoding ambiguity to reconcile
  across languages.

`aggregate_digest(changes)` — digest over the whole ordered manifest:

```
aggregate_digest = lowercase_hex(sha256(utf8(join("\n", sort_ascending(file_digests)))))
```

Sorting the per-file digests makes the aggregate independent of input order (a
change set is an unordered set of files for identity). The empty set hashes the
empty string.

## vectors.json

`file_digest(case)` must equal `case.file_digest`, and
`aggregate_digest(named cases)` must equal `aggregate.aggregate_digest`, in
every edition. The Go implementation lives at
`backend/services/stigmer-server/pkg/domain/agentexecution/filereview/digest.go`;
the Java implementation at
`.../domain/agentic/filereview/FileDigest.java`. Expected values were computed
independently (plain `sha256`), so a passing run in both editions proves
parity, not self-consistency.
