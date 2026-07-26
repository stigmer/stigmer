# Stigmer documentation style guide

This guide defines the writing conventions for all Stigmer documentation.
Automated enforcement is handled by Vale (`.vale.ini`) and Prettier
(`.prettierrc`). Pre-commit hooks run both tools on every commit.

## Audience

Stigmer documentation is written for **platform builders**---engineers who
integrate Stigmer into their own products. Every page should answer: _"Does a
platform builder need this to understand or integrate Stigmer?"_

Do not write for casual end users. Assume readers are comfortable with APIs,
CLIs, and infrastructure concepts.

## Domain terminology

All Stigmer term definitions, capitalization rules, and context-specific usage
guidance live in [`docs/vocabulary.md`](vocabulary.md). That file is the single
source of truth.

**Short version**: capitalize Stigmer domain terms (Agent, Skill, Workflow,
Session, etc.) when they refer to the platform concept. Lowercase when used
generically. Use the canonical forms (gRPC, ID, IDs). Vale enforces these
automatically via `vale/styles/Stigmer/terms.yml`.

See the vocabulary guide for the full term list, user-facing alternatives per
writing context, and good/bad examples.

## Headings

- Use **sentence casing**: capitalize only the first word and proper nouns.
  - _How to create an Agent_ (correct)
  - _How To Create An Agent_ (incorrect)
- Use **infinitive verb forms** for how-to titles.
  - _How to deploy a Workflow_ (correct)
  - _Deploying a Workflow_ (incorrect)
- Do not end headings with punctuation.

## Code blocks

- Always specify a language hint: ` ```go `, ` ```typescript `, ` ```yaml `,
  ` ```bash `, etc.
- Use `bash` (not `shell` or `sh`) for terminal commands.
- Prefix commands with `$` only when showing both the command and its output.
  Omit `$` for copy-pasteable command blocks.
- Keep blocks short. If a block exceeds 30 lines, break it into smaller pieces
  with explanatory prose between them.

### YAML blocks are contract-validated

Every ` ```yaml ` block in `docs/` is checked against the real proto contracts
by `make check-docs-yaml` (CI-enforced). A block must be one of:

1. **A resource manifest** — starts with `apiVersion:`/`kind:`. Validated
   automatically; no annotation needed.
2. **An authoring-form task list** — a list of `- name:`/`kind:`/`task_config:`
   entries. Validated automatically, including nested tasks and every
   `task_config` against its typed schema.
3. **An anchored fragment** — a snippet of a larger resource. Tell the gate what
   it is a fragment of via the fence info string:
   - ` ```yaml validate-as="Agent" ` — body holds top-level resource fields
     (`spec:`, `status:`, ...)
   - ` ```yaml validate-as="Workflow.spec" ` — body holds spec-level fields
     (`tasks:`, `budget:`, `env:`, ...)
   - ` ```yaml validate-as="task" ` — body holds task-level fields (`export:`,
     `flow:`, ...)
   - ` ```yaml validate-as="task-config:llm_call" ` — body holds fields of one
     task kind's config

   Absent fields are fine; unknown or misshapen fields fail the build.

4. **Explicitly skipped** — ` ```yaml no-validate="reason" `, only for blocks
   that are not resource YAML at all (e.g. frontmatter examples like the one
   below). The reason is mandatory.

Anything else fails the build. Consequences for authors: use full proto enum
names (`TRANSFORM_ENGINE_JQ`, not `jq`), never invent fields, and never use the
internal DSL form (`- task_name: { call: ... }`) — always the authoring form.
Content that is markdown-with-frontmatter (like a `SKILL.md` listing) belongs in
a ` ```md ` fence, not ` ```yaml `.

## MDX components

Custom components are available in all `.mdx` files without imports. Use them to
improve readability and structure.

### Callouts

Highlight important information with a colored sidebar and icon. Supported
types: `info`, `warn` (or `warning`), `error`, `success`.

```mdx
<Callout type="info">General information the reader should know.</Callout>
<Callout type="warn">Something the reader should be cautious about.</Callout>
<Callout type="error">A critical warning or breaking change.</Callout>
<Callout type="success">A positive outcome or confirmation.</Callout>
```

### Cards

Link card grids for navigation hubs and landing pages.

```mdx
<Cards>
  <Card href="/docs/concepts" title="Core Concepts">
    Understand Agents, Workflows, Skills, and how they fit together.
  </Card>
  <Card href="/docs/getting-started" title="Getting Started">
    Install Stigmer and run your first Agent in under five minutes.
  </Card>
</Cards>
```

### Tabs

Show alternative content (install methods, platform-specific instructions).

```mdx
<Tabs items={["npm", "yarn", "pnpm"]}>
  <Tab value="npm">npm install @stigmer/sdk</Tab>
  <Tab value="yarn">yarn add @stigmer/sdk</Tab>
  <Tab value="pnpm">pnpm add @stigmer/sdk</Tab>
</Tabs>
```

### SDK language tabs

Use `<SDKTabs>` for multi-language SDK code examples. The selected language
persists across pages.

```mdx
<SDKTabs>
  <Tab value="Go">Go code here</Tab>
  <Tab value="TypeScript">TypeScript code here</Tab>
  <Tab value="Python">Python code here</Tab>
  <Tab value="Java">Java code here</Tab>
</SDKTabs>
```

