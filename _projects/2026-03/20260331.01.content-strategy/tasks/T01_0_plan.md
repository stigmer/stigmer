# Task T01: Content Strategy — Full Project Plan

**Created**: 2026-03-31
**Status**: PENDING REVIEW
**Type**: Feature Development

**This plan requires your review before execution.**

## Context

Stigmer is an open-source agentic automation platform. Through conversations with platform builders, we've identified that:

- **Primary audience**: Platform builders and founders who want to add AI agent capabilities to their products. NOT infrastructure engineers.
- **Cloud-primary positioning**: The front door is "sign up, get API key, use SDK." Self-hosted/OSS is a trust signal and power-user path, not the first thing shown.
- **Core product story**: "Build AI agents that work for your business" — agents that know your domain, use your tools, follow your processes, and ask humans when unsure.
- **Progressive disclosure**: The "aha moment" comes in layers. First, upload knowledge (Skills) and see the agent answer domain questions (5 min). Then add tool access. Then approval flows. Then workflows.

### Vocabulary Guide (User-Facing vs Internal)

| User-Facing Term | Internal/Technical Term | Notes |
|---|---|---|
| Domain knowledge | Skills | "Upload your domain knowledge" not "Create a Skill" |
| Tool access | MCP Servers | "Give your agent tools" not "Configure MCP servers" |
| Approval flows | HITL (Human-in-the-Loop) | "Add approval flows" not "Set up HITL" |
| Multi-step automation | Workflows (CNCF Serverless) | "Automate multi-step processes" |
| Conversations | Sessions | "Your agent remembers conversations" |
| Agent definitions | Agent YAML / Agent resource | Use sparingly; show by example |

---

## Full Project Phases

### Phase 0: Clean Slate — Remove Stale Auto-Generated Content

**Goal**: Clear out all content that was scaffolded or auto-generated during the documentation infrastructure project. Preserve tooling/infrastructure, remove content.

#### What to REMOVE

1. **All auto-generated docs content in `docs/`** (~60+ .mdx files):
   - `docs/concepts/*.mdx` (all files)
   - `docs/getting-started/*.mdx` (all files)
   - `docs/cli/*.mdx` and `docs/cli/commands/*.mdx` (all files)
   - `docs/reference/*.mdx` (all files)
   - `docs/architecture/*.mdx` (all files)
   - `docs/deployment/*.mdx` (all files)
   - `docs/integration/*.mdx` (all files)
   - `docs/contributing/*.mdx` (all files)
   - `docs/sdks/**/*.mdx` (all files)
   - `docs/index.mdx` (will be rewritten)

2. **Archived stale content**: `docs/_archive/` (entire directory)

3. **Sales website copy that assumes infrastructure-engineer audience**:
   - `site/src/lib/constants.ts` — FEATURES, NAV_LINKS, FOOTER_LINKS, tagline, description all need rewrite

4. **Homepage section content** (keep component shells, gut the copy):
   - `site/src/components/sections/Hero.tsx` — copy/messaging rewrite
   - `site/src/components/sections/Features.tsx` — copy/messaging rewrite
   - `site/src/components/sections/Architecture.tsx` — may be removed or heavily reworked
   - `site/src/components/sections/Quickstart.tsx` — copy/messaging rewrite

#### What to PRESERVE

- Documentation infrastructure: Fumadocs config, Vale config, MDX components, layout files, build pipeline
- `docs/STYLE.md` and `docs/CONTRIBUTING.md` (process docs, not product content)
- Component shells in `site/src/components/` — we rewrite content inside them, not delete them
- `site/src/components/ui/` — all UI primitives stay
- `site/src/components/layout/` — Header, Footer, MobileMenu stay (nav links updated via constants)
- `site/src/components/docs/` — doc-specific components stay (mermaid, sdk-tabs, etc.)

---

### Phase 1: Positioning and Messaging Foundation

**Goal**: Define all messaging, positioning, narrative, and use cases BEFORE writing any code. This becomes the source of truth that Phase 2 (sales site) and Phases 3-7 (docs) draw from.

#### Deliverables

1. **Positioning Document** (`design-decisions/positioning.md`)
   - Core positioning statement
   - Tagline and headline options (tested against: "Would a non-technical founder understand this?")
   - One-sentence description, one-paragraph description
   - What Stigmer IS (for the audience) vs what it is NOT
   - Competitive framing (without naming competitors): how we're different from "just a chatbot" / "just RAG" / "just an API wrapper"

2. **Demo Story Narrative** (`design-decisions/demo-story.md`)
   - The full narrative example (property management agent or equivalent)
   - Structured as: Before (generic AI, useless) → Step-by-step transformation → After (agent that works)
   - Each step maps to a Stigmer capability: Knowledge → Tools → Approvals → Memory
   - Written as copy that could go directly on the sales site
   - Alternative demo stories for different industries (2-3 short variants)

3. **Use Case Library** (`design-decisions/use-cases.md`)
   - 4-5 use case summaries, each with:
     - Industry/role context
     - The problem (what the founder/builder is trying to solve)
     - How Stigmer solves it (which capabilities: skills, tools, workflows, HITL, sessions)
     - One-paragraph outcome story
   - Candidates: Customer support, onboarding assistant, internal knowledge expert, sales assistant, domain expert, operations automation

4. **Vocabulary Guide** (`coding-guidelines/vocabulary.md`)
   - Full mapping of internal terms → user-facing terms
   - Rules for when technical terms are OK (architecture section, SDK docs) vs when they must be translated (homepage, quickstart, concepts)
   - Examples of good vs bad copy for each term

