# Agent guide: docs

The documentation content: hand-authored MDX pages, the generated reference
sets, the page inventory, and the two documents every page is written against.
The site that renders it lives in `site/`; the tours the pages embed live in
`demos/`. This guide is an index; `STYLE.md` and `vocabulary.md` are the truth.

## Read in this order

- `STYLE.md`: headings, code blocks and their contract validation, the page
  classification contract, every MDX component, stills, prose, diagrams, links,
  and the LLM-friendly exports.
- `vocabulary.md`: every term, the five writing contexts and their registers,
  the inconsistency register. The single source of truth for terminology.
- `CONTRIBUTING.md`: adding a page, `meta.json` ordering, the Make targets and
  pre-commit hooks.
- `_inventory/classification.yaml`: the entry every hand-authored page has.
- `demos/README.md` before touching a tour or adding an embed;
  `scripts/verify-scenar-tours.mjs` header for the nine invariants it enforces.

## Laws

- Every hand-authored page has an entry in `_inventory/classification.yaml` with
  one Diátaxis type, a fate, a medium and a `why` when the medium is not `none`.
  Add, move or delete a page and change its entry in the same commit; add or
  remove an embed and change the page's `embeds` map. Generated sets are covered
  by cohort rules.
- One Diátaxis type per page, never mixed. An explanation growing inside a
  how-to moves to its own page and is linked.
- Choose the medium by the rule in `STYLE.md`, in order, first yes wins; prose
  and code are the substrate, not a medium. Getting-started journeys and console
  procedures are screenshot journeys; an animated tour is for a flow whose
  timing is the lesson.
- Stills and journeys are rendered by `scenar shoot` from a scenario in
  `demos/tours/`. Never a hand-captured screenshot, not even as a placeholder;
  the page waits.
- Every embed and every still carries prose that stands alone: the markdown
  exports and the Copy-as-Markdown button see no embed, so the lead-in and the
  alt text carry the information.
- No new component or scenario in the legacy inline-demo surface under
  `site/src/components/docs/demos/`; it is being retired page by page.
- Every YAML block is contract-validated by `make check-docs-yaml`; an example
  that would not apply does not ship.
- Match the register to the context from `vocabulary.md`; when unsure, write for
  the least technical reader in the audience. Use Stigmer's terms as proper
  nouns and never a synonym.
- In a sequence of pages, each page opens on what the previous one achieved and
  closes on a gap the reader can feel, not a navigational "continue".
- Generated pages under `sdk/` and `cli/commands/` are never hand-edited; fix
  the proto comment, the TSDoc or the generator and re-run `make codegen`.

## Skills

- `.agents/skills/docs-writing/SKILL.md`: the doctrine behind the laws above:
  registers, the two medium doctrines, Scenar authoring, narration and alt text,
  tutorial sequences, overview files, refusals. Load it before writing a page or
  a tour.

## Verify

The root map's rows, plus `make build-site` when `meta.json`, a section or a
component changes, and `node scripts/verify-scenar-tours.mjs` when a page adds
or removes an embed or still (`make check-node` runs it in CI). `make lint-docs`
needs `vale sync` once in a fresh checkout.