### Steps

Numbered step-by-step instructions for tutorials and how-to guides.

```mdx
<Steps>
  <Step>### Install the CLI Download and install the Stigmer CLI.</Step>
  <Step>### Create an Agent Define your first Agent.</Step>
</Steps>
```

### Term tooltips

Wrap a Stigmer domain term in `<Term>` to show its definition on hover.
Definitions come from the glossary at `site/src/components/docs/glossary.ts`.

```mdx
When you create a <Term>Workflow</Term>, you define each step.
```

### File trees

Visualize directory structures with interactive expand/collapse.

```mdx
<Files>
  <Folder name="docs" defaultOpen>
    <File name="index.mdx" />
    <Folder name="concepts">
      <File name="agents.mdx" />
    </Folder>
  </Folder>
</Files>
```

### Accordions

Collapsible sections for FAQ-style content or optional detail.

```mdx
<Accordions>
  <Accordion title="What is an Agent?">
    A reusable definition of what an AI assistant knows and can do.
  </Accordion>
</Accordions>
```

### TypeTable

Structured property tables for API reference documentation.

```mdx
<TypeTable
  type={{
    name: { type: "string", description: "Agent name.", required: true },
    model: { type: "string", description: "LLM model.", default: "gpt-4o" },
  }}
/>
```

### ImageZoom

Click-to-zoom for screenshots and diagrams.

```mdx
<ImageZoom src="/docs/screenshot.png" alt="Dashboard overview" />
```

## Prose

- Write in **second person** ("you") when addressing the reader.
- Use **active voice**. Vale enforces this via the Google style.
- Use **contractions** (you'll, it's, don't). They make prose more approachable.
- Keep sentences short. If a sentence spans more than two lines in an
  80-character-wide editor, split it.
- Use inclusive language. Vale enforces this via the `alex` package.
- Use em dashes without surrounding spaces---like this.

## File conventions

- **Extension**: `.mdx` for all rendered documentation files.
- **Naming**: lowercase with hyphens (`agent-lifecycle.mdx`, not
  `AgentLifecycle.mdx`).
- **Front matter**: every file must have `title` and `description`.

```yaml no-validate="docs-page frontmatter example, not resource YAML"
---
title: How to create an Agent
description: Step-by-step guide to defining and running your first Agent.
---
```

## Formatting

- Prettier autoformats on commit. Configuration is in `.prettierrc`:
  - 80-character line width
  - 2-space indentation
  - Prose wrapping at word boundaries (`proseWrap: always`)
- Use **bold** for UI elements and key concepts on first mention.
- Use `code` formatting for CLI commands, file paths, config keys, and API
  fields.
- Use tables to compare options or list parameters.
- Use Mermaid diagrams for architecture, data flows, and state machines.

## Diagrams

Fenced ` ```mermaid ` code blocks render as interactive diagrams (client-side
via Mermaid.js). They automatically switch between light and dark themes. Prefer
diagrams over lengthy textual descriptions of architecture or data flow.

````mdx
```mermaid
flowchart TB
    A[Submit Workflow] --> B{Validate spec}
    B -->|Valid| C[Create instance]
    B -->|Invalid| D[Return error]
```
````

Supported diagram types include `flowchart`, `sequenceDiagram`,
`stateDiagram-v2`, `classDiagram`, `erDiagram`, and `gantt`. See the
[Mermaid documentation](https://mermaid.js.org/) for full syntax.

## Links

- Use relative paths for internal links: `[Agents](../concepts/agents.mdx)`.
- Use descriptive link text. Avoid "click here" or bare URLs.
- The `check-links` Make target validates all links before CI.

## LLM-friendly output

The build pipeline generates files that let LLM agents and AI tools consume
Stigmer documentation as plain text, following the
[llms.txt standard](https://llmstxt.org).

### Generated files

| File                | Address                     | Purpose                                           |
| ------------------- | --------------------------- | ------------------------------------------------- |
| `out/llms.txt`      | `stigmer.ai/llms.txt`       | Curated index with section links and descriptions |
| `out/llms-full.txt` | `stigmer.ai/llms-full.txt`  | All documentation concatenated into one file      |
| `out/docs/**/*.md`  | `stigmer.ai/docs/{path}.md` | Per-page markdown variant of each doc page        |

### How it works

The script `site/scripts/generate-llms-txt.ts` runs automatically after
`next build`. It reads all `.mdx` files from `docs/`, strips frontmatter and
import statements, and writes cleaned markdown to `out/`. Page ordering follows
the `meta.json` files. Individual CLI command pages and the contributing section
are placed in an "Optional" section in `llms.txt`.

### Commands

- `make docs-build` --- runs the full build including LLM output
- `make gen-llms` --- regenerates LLM output from an existing `out/` directory
- `cd site && yarn generate-llms` --- same as above from the site directory

### Copy as Markdown button

Every docs page includes a "Copy as Markdown" button next to the title. It
fetches the `.md` variant of the current page and copies the content to the
clipboard so users can share documentation context with AI tools.

## What not to do

- Do not add comments that narrate what the code does ("Import the module").
- Do not duplicate content. Link to the authoritative page instead.
- Do not write speculative documentation. Every statement must be grounded in
  the current implementation.
- Do not use emoji in headings or as bullet markers.
