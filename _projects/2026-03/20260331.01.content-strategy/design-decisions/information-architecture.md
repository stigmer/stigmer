# Information architecture

This document defines the structural blueprint for stigmer.ai — every page,
how pages are organized, and how readers move through them. It is the source
of truth for Phase 2 (sales site) and Phases 3–7 (documentation) of the
content strategy project.

**Status**: superseded — the live `docs/**/meta.json` files are the source of truth for navigation structure. This document preserves the original planning rationale but no longer reflects the current site.
**Created**: 2026-03-31
**Depends on**: [Positioning document](positioning.md), [Vocabulary guide](../../../../docs/vocabulary.md), [Demo story narrative](demo-story.md), [Use case library](use-cases.md)
**Scope**: Page inventory, navigation structure, sidebar hierarchy, CTA
mapping, and learning paths. Does not cover visual design, component
implementation, or individual page content (later phases).

## How to use this document

- **Building the sales site (Phase 2)?** Section 2 defines the navigation and
  homepage section order. Section 4 maps every CTA to its target docs page.
- **Creating docs content (Phases 3–7)?** Section 3 defines the directory
  structure, page inventory, and sidebar ordering. Follow it to know where new
  files go and how they appear in the sidebar.
- **Planning a sprint?** Section 1 maps every page to the phase that builds it.
- **Designing the reader journey?** Section 5 defines named learning paths
  through the docs.
- **Updating CONTRIBUTING.md or the document writer role?** Section 6 lists
  the specific changes needed to keep those files aligned.

---

## Organizing principles

Five principles govern every structural decision in this document. When a
choice is ambiguous, these break the tie.

### 1. Journey-then-topic sidebar

The docs sidebar is organized by how readers progress, not by content type.

- **Top**: Journey sections that guide new readers (Getting Started, Concepts).
- **Middle**: Progressive tutorials that build capability step by step.
- **Bottom**: Reference and integration sections where experienced readers look
  things up (SDKs, CLI, API Reference).

Within each section, pages are ordered by the sequence a reader would
naturally follow — not alphabetically and not by importance.

### 2. Per-page content types

Every documentation page is exactly one of four types. Types are never mixed
on the same page. This is a writing quality rule, not a navigation rule — the
sidebar does not expose these types to the reader.

| Type | Purpose | Test |
|------|---------|------|
| Tutorial | Teach by doing. Walk the reader through a complete task. | "Can I follow this from start to finish without prior Stigmer knowledge?" |
| How-to | Solve a specific problem. Assume the reader knows the basics. | "Does this assume I've done the quickstart?" |
| Explanation | Build understanding. Explain why something works this way. | "Does this answer 'why' without requiring me to do anything?" |
| Reference | Provide facts. List every option, field, or command. | "Can I find any specific detail without reading surrounding prose?" |

### 3. Cloud-primary entry

The first path shown to every reader is the cloud path: sign up, get an API
key, build an agent. The local path (brew install, stigmer server)
appears second. This follows the positioning document's Decision 3.

### 4. Progressive disclosure

The reader discovers capabilities in layers, matching the positioning
document's three messaging pillars:

1. Domain knowledge (Skills) — the "aha moment" in 5 minutes
2. Tool access (MCP Servers) — agents that act, not just talk
3. Approval flows — human oversight built in

Each layer builds on the previous one. The docs structure mirrors this
progression: the quickstart creates a working agent, the first Skill
tutorial delivers layer 1 (the "aha moment"), and the tutorials section
adds layers 2–4 (tools, approvals, workflows).

### 5. Vocabulary register per context

The sales site and docs use different language registers. Page titles, nav
labels, and CTAs follow the vocabulary guide's context rules:

- **Sales site nav and CTAs**: business-outcome language (e.g., "Use Cases"
  not "Use Case Library," "Docs" not "Documentation")
- **Docs sidebar titles**: Stigmer proper nouns (e.g., "Skills," "Agents,"
  "Workflows")
