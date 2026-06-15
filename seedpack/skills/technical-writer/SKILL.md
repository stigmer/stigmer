---
name: technical-writer
visibility: public
description: >
  Write and improve technical documentation including API references, user guides,
  tutorials, how-to guides, and explanatory articles. Use this skill when asked to
  document a feature, write a tutorial, create API documentation, improve existing
  docs, write a README, explain a technical concept for a specific audience, or
  produce any developer-facing or user-facing written content. Triggers on requests
  like: "document this API", "write a tutorial for X", "improve these docs",
  "write a README for this project", "explain how this works", or "create a
  getting started guide".
---

# Technical Writer

Produce technical documentation that is accurate, audience-appropriate, and
structured for the reader's goal. This skill teaches a five-step methodology:
classify, gather, structure, write, review. The methodology applies to any
technical document — from a two-paragraph README to a full API reference.

## Workflow

Follow these steps in order for every documentation task.

### Step 1: Classify the Document

Before writing anything, determine two things: who is the reader, and what type
of document are they reading.

**Audience** — determines vocabulary, assumed knowledge, and level of detail:

- **End user**: Knows the product, not the internals. Uses plain language and
  outcome-focused framing. "Click Settings to change your notification preferences"
  rather than "The settings endpoint accepts a PATCH request with..."
- **Developer (consumer)**: Uses your API, SDK, or library. Expects precision:
  exact method names, parameter types, code examples. Tolerates technical language
  within their stack.
- **Developer (contributor)**: Works on the codebase. Expects architectural context,
  design rationale, and pointers to relevant source files. Jargon is appropriate
  when it matches the codebase vocabulary.
- **Decision-maker**: Evaluates whether to adopt. Needs capabilities, tradeoffs,
  and comparisons — not implementation details.

**Document type** — determines structure and tone. Every document is one of four
types. Do not mix them.

| Type | Reader's goal | Tone | Structure |
|------|--------------|------|-----------|
| **Tutorial** | Learn by doing | "Follow along with me" | Step-by-step, builds to a working result |
| **How-to guide** | Solve a specific problem | "Here is how to do X" | Numbered steps, assumes basic knowledge |
| **Explanation** | Understand a concept | "Here is why this works this way" | Narrative, connects ideas, explores tradeoffs |
| **Reference** | Look up a fact | "Here is the complete specification" | Structured tables, exhaustive, no narrative |

If you find yourself explaining "why" inside a how-to, or providing step-by-step
instructions inside a reference, you are mixing types. Extract the misplaced content
into its own document and link to it.

Read [references/document-types.md](references/document-types.md) for detailed
structural templates and common mistakes for each type.

### Step 2: Gather Technical Substance

Documentation accuracy is non-negotiable. Every claim must be verifiable against
the source of truth — code, API specifications, or observable behavior.

1. **Read the code or API specification first**, not just comments or existing docs.
   Comments drift. Docs go stale. The implementation is the ground truth. If you
   have access to source code, read the relevant functions, types, and interfaces
   before writing about them.

2. **Run the thing you're documenting** if possible. Execute the API call. Run the
   CLI command. Use the feature. Documentation written from reading code alone
   misses runtime behavior, default values, error messages, and timing.

3. **Identify the critical details** that a reader cannot afford to get wrong:
   required vs. optional parameters, default values, units (seconds vs.
   milliseconds), destructive operations, and irreversible actions. These must be
   stated explicitly, never implied.

4. **Note what you're uncertain about.** If you cannot verify a claim, flag it
   rather than guessing. "[Verify: does this endpoint require authentication?]" is
   better than a confidently wrong statement that misleads a reader in production.

### Step 3: Structure the Document

Structure depends on the document type identified in Step 1. Regardless of type,
follow these structural principles:

**Lead with what the reader needs most.** The first paragraph should answer:
what is this, and why should the reader care? Do not open with history, background,
or organizational context. A developer reading API docs needs to know what the
endpoint does, not which team built it.

**Use headings as a scannable outline.** A reader who skims only the headings
should understand the document's scope and find the section they need. Heading
text should be specific: "Configure database credentials" rather than "Configuration."

**One idea per section.** If a section covers two distinct topics, split it.
Sections that do too much force the reader to parse and filter.

**Progressive disclosure.** Put the most common use case first, edge cases and
advanced options later. A reader who needs the simple path should reach it without
scrolling past the complex one.

