---
name: docs-writing
description:
  How Stigmer's documentation is written beyond the mechanics in docs/STYLE.md,
  covering the register per reader, the choice of a page's medium, alt text,
  tutorial sequences, the overview files that feed generated reference pages,
  and what to refuse. Use when writing or reviewing any page under docs or site
  content.
paths:
  - docs/**
  - site/**
---

# Writing Stigmer's documentation

`docs/STYLE.md` holds the mechanics (headings, code blocks, MDX components, the
classification contract, the medium rule) and `docs/vocabulary.md` holds what
Stigmer is and who it is for, every term and the five writing contexts. Neither
is restated here. This skill holds the doctrine those two apply: why the rules
are what they are, and the judgement calls a page needs that no lint can make.
The package guide (`docs/AGENTS.md`) carries the laws in one line each.

## Match the register to the reader

Every page speaks to one reader: the developer adding agents to their product.
Any sentence that says what Stigmer is uses the words in `docs/vocabulary.md`,
"What Stigmer is, and who it is for", and its examples are jobs done inside a
customer's product, never a chat and never code.

`docs/vocabulary.md` defines five contexts (sales site, quickstart and
tutorials, concepts and how-to, reference and SDK, README), each with its own
audience and register. Identify the context before writing a sentence, then
calibrate.

- When the context is unclear, write for the least technical reader in the
  audience. Plain language is always safe; unnecessary jargon never is.
- On the sales site and in introductory docs: replace jargon with plain words
  ("definition file", not "declarative manifest"; "keeps running even if
  something crashes", not "durable execution with checkpoint recovery"); when a
  term such as API or YAML is unavoidable, explain it in the same sentence.
  Analogies from the reader's own stack (their database, their sign-in provider,
  their job queue) are welcome where they say where Stigmer sits; never an
  analogy to a tool the reader may not run, such as Kubernetes or Temporal.
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

## Screen demonstrations are paused

No page renders a screen demonstration today: how pages show screens is being
redecided, and each page's `medium` in `docs/_inventory/classification.yaml`
keeps its target as input to that decision. Until then a page stays prose, code
and diagrams. A hand-captured screenshot rots with no signal, so it is not added
in the meantime, not even as a placeholder.

## Alt text describes the screen

Alt text is written for a reader who cannot see the image: it describes what the
image shows, not what the reader should feel about it, and it is authored in the
MDX beside the image. It is also what the markdown exports carry in the image's
place.

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
  "Your agent made the variance report, but it can't reach your customers'
  ledgers yet. Let's connect it." Bad: "Continue to the next tutorial."
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
- On the sales site or in introductory docs, an analogy to a tool the reader may
  not run.
- An example from coding work (pull-request review, code generation).
- Filler ("it should be noted that", "it is important to understand").
- Two Diátaxis types on one page.
- A measured Stigmer-versus-Claude comparison, in a table, in prose or through a
  fixture. The harness benchmark (`make benchmark-harnesses`,
  `test/conformance`) is an internal instrument and this refusal is its rule's
  home: an Agent performs best in the harness and models built for it, so a
  generic comparison on a handful of prompts tells a reader nothing about their
  Agent, and the platform's own evaluation tooling is where they measure it. A
  page explains how the harnesses differ and never quotes a measurement between
  them.