- **Docs page titles**: reader-friendly with Stigmer terms (e.g., "What is
  Stigmer?" not "Platform Overview")

---

## 1. Site map

Every URL on stigmer.ai, grouped by area.

### Marketing pages

| URL | Purpose | Phase |
|-----|---------|-------|
| `/` | Homepage — positioning, demo story, capabilities, use cases, CTAs | Phase 2 |
| `/use-cases` | Expanded use case stories from the use case library | Phase 2 |
| `/pricing` | Pricing tiers (Free / Pro / Enterprise placeholder) | Phase 2 |

### Documentation pages

| URL | Purpose | Phase | Content type |
|-----|---------|-------|-------------|
| `/docs` | Docs landing — orientation hub routing readers to the right starting point | Phase 3 |  — |
| `/docs/getting-started/quickstart` | Cloud quickstart: sign up, API key, install SDK, create session, send message — 5 minutes. Uses the implicit assistant agent. | Phase 3 | Tutorial |
| `/docs/getting-started/local` | Local quickstart: brew install, stigmer server, apply, run | Phase 3 | Tutorial |
| `/docs/getting-started/first-skill` | Upload domain knowledge, see generic vs. expert answers | Phase 3 | Tutorial |
| `/docs/concepts/what-is-stigmer` | What Stigmer is, who it's for, what makes it different | Phase 4 | Explanation |
| `/docs/concepts/agents` | What an Agent is, how to define one, how it runs | Phase 4 | Explanation |
| `/docs/concepts/skills` | How domain knowledge works — Skills as versioned knowledge artifacts | Phase 4 | Explanation |
| `/docs/concepts/tools` | How agents interact with external systems via MCP Servers | Phase 4 | Explanation |
| `/docs/concepts/approval-flows` | How human oversight works — tool approvals and workflow approvals | Phase 4 | Explanation |
| `/docs/concepts/sessions` | How agents remember conversations across interactions | Phase 4 | Explanation |
| `/docs/concepts/workflows` | How multi-step automations work — Workflows, Instances, Executions | Phase 4 | Explanation |
| `/docs/concepts/environments` | Environments, secrets, and configuration management | Phase 4 | Explanation |
| `/docs/concepts/organizations` | Organizations, Projects, and multi-tenant structure | Phase 4 | Explanation |
| `/docs/tutorials/give-your-agent-tools` | Add an MCP server so the agent can query and act on data | Phase 6 | Tutorial |
| `/docs/tutorials/add-approval-flows` | Configure which actions need human approval before proceeding | Phase 6 | Tutorial |
| `/docs/tutorials/build-a-workflow` | Chain steps: check, decide, act, report — with crash recovery | Phase 6 | Tutorial |
| `/docs/tutorials/connect-your-systems` | Replace the sample MCP server with real integrations | Phase 6 | Tutorial |
| `/docs/sdks/typescript` | TypeScript SDK installation, authentication, agent calls, examples | Phase 7 | How-to |
| `/docs/sdks/go` | Go SDK guide | Phase 7 | How-to |
| `/docs/sdks/python` | Python SDK guide | Phase 7 | How-to |
| `/docs/sdks/java` | Java SDK guide | Phase 7 | How-to |
| `/docs/cli/overview` | CLI installation, configuration, and common usage patterns | Phase 7 | How-to |
| `/docs/cli/commands/*` | Individual CLI command reference pages (auto-generated by gen-cli-docs) | Phase 7 | Reference |
| `/docs/reference/api` | gRPC API reference — services, RPCs, message types | Phase 7 | Reference |

### Future expansion (not in current scope)

These sections are expected needs but are not defined in any T01 phase. They
are listed here so the IA anticipates them without committing to content.

| Section | Purpose | Trigger |
|---------|---------|---------|
| Self-hosting | Production deployment, scaling, backup, monitoring | When users deploy to production beyond local dev |
| Architecture | System internals — Agent Runner, Workflow Runner, Temporal, resource lifecycle | When contributor or advanced-user demand warrants it |
| Contributing | Open-source contribution guide (code, docs, community) | When contribution volume justifies a docs-site section beyond the repo CONTRIBUTING.md |

---

## 2. Sales site navigation and page structure

### Top navigation

```
Logo  |  Use Cases  |  Docs  |  Pricing  |  GitHub  |  Sign In  |  [Start Free]
```

| Item | Type | Target |
|------|------|--------|
| Logo | Link | `/` (homepage) |
| Use Cases | Link | `/use-cases` |
| Docs | Link | `/docs` |
| Pricing | Link | `/pricing` |
| GitHub | External link | `https://github.com/stigmer/stigmer` |
| Sign In | External link | Stigmer Cloud sign-in URL |
| Start Free | Primary CTA button | Stigmer Cloud sign-up URL |

**Changes from current** (`constants.ts`): adds Use Cases, Pricing, Sign In,
and Start Free. Removes nothing — Docs and GitHub already exist.

### Homepage sections

The homepage is a vertical scroll through eight sections. Each maps to a
strategic purpose from the positioning document.

| # | Section | Purpose | Primary source |
|---|---------|---------|---------------|
| 1 | **Hero** | Headline + sub-headline + primary CTA (Start Free) + trust badges (Open Source, Apache 2.0) | Positioning doc, Section 6 (headlines) |
| 2 | **Demo Story** | Before/after narrative proving the headline claim through a concrete e-commerce scenario | Demo story narrative (primary story) |
| 3 | **Three Capabilities** | The three messaging pillars as visual blocks: Knows Your Business / Uses Your Tools / Asks Before Acting | Positioning doc, Section 3 (pillars) |
| 4 | **How It Works** | Three high-level steps: Teach → Connect → Deploy. Bridges narrative to action. | Positioning doc, Pillar progression |
| 5 | **What You Can Build** | Use case cards from the use case library — Healthcare, HR, FinTech, Education, Legal | Use case library (Phase 2 notes) |
| 6 | **Why It Works** | Technical credibility for the curious: durable execution, sandboxed tools, real API contracts, open source | Positioning doc, Foundation pillar |
| 7 | **Open Source** | Apache 2.0, public contracts, self-host option, GitHub star count | Positioning doc, Decision 3 |
| 8 | **Final CTA** | "Start free" + SDK install snippets per language (TypeScript primary) | Positioning doc, Decision 3 |

**Design note**: Section 2 (Demo Story) is new — no existing component. All
other sections have component shells from the previous site that can be
rewritten. `Architecture.tsx` is not rendered but its code patterns (code
toggle, comparison grid) may be useful for Section 6 (Why It Works).

### Marketing pages

#### `/use-cases`

Expanded versions of the five use case stories from the use case library.
Each includes:

- Industry context and builder persona
- The challenge (what the founder tried before Stigmer)
- How Stigmer powers it (capabilities mapped to pillars)
- A proof interaction (concrete agent conversation)
- The outcome

Links back to relevant docs: quickstart, tutorials, relevant concept pages.

#### `/pricing`

Placeholder page with three tiers: Free, Pro, Enterprise. Tier details are
not defined in the content strategy project — this page exists to complete the
navigation and set expectations.

### Footer

| Column | Items |
|--------|-------|
| **Product** | Use Cases, Pricing, Documentation |
| **Developers** | Getting Started, Tutorials, API Reference |
| **Open Source** | GitHub, Contributing, Apache 2.0 License |

**Changes from current** (`constants.ts` FOOTER_LINKS): replaces the current
two-column layout (Product, Community) with three columns that reflect the
positioning's dual audience (founders in Product, developers in Developers)
plus the open-source trust signal.

---

## 3. Docs navigation tree

### Directory structure

This replaces the 9-directory layout in `docs/CONTRIBUTING.md`. The new
structure has 6 content directories organized by reader journey — getting
started and concepts at the top, progressive tutorials in the middle,
integration and reference at the bottom.

```
docs/
├── index.mdx                              # Docs landing page
├── meta.json                              # Root sidebar ordering
├── getting-started/
│   ├── meta.json
│   ├── quickstart.mdx                     # Cloud quickstart (5 min)
│   ├── local.mdx                          # Local quickstart
│   └── first-skill.mdx                    # Your first Skill
├── concepts/
│   ├── meta.json
│   ├── what-is-stigmer.mdx                # What Stigmer is and who it's for
│   ├── agents.mdx                         # Agents — the core resource
│   ├── skills.mdx                         # Skills — domain knowledge
│   ├── tools.mdx                          # Tool access via MCP Servers
│   ├── approval-flows.mdx                 # Human oversight and approvals
│   ├── sessions.mdx                       # Conversations and memory
│   ├── workflows.mdx                      # Multi-step automations
│   ├── environments.mdx                   # Environments and secrets
│   └── organizations.mdx                  # Organizations, Projects, tenancy
├── tutorials/
│   ├── meta.json
│   ├── give-your-agent-tools.mdx          # Tutorial 1: add MCP server
│   ├── add-approval-flows.mdx             # Tutorial 2: human oversight
│   ├── build-a-workflow.mdx               # Tutorial 3: multi-step automation
│   └── connect-your-systems.mdx           # Tutorial 4: real integrations
├── sdks/
│   ├── meta.json
│   ├── typescript.mdx                     # TypeScript SDK (primary)
│   ├── go.mdx                             # Go SDK
│   ├── python.mdx                         # Python SDK
│   └── java.mdx                           # Java SDK
├── cli/
│   ├── meta.json
│   ├── overview.mdx                       # CLI installation and usage
│   └── commands/                           # Auto-generated command pages
│       ├── meta.json
│       └── *.mdx                          # One page per CLI command
└── reference/
    ├── meta.json
    └── api.mdx                            # gRPC API reference
```

Non-rendered files that remain in `docs/` but are excluded from the sidebar:

- `vocabulary.md` — internal terminology reference (`.md`, not `.mdx`)
- `STYLE.md` — writing conventions for contributors
- `CONTRIBUTING.md` — contribution guide
- `README.md` — repo documentation readme

### Docs landing page (`docs/index.mdx`)

The landing page is a routing hub. It uses the `Cards` component to direct
readers based on intent:

| Card | Title | Description | Target |
|------|-------|-------------|--------|
| 1 | Getting Started | Build your first agent in 5 minutes. | `/docs/getting-started/quickstart` |
| 2 | Core Concepts | Understand Agents, Skills, Workflows, and how they fit together. | `/docs/concepts/what-is-stigmer` |
| 3 | Tutorials | Add tools, approval flows, and workflows to your agent step by step. | `/docs/tutorials/give-your-agent-tools` |
| 4 | SDK Reference | Install an SDK and call agents from your application. | `/docs/sdks/typescript` |

The page also includes a one-paragraph orientation:

> Stigmer is an open-source AI agent platform. These docs cover everything
> from creating your first agent to running agents in production. Start with
> the quickstart if you're new, or jump to any section.

### Section details

#### Getting Started

The entry point for all new readers. Three tutorials that progressively
introduce Stigmer, following the positioning's progressive disclosure model.

| Page | Sidebar title | Content type | Description |
|------|--------------|-------------|-------------|
| `quickstart.mdx` | Cloud quickstart | Tutorial | Sign up for Stigmer Cloud, get an API key, install the SDK, create a session, send a message, see the response. Uses the implicit assistant agent — no agent creation needed. Skill creation is deferred to first-skill.mdx. Target: 5 minutes, zero prior context. |
| `local.mdx` | Local quickstart | Tutorial | Install the CLI, start the server, write an Agent YAML file, apply and run. Target: 5 minutes for developers who prefer local-first. |
| `first-skill.mdx` | Your first Skill | Tutorial | Create a Skill (domain knowledge), attach it to an Agent, run the same prompt, see the difference between generic and expert responses. Pillar 1 proof. |

**Page ordering rationale**: Cloud first (positioning Decision 3), local
second (trust signal), then first Skill (the "aha moment" from the
positioning document).

**Prerequisite**: `quickstart.mdx` or `local.mdx` before
`first-skill.mdx`. The Skill tutorial assumes a working agent already exists.

#### Concepts

Explanation pages that build understanding of every core Stigmer concept.
Ordered by the progression a builder experiences: what is this → core
resource → knowledge → tools → oversight → memory → automation → platform
structure.

| Page | Sidebar title | Content type | Description |
|------|--------------|-------------|-------------|
| `what-is-stigmer.mdx` | What is Stigmer? | Explanation | What Stigmer is, who it's for, how it differs from direct LLM calls / RAG / agent frameworks / workflow tools. Draws from positioning Sections 2, 4, 5. |
| `agents.mdx` | Agents | Explanation | What an Agent is (blueprint vs. runtime), how to define one in YAML, Agent → AgentInstance → Session → AgentExecution lifecycle. |
| `skills.mdx` | Skills | Explanation | What a Skill is (versioned knowledge artifact), directory structure, SKILL.md format, how Skills attach to Agents, before/after demonstration. |
| `tools.mdx` | Tools | Explanation | How agents interact with external systems. MCP protocol, MCP Server resource, tool discovery, input validation, execution sandboxing. |
| `approval-flows.mdx` | Approval flows | Explanation | How human oversight works. Tool-call approvals (ToolApprovalPolicy) and workflow-task approvals (WORKFLOW_TASK_APPROVAL) — documented as two distinct mechanisms per vocabulary guide inconsistency #6. |
| `sessions.mdx` | Sessions | Explanation | How conversations persist across interactions. Session resource, thread persistence, message history, session-level overrides for Skills and tools. |
| `workflows.mdx` | Workflows | Explanation | How multi-step automations work. Workflow → WorkflowInstance → WorkflowExecution pattern, task kinds, CNCF Serverless Workflow DSL (reference-only mention). |
| `environments.mdx` | Environments | Explanation | Environments, secrets, and variables. How the same Agent runs with different configurations across dev/staging/production. |
| `organizations.mdx` | Organizations | Explanation | Organizations, Projects, and multi-tenant structure. How Stigmer Cloud organizes resources. Note: local mode uses an implicit single-user context. |

**Page ordering rationale**: Follows the messaging pillar progression
(knowledge → tools → approvals) then expands to supporting concepts (memory,
automation, configuration, tenancy). A reader working through these pages in
order builds a complete mental model.

#### Tutorials

Four progressive tutorials that build on the quickstart agent. Each adds one
capability. The tutorials use the sample reference application from Phase 5
(`examples/`) as backing material.

| Page | Sidebar title | Content type | Description |
|------|--------------|-------------|-------------|
| `give-your-agent-tools.mdx` | Give your agent tools | Tutorial | Add a sample MCP server, agent can now query data and take actions. Pillar 2 proof. |
| `add-approval-flows.mdx` | Add approval flows | Tutorial | Configure tool approval policies, agent pauses for human review on sensitive actions. Pillar 3 proof. |
| `build-a-workflow.mdx` | Build a workflow | Tutorial | Create a multi-step Workflow: check → decide → act → report. Foundation pillar proof. |
| `connect-your-systems.mdx` | Connect your systems | Tutorial | Replace the sample MCP server with real integrations. Transition from tutorial to production. |

**Page ordering rationale**: Mirrors the positioning's progressive disclosure
and the demo story's three-act structure. Each tutorial adds one layer of
capability. The final tutorial bridges tutorials to real-world usage.

**Prerequisite chain**: quickstart → first-skill → tools → approvals →
workflow → real systems. Each tutorial assumes the previous one is complete.

#### SDKs

Per-language integration guides. Each covers installation, authentication,
creating an agent, running executions, and handling responses.

| Page | Sidebar title | Content type | Description |
|------|--------------|-------------|-------------|
| `typescript.mdx` | TypeScript | How-to | Primary SDK. Matches the cloud-first positioning (npm install, API key). |
| `go.mdx` | Go | How-to | Go SDK guide. |
| `python.mdx` | Python | How-to | Python SDK guide. |
| `java.mdx` | Java | How-to | Java SDK guide. |

**Page ordering rationale**: TypeScript first (cloud-primary, most common for
web platform builders), then Go (Stigmer's own language), Python, Java.

#### CLI

CLI installation, usage patterns, and auto-generated command reference.

| Page | Sidebar title | Content type | Description |
|------|--------------|-------------|-------------|
| `overview.mdx` | Overview | How-to | CLI installation, global flags, configuration, common usage patterns. |
| `commands/*.mdx` | (per command) | Reference | One page per CLI command, auto-generated by `gen-cli-docs`. Fields: usage, flags, examples. |

**Note**: The `commands/` subdirectory and its `meta.json` are managed by the
`gen-cli-docs` tool. The IA defines the parent structure; command page
ordering is determined by the generator.

#### Reference

API reference material for developers integrating Stigmer programmatically.

| Page | Sidebar title | Content type | Description |
|------|--------------|-------------|-------------|
| `api.mdx` | API reference | Reference | gRPC services, RPCs, request/response messages, error codes. Sourced from public protobuf contracts under `apis/ai/stigmer/`. |

**Future growth**: As the API surface expands, this section grows with
additional reference pages (configuration reference, YAML field reference,
webhook reference, etc.).

### `meta.json` plan

Concrete `meta.json` contents for each directory, defining sidebar ordering
in Fumadocs.

**`docs/meta.json`** (root):

```json
{
  "pages": [
    "getting-started",
    "---Learn---",
    "concepts",
    "tutorials",
    "---Integrate---",
    "sdks",
    "cli",
    "reference"
  ]
}
```

The `---Label---` entries are Fumadocs separator items that create visual
grouping in the sidebar without being clickable links. Two labeled groups:
"Learn" (understanding + building) and "Integrate" (connecting to your app).
The "Getting started" folder appears first without a separator — its folder
title is self-explanatory and a separator above it would be redundant.

**`docs/getting-started/meta.json`**:

```json
{
  "title": "Getting started",
  "pages": ["quickstart", "local", "first-skill"]
}
```

**`docs/concepts/meta.json`**:

```json
{
  "title": "Concepts",
  "pages": [
    "what-is-stigmer",
    "agents",
    "skills",
    "tools",
    "approval-flows",
    "sessions",
    "workflows",
    "environments",
    "organizations"
  ]
}
```

**`docs/tutorials/meta.json`**:

```json
{
  "title": "Tutorials",
  "pages": [
    "give-your-agent-tools",
    "add-approval-flows",
    "build-a-workflow",
    "connect-your-systems"
  ]
}
```

**`docs/sdks/meta.json`**:

```json
{
  "title": "SDKs",
  "pages": ["typescript", "go", "python", "java"]
}
```

**`docs/cli/meta.json`**:

```json
{
  "title": "CLI",
  "pages": ["overview", "commands"]
}
```

**`docs/cli/commands/meta.json`**:

```json
{
  "title": "Commands"
}
```

The `commands` meta.json omits the `pages` array — command pages are
auto-generated and their ordering is managed by `gen-cli-docs`. Fumadocs
sorts unlisted pages alphabetically.

**`docs/reference/meta.json`**:

```json
{
  "title": "Reference",
  "pages": ["api"]
}
```

---

## 4. CTA-to-docs mapping

Every call-to-action on the sales site that points into docs, mapped to its
target page. This ensures no CTA leads to a dead end and every entry point
provides appropriate context.

### Homepage CTAs

| Source section | CTA text (indicative) | Target | Notes |
|---------------|----------------------|--------|-------|
| Hero | "Get Started" / "Read the Docs" | `/docs/getting-started/quickstart` | Primary docs entry point |
| Hero | "Start Free" | Stigmer Cloud sign-up | External, not a docs link |
| Hero | GitHub badge | `github.com/stigmer/stigmer` | External |
| Demo Story | (implicit) "Try it yourself" | `/docs/getting-started/quickstart` | After the narrative, route to action |
| Three Capabilities | "Teach your agent" | `/docs/getting-started/first-skill` | Pillar 1 → first Skill tutorial |
| Three Capabilities | "Connect your tools" | `/docs/tutorials/give-your-agent-tools` | Pillar 2 → tools tutorial |
| Three Capabilities | "Set your rules" | `/docs/tutorials/add-approval-flows` | Pillar 3 → approval tutorial |
| How It Works | "Get Started" | `/docs/getting-started/quickstart` | Reinforcement CTA |
| What You Can Build | (per card) "Learn more" | `/use-cases` | Routes to marketing, not docs |
| Why It Works | "Read the docs" | `/docs/concepts/what-is-stigmer` | Technical-curious readers → concepts |
| Why It Works | "View on GitHub" | `github.com/stigmer/stigmer` | External |
| Open Source | "Run locally" | `/docs/getting-started/local` | Local quickstart |
| Open Source | "View source" | `github.com/stigmer/stigmer` | External |
| Final CTA | "Start Free" | Stigmer Cloud sign-up | External |
| Final CTA | SDK install snippet | `/docs/sdks/typescript` | Language-specific SDK page |

### Navigation CTAs

| Source | Target | Notes |
|--------|--------|-------|
| Top nav "Docs" | `/docs` | Docs landing page (routing hub) |
| Top nav "Use Cases" | `/use-cases` | Marketing page |
| Footer "Getting Started" | `/docs/getting-started/quickstart` | Direct to cloud quickstart |
| Footer "Tutorials" | `/docs/tutorials/give-your-agent-tools` | First tutorial |
| Footer "API Reference" | `/docs/reference/api` | gRPC API reference |

### Validation rule

Before Phase 2 launches, every target URL in this table must resolve to a
published page. If a docs page is not yet written (e.g., Phase 6 tutorials),
the CTA should either link to the docs landing page with context or be hidden
until the target page exists.

---

## 5. Progressive learning paths

Named paths through the docs, defined by reader intent and time budget. Each
path is a sequence of pages with estimated time.

**Path quality requirement**: every page in a learning path must bridge to the
next. The closing section names the functional gap that motivates the next
page — what the reader cannot do yet and what the next page will teach them.
This aligns with the narrative continuity and page bridging principles in the
[document writer role](../../../../_roles/002_document_writer.md).

### Entry points

Readers arrive from three places:

| Entry | Likely intent | First page |
|-------|--------------|------------|
| Sales site "Get Started" CTA | Try Stigmer quickly | `/docs/getting-started/quickstart` |
| Sales site "Docs" nav link | Browse / evaluate | `/docs` (landing page) |
| GitHub README "Documentation" link | Evaluate or integrate | `/docs` (landing page) |
| Direct link (shared by teammate, search) | Specific topic | The linked page directly |

### The 5-minute path

**Reader**: "I want to see if this works."

```
Cloud quickstart (5 min)
└── Result: a running agent that answers generic questions
```

One page. The reader signs up, installs the SDK, creates an agent, and runs
it. This is the minimum viable demonstration that Stigmer works.

**Next step prompt** (at the bottom of the quickstart page): "Your agent
gives generic answers. Want to make it an expert? → Your first Skill"

### The 15-minute path

**Reader**: "Show me the value."

```
Cloud quickstart (5 min)
└── Your first Skill (10 min)
    └── Result: an agent that answers with domain expertise
```

Two pages. The reader adds a Skill and sees the before/after difference. This
is the "aha moment" described in the positioning document — the point where
generic AI becomes a domain expert.

**Next step prompt**: "Your agent knows your domain. Want it to take actions
too? → Give your agent tools"

### The 30-minute path

**Reader**: "I want to build something real."

```
Cloud quickstart (5 min)
└── Your first Skill (10 min)
    └── Give your agent tools (15 min)
        └── Result: an agent that knows your domain and can act
```

Three pages. The reader adds tool access and sees the agent query data and
take actions. This demonstrates Pillars 1 and 2.

**Next step prompt**: "Your agent can act. Want to add human oversight? →
Add approval flows"

### The full build path

**Reader**: "I want the complete picture."

```
Cloud quickstart (5 min)
└── Your first Skill (10 min)
    └── Give your agent tools (15 min)
        └── Add approval flows (10 min)
            └── Build a workflow (15 min)
                └── Connect your systems (15 min)
                    └── Result: production-ready agent with knowledge,
                        tools, approvals, and workflow automation
```

Six pages, ~70 minutes total. The reader builds a complete agent with all
four capability layers. The final tutorial transitions from sample data to
real integrations.

**Next step prompt**: "Ready to integrate into your app? → TypeScript SDK"

### The local path

**Reader**: "I want to run everything locally."

```
Local quickstart (5 min)
└── Your first Skill (10 min)
    └── (same tutorial sequence as full build path)
```

The local quickstart replaces the cloud quickstart. Everything after
first-skill is the same — tutorials are path-independent.

### The "I know what I want" path

**Reader**: "I need a specific answer."

No linear progression. The reader jumps directly to:

- A concept page (e.g., "How do approval flows work?" → `/docs/concepts/approval-flows`)
- An SDK guide (e.g., "How do I call an agent from Go?" → `/docs/sdks/go`)
- A CLI command (e.g., "What flags does `stigmer run` accept?" → `/docs/cli/commands/run`)
- The API reference (e.g., "What RPCs does the AgentExecution service expose?" → `/docs/reference/api`)

The docs landing page and sidebar structure support this by making every
section directly accessible without traversing a linear path.

---

## 6. Maintenance notes

### CONTRIBUTING.md update

The content architecture table in `docs/CONTRIBUTING.md` (lines 42–56)
defines 9 directories. This IA replaces that structure with 6 directories.
CONTRIBUTING.md should be updated when Phase 3 begins.

| Old directory | Disposition |
|---------------|-------------|
| `getting-started/` | **Kept** — same name, refined scope (cloud-first quickstart) |
| `concepts/` | **Kept** — same name, reframed for platform builders |
| `sdks/` | **Kept** — unchanged |
| `integration/` | **Removed** — absorbed into SDKs (per-language integration) and tutorials (connect your systems) |
| `architecture/` | **Removed** — future expansion; not in T01 scope |
| `deployment/` | **Removed** — future expansion as "Self-hosting"; local quickstart covers the basic local setup |
| `cli/` | **Kept** — unchanged |
| `reference/` | **Kept** — unchanged |
| `contributing/` | **Removed** — stays as `docs/CONTRIBUTING.md` repo file, not a rendered docs section |

**New directory**: `tutorials/` — progressive tutorials from Phase 6.

### Document writer role corrections

Three changes recommended for `_roles/002_document_writer.md`. These should
be applied as a separate task before Phase 3 content writing begins.

1. **Add writing-context awareness**: Replace the absolute rule "Write for a
   smart person who is not technical" with a context-sensitive version.
   The sales-site and introductory-docs register uses plain language. The
   reference and SDK register uses precise technical language. Point to the
   vocabulary guide's five writing contexts as the calibration source.

2. **Clarify per-page content types scope**: Add a note that the four content
   types (tutorial, how-to, explanation, reference) govern page content, not
   sidebar organization. The navigation tree is defined by this information
   architecture document.

3. **Scope the infrastructure-analogy prohibition**: The rule "Do not use
   analogies to Kubernetes, Docker, or other infrastructure tools" should be
   scoped to the sales site and introductory docs. In architecture and
   contributor docs, such references are appropriate for the audience.

### `meta.json` governance

The `meta.json` files in Section 3 are the source of truth for sidebar
ordering. When a new page is added:

1. Create the `.mdx` file in the correct directory per this IA.
2. Add the filename (without extension) to the directory's `meta.json`
   `pages` array in the intended position.
3. If the page doesn't appear in `meta.json`, Fumadocs appends it
   alphabetically after listed pages — this is acceptable only for
   auto-generated content (CLI commands).

### Vocabulary inconsistency register

Six items in the vocabulary guide's inconsistency register may affect the IA
or page content. Status:

| # | Item | IA impact |
|---|------|-----------|
| 1 | OSS README tagline ("agentic automation") | No IA impact — README is not a docs page. Resolve before Phase 2 for brand consistency. |
| 2 | Cloud README tagline ("SDK-first agent orchestration") | No IA impact — Cloud README is a separate repo. Resolve before Phase 2. |
| 3 | Audience conflict (document writer role vs. STYLE.md) | Addressed by document writer role correction #1 above. |
| 4 | Cloud README "Credential" concept | No IA impact — not a docs page. Resolve independently. |
| 5 | YAML shorthand vs. proto field names | Affects quickstart and tutorials — must be resolved before Phase 3 to decide which YAML syntax to show. |
| 6 | Two approval models | Addressed in IA: `approval-flows.mdx` explicitly covers both mechanisms. Page content must distinguish tool-call approvals from workflow-task approvals. |

### Future IA revisions

As the docs grow, two structural evolutions are likely:

1. **Per-topic directories**: When a concept accumulates 3+ pages (e.g.,
   agents explanation + agents how-to + agents YAML reference), it may
   warrant its own directory. This would shift the concepts section from a
   flat list to a nested structure. This is a natural evolution, not a
   failure of the current IA.

2. **How-to section**: As the platform matures, task-oriented how-to guides
   that don't fit neatly into tutorials or concepts may accumulate (e.g.,
   "How to migrate agents between environments," "How to debug a stuck
   workflow"). A dedicated `how-to/` section may be needed. Wait until there
   are 4+ such pages before creating the section.

---

*This document is a Phase 1 deliverable of the content strategy project. It
is the structural blueprint for Phases 2–7. No page should be created outside
this structure without updating this IA document first. All page titles, nav
labels, and CTA text follow the
[vocabulary guide](../../../../docs/vocabulary.md) register rules. All
structural decisions trace back to the
[positioning document](positioning.md).*
