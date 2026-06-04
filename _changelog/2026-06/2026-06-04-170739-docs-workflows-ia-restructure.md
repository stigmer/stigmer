# Documentation Information Architecture Restructure

**Date**: June 4, 2026

## Summary

Reworked the documentation information architecture on two axes: established a
deliberate top-level reading order (Do -> Understand -> Build -> Look up) and
consolidated four loose workflow guide pages into a single collapsible
`Workflows` group, peer to the existing `AI editors`, `Integrations`, and
`Authentication` groups. Because the per-task reference pages are code-generated
and their URLs are baked into backend runtime data, the move spanned docs,
codegen, sidecar metadata, and the synced backend registry embed — all updated
in lockstep so in-app deep-links continue to resolve.

## Problem Statement

The docs sidebar had no narrative and an inconsistent grouping model. The
top-level sections were ordered `getting-started -> guides -> sdk -> cli ->
concepts`, which buried the mental-model material (Concepts) below two reference
sections. Inside Guides, `editors`, `integrations`, and `authentication`
rendered as clean collapsible groups, but the four workflow pages
(`workflows`, `workflow-tasks`, `workflow-patterns`, `workflow-execution`) sat
as loose top-level siblings.

### Pain Points

- New readers hit deep how-to guides and reference before encountering the
  conceptual model that explains the domain vocabulary.
- The two reference sections (SDK, CLI) were split around Guides instead of
  grouped at the end.
- Workflow documentation read as scattered files rather than a coherent section,
  unlike every other Guides topic.
- The 20-page task reference is code-generated, and its URLs ship inside
  `task-kind-registry.json` (consumed by the workflow editor's Docs tab), so a
  naive docs-only move would have broken in-app deep-links.

## Solution

- **Top-level order** ([docs/meta.json](docs/meta.json)): reordered to
  `getting-started -> concepts -> guides -> sdk -> cli`. Concepts moves up to
  establish the mental model early; SDK and CLI reference become adjacent at the
  end.
- **Workflows group**: created `docs/guides/workflows/` as a real folder (Fumadocs
  derives collapsible groups from folders), with a new `index.mdx` overview that
  tells the author -> tasks -> patterns -> execute story. The four pages were
  git-moved into it (`authoring`, `task-types`, `patterns`, `execution`), and the
  20 generated task pages relocated under `workflows/task-types/`. The
  `task-types.mdx` page remains the same-name index of the `task-types/` folder,
  so the sidebar UX is identical — just relocated.
- **Codegen + runtime coupling**: updated the generator, sidecar metadata, and
  Makefile targets so regeneration produces the new paths, then regenerated and
  synced the backend embed.

## Implementation Details

**Docs structure:**

| Change | Path |
|--------|------|
| New group overview | `docs/guides/workflows/index.mdx` + `meta.json` |
| Renamed | `workflows.mdx` -> `workflows/authoring.mdx` |
| Renamed | `workflow-tasks.mdx` -> `workflows/task-types.mdx` |
| Renamed | `workflow-tasks/` -> `workflows/task-types/` (20 pages + meta) |
| Renamed | `workflow-patterns.mdx` -> `workflows/patterns.mdx` |
| Renamed | `workflow-execution.mdx` -> `workflows/execution.mdx` |
| Reordered nav | `docs/meta.json`, `docs/guides/meta.json` |

**Codegen and runtime:**

- [tools/codegen/generator/task_docs.go](tools/codegen/generator/task_docs.go):
  updated the hardcoded "See Also" links and index card hrefs to the new
  `/docs/guides/workflows/...` paths.
- [Makefile](Makefile): pointed `gen-task-docs` and `gen-task-docs-check`
  `--output-dir` and Prettier globs at `docs/guides/workflows/task-types`.
- 20 sidecar YAMLs under
  `apis/ai/stigmer/agentic/workflow/v1/tasks/meta/`: updated `documentation_url`
  to `/docs/guides/workflows/task-types/<slug>` — the source of `documentationUrl`
  in the registry.
- Regenerated via `make gen-task-docs` + `make gen-task-registry`, which rewrote
  the moved pages and re-synced
  `backend/services/stigmer-server/pkg/domain/workflow/registry/data/task-kind-registry.json`.

**Cross-links:** updated every internal reference to the old workflow URLs across
`docs/concepts/workflows.mdx`, `docs/getting-started/first-workflow.mdx`, and the
moved pages. The `DocsTab` consumer renders `documentationUrl` verbatim, so no
frontend code change was needed.

## Benefits

- A coherent reading narrative: Concepts establishes vocabulary before Guides and
  Reference put it to work.
- Workflow docs now read as one navigable section instead of four loose files,
  matching the rest of Guides.
- The generated task reference and its in-app deep-links stay correct because the
  URL source-of-truth moved together with the docs.

## Impact

- **Readers**: clearer sidebar story and a single Workflows entry point.
- **Workflow editor users**: the Docs tab deep-links resolve to the new paths.
- **External bookmarks**: the site is a static export with no `redirects()`
  support, so old workflow-guide URLs will 404. A follow-up could add client-side
  redirect stubs if bookmark continuity becomes important.

## Verification

- `make gen-task-docs-check` and `make gen-task-registry-check` — clean.
- `make -C apis lint` (buf), `go vet ./tools/codegen/...`, `gofmt` — clean.
- `make format-docs-check` (Prettier) and Vale on the new overview — clean.
- Fumadocs MDX collection compiled and `.source` reflects the new tree with no
  stale paths; structural nav validation confirmed every `meta.json` page exists.

## Related Work

- Builds directly on the
  [Workflow Documentation Overhaul](2026-05/2026-05-17-161804-workflow-documentation-overhaul.md),
  which created these pages.
- Complements the
  [per-task codegen reference docs](2026-05/2026-05-17-163821-per-task-codegen-reference-docs.md)
  that generate the task reference relocated here.

---

**Status**: ✅ Production Ready