**Use lists for three or more items.** Never bury a sequence of steps inside a
paragraph.

**Use code examples as proof.** A single working example is more convincing and
more useful than three paragraphs of description. Every tutorial step and every
API method in a reference should have a concrete example.

### Step 4: Write with Clarity

Apply these rules to every sentence. They are not stylistic preferences — they
are communication discipline.

1. **Use common words.** "Use" not "utilize." "Start" not "initialize." "Set up"
   not "provision." Technical terms are fine when they are the actual term (API,
   endpoint, schema) — jargon is the problem when a plain word would be more
   precise.

2. **Write short sentences.** One idea per sentence. If a sentence has a comma
   followed by another complete thought, split it into two sentences.

3. **Use active voice.** "The server returns a 404 error" rather than "A 404
   error is returned by the server." Active voice makes clear who does what.

4. **Put the action first.** "Run `npm install` to install dependencies" rather
   than "To install dependencies, run `npm install`." The reader came here to
   do something — lead with the thing they do.

5. **Show, don't describe.** If you can demonstrate a concept with a code example
   or a concrete scenario, do that instead of describing it abstractly. "The
   `--dry-run` flag prints what would happen without making changes" accompanied by
   actual `--dry-run` output teaches more than a paragraph explaining the concept
   of dry runs.

6. **Eliminate filler.** Cut phrases that add no information: "It should be noted
   that", "It is important to understand", "Basically", "As previously mentioned."
   If a sentence works without these phrases, remove them.

7. **Be precise about quantities and behavior.** "The request may take several
   seconds" is vague. "The request typically completes in 2-5 seconds; timeout is
   30 seconds" is actionable.

Read [references/clarity-checklist.md](references/clarity-checklist.md) for the
full writing quality checklist.

### Step 5: Self-Review

Before delivering, review the document against these criteria:

**Accuracy check:**
- Every technical claim is verified against code, API spec, or direct observation
- All code examples work as written (or are clearly marked as pseudocode)
- Version numbers, URLs, and command syntax are current
- Default values and required/optional distinctions are correct

**Audience check:**
- The vocabulary matches the target audience identified in Step 1
- Background knowledge assumptions are appropriate (a tutorial doesn't assume
  expertise; a reference doesn't over-explain basics)
- The document type is consistent throughout (no tutorial drifting into reference)

**Completeness check:**
- A reader following the document from top to bottom has everything they need
  to accomplish their goal
- No critical details are omitted (authentication requirements, prerequisites,
  error handling)
- Next steps or related documents are linked where relevant

**Readability check:**
- Headings form a scannable outline of the content
- No wall-of-text paragraphs (break anything longer than 4-5 sentences)
- Code examples are included where they would aid understanding
- Lists are used for sequences and collections, not buried in prose

## Key Principles

1. **Accuracy over polish.** A clearly written document with a factual error is worse than a rough document that is correct. Verify every technical claim. When uncertain, flag it — do not guess.

2. **One document, one type.** Tutorials teach by doing. References provide facts. How-tos solve problems. Explanations build understanding. Mixing them within a single document serves no audience well. When content doesn't fit the document type, extract it and link to it.

3. **The reader's time is more valuable than yours.** Cut everything that doesn't serve the reader's goal. A shorter, focused document that answers the question is better than a comprehensive one the reader has to search through.

4. **Examples are not optional.** Every concept that can be demonstrated with code, a command, or a concrete scenario must be. Abstractions without examples are theory — documentation should be practical.

5. **Write for scanning first, reading second.** Most readers scan headings, look at code blocks, and read the first sentence of each section. Your document should be useful even at that level of engagement. Details reward the reader who goes deeper but shouldn't be required for the reader who just needs the answer.

6. **Don't document the obvious, do document the surprising.** Readers don't need a comment that says "this function returns a string" if the type signature says so. They need to know that the string might be empty, or that it includes a trailing newline, or that it's base64-encoded. Document the things that would trip someone up.

## Reference Files

| File | When to Read |
|------|-------------|
| [references/document-types.md](references/document-types.md) | When you need the structural template, tone guide, or common mistake list for a specific document type (tutorial, how-to, explanation, or reference) |
| [references/clarity-checklist.md](references/clarity-checklist.md) | During self-review, for the full writing quality checklist covering sentence structure, jargon, examples, and visual hierarchy |
