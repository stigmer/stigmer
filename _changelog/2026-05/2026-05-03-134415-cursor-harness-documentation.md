# Cursor Harness User-Facing Documentation

**Date**: May 3, 2026

## Summary

Added comprehensive user-facing documentation for the Cursor harness feature
across the Stigmer docs site. This includes a new concept page explaining what
harnesses are and how to choose between native and Cursor, a new how-to guide
for setting up and using the Cursor harness, vocabulary entries for harness
terminology, and cross-links woven into existing Sessions, Runners, and runner
guide pages.

## Problem Statement

The Cursor harness shipped as a major new capability — users can choose between
Stigmer's native execution engine and the Cursor SDK engine for their Sessions.
However, documentation coverage was limited to auto-generated SDK reference
pages (`SessionInput.harness`, `HarnessOption`, `HarnessSelector`). There was
zero conceptual, guide, or getting-started coverage explaining what harnesses
are, why a user would choose one, or how to set it up.

### Pain Points

- Users encountering the harness selector or model picker had no documentation
  explaining the concept
- No vocabulary entry for "Harness" meant inconsistent terminology across
  future writing
- Existing concept pages (Sessions, Runners) made no mention of harnesses,
  leaving a gap in the progressive learning path
- No actionable guide for setting up the Cursor harness locally or in cloud

## Solution

Applied a three-layer documentation strategy following the established Diataxis
methodology and information architecture:

1. **Layer 1 — Concept anchor**: New explanation page at
   `docs/concepts/harnesses.mdx`
2. **Layer 2 — Actionable guide**: New how-to page at
   `docs/guides/runners/cursor-harness.mdx`
3. **Layer 3 — Cross-cutting updates**: Vocabulary entries, existing page
   patches, and nav updates

## Implementation Details

### New files

- **`docs/concepts/harnesses.mdx`** — Explanation page covering: what a Harness
  is, native vs Cursor comparison with feature table, "Choosing a Harness"
  decision guide, simplified Mermaid architecture diagram showing the dispatch
  flow, SDK code examples (TypeScript/Go) for creating a Cursor Session, and
  "What's next" bridging to the guide.

- **`docs/guides/runners/cursor-harness.mdx`** — How-to guide with: prerequisites,
  step-by-step local setup (env var, `stigmer up`, console verification), cloud
  setup (one paragraph — proxy is automatic), SDK session creation, model
  selection with compound keys, approval flow parity note, limitations table,
  and troubleshooting section.

### Updated files

- **`docs/vocabulary.md`** — Three new entries: Harness (Tier 1 with full
  context-aware examples), Cursor harness (Tier 2), cursor-runner (Tier 3).
  Added Harness row to the quick-reference table.

- **`docs/concepts/sessions.mdx`** — Added "Harness" section between "Creating
  a Session" and "Session-level overrides" with YAML example and cross-link.

- **`docs/concepts/runners.mdx`** — Added paragraph about dual-worker support
  and dedicated task queues. Added Cursor harness guide link to "What's next."
  Updated flow text to bridge to the new Harnesses concept page.

- **`docs/guides/runners/overview.mdx`** — Added Cursor harness card to the
  guides grid alongside local/sandbox/cloud mode cards.

- **`docs/concepts/meta.json`** — Added `"harnesses"` after `"runners"` in the
  sidebar ordering.

- **`docs/guides/runners/meta.json`** — Added `"cursor-harness"` after
  `"cloud-mode"` and before `"stop-and-cleanup"`.

### Design decisions

- **Named "Harnesses"** (not "Execution engines") to match the API term
  (`SessionSpec.harness`). Vocabulary entry bridges to plain-language
  "execution engine" for sales/quickstart contexts.
- **Skipped interactive demo** — the concept page is an explanation page;
  comparison tables and Mermaid diagram carry the weight. Demo deferred until
  the UI harness selector stabilizes.
- **Excluded cloud proxy details** — CursorProxyController and fetch interceptor
  are backend/operator concerns, not user-facing documentation.
- **Did not modify getting-started/quickstart** — follows progressive disclosure;
  quickstart uses native harness implicitly.
- **Did not edit auto-generated SDK reference pages** — they already document
  harness types, fields, and cross-links correctly via codegen.

## Benefits

- Users can now discover and understand the Harness concept through the natural
  docs learning path (Sessions → Runners → Harnesses → Workflows)
- Clear decision framework (comparison table) for choosing between native and
  Cursor
- Actionable setup guide reduces time-to-first-Cursor-session
- Vocabulary entries ensure consistent terminology across all future writing
- Cross-links from existing pages make the feature discoverable without
  requiring users to know it exists

## Impact

- **Docs site**: 2 new pages, 6 updated pages, 3 vocabulary entries
- **User journey**: Harnesses integrated into the progressive learning path
  between Runners and Workflows
- **SDK reference**: Already complete via codegen — no changes needed

## Related Work

- Cursor harness implementation: `_projects/2026-04/20260430.01.cursor-harness`
- Content strategy and information architecture:
  `_projects/2026-03/20260331.01.content-strategy`

---

**Status**: ✅ Production Ready
