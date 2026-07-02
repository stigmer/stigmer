# File Review Projection Corpus

This directory pins the **file_change_sets projection** over the append-only
file_review event ledger, replayed identically by both editions (Go
`FileChangeSetProjector` / Java `FileChangeSetProjector`). It is the file-review
sibling of `../sequences` (which pins the approval projection).

Each fixture is a list of `FileReviewEvent`s (the persisted ledger) plus the
execution phase, and the expected projection summary. The driver builds a
`FileReviewEventStream` from the events, runs the projection seam, and asserts
the summary matches — so a fold/status/derivation drift between Go and Java
fails one of the two suites.

## Format (schema.json)

```json
{
  "name": "...",
  "description": "...",
  "execution_id": "aex_...",
  "phase": "EXECUTION_IN_PROGRESS",
  "events": [ <FileReviewEvent protojson>, ... ],
  "expected": [
    {
      "id": "cs1",
      "status": "FILE_CHANGE_SET_STATUS_AWAITING_REVIEW",
      "change_ids": ["fc1", "fc2"],
      "decision_count": 0,
      "aggregate_digest": "agg1",
      "has_approved_snapshot": false
    }
  ]
}
```

The `expected` entry is a **summary** of each projected `FileChangeSet` — the
derived `status`, the ordered `change_ids`, the derived `decision_count`, the
carried `aggregate_digest`, and whether an `approved_snapshot` was set. This is
the set of fields the fold derives or carries; the internal event_id/timestamp
shapes are locked by the per-edition unit tests. A terminal `phase` projects an
empty list (the actionable-projection-is-phase-aware rule).

Event bodies are raw protojson decoded with the generated `FileReviewEvent`
type, so a malformed fixture fails loudly rather than being silently skipped.
The cross-language `file_digest` / `aggregate_digest` functions are locked
separately in `../file-digest`.
