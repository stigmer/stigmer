# T05: SDK Runner Docs — Close Quality Gaps

**Date**: April 24, 2026

## Summary

Closed three quality gaps in the SDK runner documentation: added the missing
`DOMAIN_META` entry so the React reference page renders with proper title and
description, created `overview.md` for the resources page so it matches every
other agentic resource, and deleted the orphaned `agent-runner.mdx` left behind
by a proto rename.

## Problem Statement

T05 was originally scoped as "add `useLaunchLocalRunner`, `useStopRunner`,
`useDeleteRunner` to the React SDK runner reference." Investigation revealed the
auto-generators had already picked up all three hooks — the `next-task.md`
description was written before the last codegen run. The real gaps were
consistency and hygiene issues in the generated output.

### Pain Points

- `docs/sdk/react/runner.mdx` rendered with lowercase `title: runner` and no
  `description` — the only React SDK domain page without a `DOMAIN_META` entry.
- `docs/sdk/resources/runner.mdx` used a generic spec-derived fallback overview
  because `apis/ai/stigmer/agentic/runner/docs/overview.md` did not exist —
  Runner was the only agentic resource without one.
- `docs/sdk/resources/agent-runner.mdx` (564 lines) sat in the directory from a
  previous codegen run using the old `AgentRunner` naming. Not in `meta.json`,
  not linked from anywhere, not produced by the current generator — but still
  on disk.

## Solution

Three targeted fixes, all in the codegen input layer (not hand-editing generated
output):

1. **DOMAIN_META entry** — Added `runner` to the metadata map in the React SDK
   docs generator parser. Regenerated. Title is now `Runner`, description is
   now `Hooks and components for runner lifecycle, fleet management, local
   launch, and picker.`

2. **overview.md** — Created `apis/ai/stigmer/agentic/runner/docs/overview.md`
   following the established pattern (concise intro + representative YAML
   example). Regenerated with `make gen-proto-sdk-docs`. The resources page now
   opens with the hand-crafted overview and drops the redundant `description`
   from frontmatter.

3. **Orphan deletion** — Deleted `agent-runner.mdx`. Verified the current
   generator does not produce it (the proto package was consolidated from
   `AgentRunner` to `Runner` in a prior project). No codegen config fix needed.

## Implementation Details

### Files changed

| File | Change |
|------|--------|
| `site/scripts/generate-react-sdk-docs/parser.ts` | Added `runner` entry to `DOMAIN_META` |
| `apis/ai/stigmer/agentic/runner/docs/overview.md` | New file — resource overview for SDK codegen |
| `docs/sdk/react/runner.mdx` | Regenerated (frontmatter now has title + description) |
| `docs/sdk/resources/runner.mdx` | Regenerated (overview.md content injected, generic description removed) |
| `site/src/data/react-sdk-summary.json` | Regenerated (runner domain metadata updated) |
| `docs/sdk/resources/agent-runner.mdx` | Deleted (orphaned, 564 lines) |

### Key decisions

- **No hand-edits to generated files.** All fixes go through the codegen input
  layer (DOMAIN_META map, overview.md file) so they survive future regeneration.
- **overview.md keeps the "thin spec" story.** The Runner resource deliberately
  has a minimal spec. The overview explains this design choice rather than
  padding with fields that don't exist.

## Benefits

- Runner SDK pages are now consistent with every other resource in both the
  React SDK and Resources reference sections.
- The orphaned `agent-runner.mdx` can no longer confuse search indexing or
  contributors browsing the directory.
- Future codegen runs preserve all improvements (nothing was hand-patched).

## Impact

- **SDK docs readers** see a properly titled and described Runner page in both
  React and Resources sections.
- **Contributors** no longer encounter a stale `agent-runner.mdx` that
  contradicts the canonical `runner.mdx`.

## Related Work

- **T02** (runner concepts page) first flagged the `agent-runner.mdx` / `runner.mdx`
  duplication.
- **T04** (CLI runner guides) completed Phase A documentation up to T05.
- **20260423.02.phase3-persistent-runners-browser-launch** created the hooks
  that the React SDK generator now documents.

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
