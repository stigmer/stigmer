---
name: docs-writing
description:
  How Stigmer's documentation is written beyond the mechanics in docs/STYLE.md,
  covering the register per reader, the choice of a page's medium, Scenar
  demonstrations, narration and alt text, tutorial sequences, the overview files
  that feed generated reference pages, and what to refuse. Use when writing or
  reviewing any page under docs, a tour under demos, or site content.
paths:
  - docs/**
  - site/**
  - demos/**
---

# Writing Stigmer's documentation

`docs/STYLE.md` holds the mechanics (headings, code blocks, MDX components, the
classification contract, the medium rule) and `docs/vocabulary.md` holds every
term and the five writing contexts. Neither is restated here. This skill holds
the doctrine those two apply: why the rules are what they are, and the judgement
calls a page needs that no lint can make. The package guide (`docs/AGENTS.md`)
carries the laws in one line each.

## Match the register to the reader

`docs/vocabulary.md` defines five contexts (sales site, quickstart and
tutorials, concepts and how-to, reference and SDK, README), each with its own
audience and register. Identify the context before writing a sentence, then
calibrate.

- When the context is unclear, write for the least technical reader in the
  audience. Plain language is always safe; unnecessary jargon never is.
- On the sales site and in introductory docs: replace jargon with plain words
  ("definition file", not "declarative manifest"; "keeps running even if
  something crashes", not "durable execution with checkpoint recovery"); when a
  term such as API or YAML is unavoidable, explain it in the same sentence; use
  everyday analogies (recipes, filing cabinets, assembly lines), never analogies
  to other infrastructure tools.
- In reference and SDK docs: precise technical language, exact field names,
  proto message types and CLI flags; do not re-explain what earlier pages
  taught.
- In architecture and contributor docs, references to Kubernetes, Docker and the
  like are appropriate; the audience lives there.
- Stigmer's own terms are proper nouns used consistently. Never a synonym.

## Choose the medium with the rule, not by preference

The rule is in `docs/STYLE.md` ("Classify every page"), applied in order, first
yes wins. Two doctrines sit behind it:

- **Motion is for demonstration.** An animated tour is reserved for a flow whose
  timing or cause-and-effect is the lesson. A reader working through a
  quickstart wants to stop, compare their screen with ours and scroll back; an
  animated tour makes all of that awkward. Getting-started journeys and console
  procedures are screenshot journeys paced by the reader.
- **The text fallback is a hard requirement.** The docs are read through three
  channels: the rendered site, the markdown exports (`llms-full.txt` and the
  per-page `.md` files) and the Copy-as-Markdown button. An embed is invisible
  in the last two; it passes through as a dangling tag. Every visual therefore
  contributes text to the exports (per-step prose, alt text, or the Mermaid
  source itself), and the prose around an embed carries the information on its
  own.

## Demonstrations are Scenar artifacts

Every screen demonstration (animated tour, still, screenshot journey) is a
Scenar scenario under `demos/tours/`: a timeline of steps plus a pure render
function over real `@stigmer/react` components and frozen fixtures.
`demos/README.md` is the authoring guide and the source of the numbers (the
canonical viewport, the sizing contract, the theme contract); read it before
touching a tour. `scripts/verify-scenar-tours.mjs` enforces the invariants in
CI, and its header explains each one. The laws an author most often bends:

- Steps are pure functions of step data. Depict a component state through props;
  never drive a stateful component with synthetic events.
- Fixtures never read the live clock. Every instant derives from the exported
  `SAMPLE_INSTANT`; a literal date is a defect.
- Never author `zoom` or a CSS scale in a tour. Legibility comes from the camera
  (the `viewport_transition` interaction), not from shrinking; one scale factor
  per frame, owned by the viewport boundary.
- Tour-local views use `--scenar-*` tokens so both themes work; review light and
  dark.

Animated tours are packed, hosted, and embedded with `<ScenarEmbed>`; adding or
removing one changes the page's classification entry and needs a prose lead-in
that stands alone. Stills and screenshot journeys are named shots on a
scenario's steps (`shot`, kebab-case, named and never indexed), rendered by
`scenar shoot` in light and dark, and they ride the pack pipeline rather than
the repository. A hand-captured screenshot rots with no signal; a rendered still
is regenerated from source. Until a page's stills exist, the page keeps its
current state rather than gaining a placeholder.

## Narration and alt text are different registers

Narration (the `narration` field on a step) is written for audio: it narrates
concepts and outcomes, not screen mechanics ("The agent pauses and asks a human
to approve", not "Now a card appears"). One idea per step, one or two sentences,
never a repeat of the caption. Not every step needs narration; silence gives the
visual room. Alt text describes a screen, is authored in the MDX beside the
image, and is never derived from narration.

## Tutorials and learning paths

For any content where pages form a sequence:

- **Narrative continuity.** Each page opens on what the reader accomplished on
  the previous page and closes by motivating the next with a concrete,
  functional reason. Test: read only the first and last paragraph of each page;
  can you reconstruct the order without the sidebar?
- **Aha-moment design.** Each tutorial names one moment where the reader sees
  something work. State it in "What you'll build", deliver it when the reader
  runs the command, reinforce it in "What just happened". Test: point to the
  exact step where the reader's screen changes in a way that proves the concept.
  If the payoff is only intellectual, the tutorial is an explanation in
  disguise.
- **One new concept per page.** Defer what the reader does not need yet.
- **Implicit defaults.** Use the platform's sensible default without asking the
  reader to configure anything; introduce configuration when there is a reason
  to customise.
- **The bridge.** Every page in a sequence ends with a "Next step" that answers
  two questions: what can the reader not do yet, and what will the next page
  teach? The motivation is a gap the reader can feel, never navigational. Good:
  "Your agent gave a generic answer. It doesn't know your return policy or your
  product catalog. Let's fix that." Bad: "Continue to the next tutorial."
- Entry-point ordering, path convergence and prerequisite chains belong to the
  information architecture; a page author does not decide path structure.

## Reference pages generated from protos

SDK reference pages are generated from the proto schemas; the generator lives
under `tools/codegen/` and the comment convention it reads is owned by
`tools/codegen/src/internalcomment/internalcomment.ts` (the `apis/AGENTS.md`
laws state it). Proto comments serve proto readers; the hand-written overview
file in the `docs` folder beside a resource's protos (for example
`apis/ai/stigmer/agentic/agent/docs/overview.md`) serves SDK users and becomes
the reference page's first section verbatim. Do not make one text serve both
audiences with markers or keywords.

An overview file is written in the reference register and the Diátaxis reference
type: two or three sentences on what the resource is and configures, then one
minimal, representative YAML example in a standard fenced block (every YAML
block under `docs/` is contract-validated, so it must apply as written). No
frontmatter, no metadata, no duplication of what the generated Methods and Types
sections already say.

## What to refuse

- Documentation that requires the reader to already understand the thing being
  documented.
- A page added, moved or deleted without its classification entry changing in
  the same commit.
- A hand-captured screenshot, even as a placeholder.
- An animated tour for content the reader works through at their own pace.
- A visual that leaves the markdown exports with nothing.
- A new component or scenario in the legacy inline-demo surface under
  `site/src/components/docs/demos/`.
- Infrastructure-tool analogies on the sales site or in introductory docs.
- Filler ("it should be noted that", "it is important to understand").
- Two Diátaxis types on one page.
- A measured native-versus-Cursor comparison, in a table, in prose or through a
  fixture. The harness benchmark (`make benchmark-harnesses`) is an internal
  instrument: an Agent performs best in the harness and models built for it, so
  a generic comparison on a handful of prompts tells a reader nothing about
  their Agent, and the platform's own evaluation tooling is where they measure
  it. A page explains how the harnesses differ and never quotes a measurement
  between them.
