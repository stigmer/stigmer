# DD-04: No Fallback/Defensive Code for Empty Subject in CLI

**Date**: 2026-03-09
**Status**: ACCEPTED

## Decision

If `subject` is empty, the CLI displays it as empty. No fallback to `input`, `name`, or metadata fields.

## Rationale

- Defensive fallback chains (try subject, then metadata description, then name) create confusing UX where the user cannot predict what text will appear
- The current fallback chain (`GetSubject()` -> `Metadata.Fields["description"]` -> `Name`) sometimes surfaces the full task prompt or misleading labels
- If the runner fails to populate `subject`, the right fix is in the runner, not a CLI workaround that masks the problem
- Clean single-source-of-truth: `subject` is the display label, period

## CLI Changes (PR4)

- Remove the `sa.Metadata.Fields["description"]` fallback in `run_stream_subagent.go` lines 50-56
- Remove `if subject == "" { subject = e.Name }` fallback in `run_stream_inline_render.go` lines 148-149
- `SubAgentStartedEvent.Description` is set directly from `sa.GetSubject()` with no fallback