5. **Information Architecture** (`design-decisions/information-architecture.md`)
   - Sales site page structure and navigation
   - Docs site navigation tree (left sidebar)
   - How sales site links to docs (CTAs → specific docs pages)
   - The progressive tutorial path (quickstart → tutorials → reference)

---

### Phase 2: Sales Website Content

**Goal**: Rewrite the stigmer.ai homepage and create supporting pages.

#### Homepage Sections (top to bottom)

1. **Hero** — "Build agents that work for your business" + cloud signup CTA + GitHub trust badge
2. **Demo Story** (NEW section) — The before/after narrative from Phase 1
3. **Three Capabilities** — Knows your business / Uses your tools / Asks before acting
4. **How It Works** — 3 high-level steps: Teach → Connect → Deploy
5. **What You Can Build** (replaces Features) — Use case cards from Phase 1
6. **Why It Works** (for the curious) — Technical trust: durable execution, sandboxed tools, real API contracts, open source
7. **Open Source** — Apache 2.0, public contracts, self-host option
8. **Final CTA** — "Start free" + SDK install snippets per language

#### Site Navigation Changes

```
Logo  |  Use Cases  |  Docs  |  Pricing  |  GitHub  |  Sign In  |  [Start Free]
```

#### Additional Pages

- `/use-cases` — Expanded use case stories
- `/pricing` — Placeholder (Free / Pro / Enterprise tiers)

---

### Phase 3: Documentation — Quickstart (Cloud-First)

**Goal**: A 5-minute experience from zero to "my agent knows my domain."

#### Cloud Quickstart (shown first)

1. Sign up at stigmer.ai → get API key
2. Install SDK: `npm install @stigmer/sdk` (or pip, go get, etc.)
3. Create a skill (markdown file with domain knowledge)
4. Upload the skill
5. Run the agent with a domain question
6. See the response using YOUR knowledge

#### Self-Hosted Quickstart (shown second)

1. `brew install stigmer/tap/stigmer`
2. `stigmer server`
3. Write agent YAML → `stigmer apply` → `stigmer run`

#### Your First Skill

- What is a skill (domain knowledge, not code)
- Create a simple markdown skill
- Attach it to an agent
- See the difference: without skill (generic) vs with skill (domain expert)

---

### Phase 4: Documentation — Core Concepts (Rewritten)

**Goal**: Rewrite all concept pages for platform builders, not infrastructure engineers.

- **What is Stigmer?** — Reframed for "I'm a founder/builder, why should I care?"
- **Agents** — What they are, what they can do, how to define one
- **Domain Knowledge (Skills)** — How to teach an agent your business
- **Conversations (Sessions)** — How agents remember context across interactions
- **Workflows** — How to automate multi-step processes
- **Tool Access (MCP)** — How agents interact with external systems
- **Environments & Secrets** — Configuration and credential management
- **Organizations & Projects** — Multi-tenant structure

---

### Phase 5: Sample Reference Application

**Goal**: Build a realistic but self-contained example app that tutorials walk through.

- Sample app in `examples/` (e.g., simulated order management or property management)
- Includes a sample MCP server that simulates a real backend API (no external dependencies)
- Pre-built skills (domain knowledge files)
- Agent definitions (YAML)
- Workflow definitions (YAML)
- README with setup instructions

---

### Phase 6: Documentation — Progressive Tutorials

**Goal**: Four tutorials that progressively add capabilities to the quickstart agent.

1. **"Give your agent tools"** — Add the sample MCP server, agent can now query/act on data
2. **"Add approval flows"** — Agent asks for human approval before risky actions
3. **"Build a multi-step workflow"** — Chain steps: check → decide → act → report
4. **"Connect to your real systems"** — Replace sample MCP server with real integrations

---

### Phase 7: Documentation — SDK Guides and Reference

**Goal**: Language-specific integration guides and auto-generated reference.

- TypeScript SDK guide (primary, matches cloud-first approach)
- Go SDK guide
- Python SDK guide
- Java SDK guide
- CLI reference (auto-generated where possible)
- gRPC API reference

---

## Execution Order

Phase 0 and Phase 1 are the immediate next work. Phase 0 is mechanical cleanup. Phase 1 is the strategic foundation — everything else depends on the messaging and positioning decisions made here.

```
Phase 0 (cleanup) → Phase 1 (positioning) → Phase 2 (sales site) → Phase 3 (quickstart) → Phase 4 (concepts) → Phase 5 (sample app) → Phase 6 (tutorials) → Phase 7 (SDK/reference)
```

Phases 5 and 6 may run in parallel. Phase 7 can begin independently once Phase 1 vocabulary is established.

## Success Criteria for T01

- Phase 0 cleanup completed (stale content removed, infrastructure preserved)
- All Phase 1 deliverables produced and reviewed:
  - Positioning document approved
  - Demo story narrative written and reviewed
  - Use case library complete
  - Vocabulary guide established
  - Information architecture defined
- Ready to begin Phase 2 (sales website content implementation)

## Review Process

**What happens next**:
1. **You review this plan** — consider the phases, priorities, and approach
2. **Provide feedback** — any changes to scope, ordering, or content direction
3. **I'll revise** — create T01_2_revised_plan.md incorporating feedback
4. **You approve** — give explicit go-ahead
5. **Execution begins** — Phase 0 cleanup first, then Phase 1 deliverables
