# Task T01: Docs Clean Slate & Rebuild — Revised Plan

**Created**: 2026-03-21
**Status**: PENDING APPROVAL
**Type**: Rebuild (not migration)

---

## Problem Statement

The Stigmer docs site has the right framework (Fumadocs, standards, templates, linting) but the content is unreliable. ~120 legacy `.md` files and 5 live `.mdx` pages contain stale implementation details, wrong prerequisites, and AI-generated guesses about architecture. Migrating this content would mean validating every sentence — more work than starting fresh from the source of truth.

**New approach**: Delete all content. Rebuild from protos, SDK code, and actual implementation.

---

## What We Keep

| Category | Files | Why |
|---|---|---|
| Documentation standards | `docs/standards/**` (10 files) | Output of the documentation-foundation project. Templates, terminology, IA — all still valid. |
| Fumadocs framework | `site/src/app/docs/`, `site/source.config.ts`, `site/src/lib/source.ts` | Framework plumbing is correct, only content is stale. |
| Cursor rules | `.cursor/rules/docs/` (3 files) | Documentation enforcement rules — still valid. |
| Reminders | `_reminders/004_documentation-standards.md` | Still valid reference. |

## What We Delete

Everything else under `docs/` that is not in `docs/standards/`:

| Directory | Files | Reason |
|---|---|---|
| `docs/product/` | 22 | Stale concept docs — will rebuild from protos |
| `docs/architecture/` | 27 | Unvalidated design docs — rebuild when needed |
| `docs/adr/` | 11 | Unvalidated decision records |
| `docs/implementation/` | 10 | Internal engineering notes |
| `docs/sdk/` | 10 | Internal SDK dev docs |
| `docs/guides/` | 18 + examples | Stale how-to guides |
| `docs/cli/` | 4 | Stale CLI docs |
| `docs/engineering/` | 1 | Internal |
| `docs/deployment/` | 2 | Internal |
| `docs/audit-reports/` | 5 | Internal audit |
| `docs/getting-started/` | 1 | Stale quickstart |
| `docs/README.md` | 1 | Stale index |
| `docs/index.mdx` | 1 | Stale landing page |
| `docs/quickstarts/*.mdx` | 3 | Stale quickstart content |
| `docs/concepts/*.mdx` | 3 | Stale concept content |

**Total deleted**: ~119 files. **Total kept**: 10 standards files + framework code.

---

## Phases

### Phase 0: Audience & Purpose Foundation

**Goal**: Establish who the documentation is for and what it must accomplish — before writing a single page of content. This is the missing foundation that every subsequent phase depends on.

**Problem**: The current standards, reminders, role, and cursor rules define *how* to format documentation (templates, headings, terminology) but never define *who* it is for or *why* it exists. There is no reminder that says "the reader is a platform builder." The `_reminders/003_platform-for-platforms.md` reminder covers UI/SDK code but not documentation. The `_reminders/005_sales-website-mindset.md` reminder explicitly excludes docs. There is a gaping hole.

**Deliverables**:

1. **Create `_reminders/007_documentation-for-platform-builders.md`**
   - The docs mindset reminder — dropped into every documentation conversation
   - Defines the primary audience: **platform builders** who want to embed AI agent execution into their products
   - Defines their constraints: busy, evaluating alternatives, need to get running fast
   - Defines the documentation's job: bridge the gap from "what is this?" to "I have agents running in my platform"
   - Introduces the **Diátaxis framework** (Tutorials, How-to Guides, Reference, Explanation) as the organizing principle — the industry standard used by Temporal, Django, NumPy, Cloudflare
   - Time-to-value obsession: "If a platform builder cannot get from zero to running agents in 5 minutes, the docs have failed"
   - Applies to every file in `docs/` — same scope as `_reminders/004`

2. **Update `docs/standards/documentation-standards.md`**
   - Add **"Audience & Purpose"** as the very first section, before the five mandates
   - Define the primary audience (platform builders), secondary audiences (individual developers, contributors)
   - State the documentation's purpose explicitly
   - Reference the Diátaxis framework and map our content types to its quadrants
   - Add a stale content mandate: "Every factual claim must be validated against the current codebase. When in doubt, check the proto definition or run the CLI command."
   - Add a diagram mandate: "Use Mermaid fenced code blocks for all diagrams. Never use `text` code blocks for visual structures like resource trees, architecture flows, or pipelines."

3. **Update `_reminders/004_documentation-standards.md`**
   - Add audience context at the top — not just formatting rules, but who and why
   - Reference the new `007` reminder

4. **Update `_roles/002_document_writer.md`**
   - Replace "developers, platform operators, and AI practitioners" with explicit platform builder focus
   - Add awareness of Diátaxis framework
   - Add the time-to-value principle

5. **Update `.cursor/rules/docs/documentation-standards.mdc`**
   - Add audience awareness to the auto-apply rule so it's injected into every docs edit context
   - Add diagram mandate (Mermaid, not ASCII art)
   - Add stale content validation rule

**Files touched**: `_reminders/007_documentation-for-platform-builders.md` (new), `docs/standards/documentation-standards.md`, `_reminders/004_documentation-standards.md`, `_roles/002_document_writer.md`, `.cursor/rules/docs/documentation-standards.mdc`

**Key framework — Diátaxis mapping**:

| Diátaxis quadrant | Reader need | Our content type | Our directory |
|---|---|---|---|
| **Tutorials** | "Help me learn" (learning-oriented) | Quickstarts | `docs/quickstarts/` |
| **How-to Guides** | "Help me solve a problem" (task-oriented) | Guides | `docs/guides/` |
| **Reference** | "Give me the facts" (information-oriented) | CLI Reference, SDK Reference | `docs/cli/`, `docs/sdk/` |
| **Explanation** | "Help me understand" (understanding-oriented) | Concepts | `docs/concepts/` |

---

### Phase 1: Clean Slate + Visual Foundation

**Goal**: Delete all stale content, fix the visual foundation so new content looks professional.

**Deliverables**:

1. **Delete all stale docs content**
   - Remove every directory and file listed in the "What We Delete" table above
   - Keep `docs/standards/` untouched
   - Create a minimal `docs/index.mdx` placeholder so the site still builds
   - Create minimal `docs/meta.json` with just the landing page

2. **Fix docs typography/spacing (CSS)**
   - Increase paragraph margins, heading spacing, line height
   - Ensure code blocks have proper surrounding whitespace
   - Scope changes to `/docs` layout — do not affect marketing site
   - Target: match the reading comfort of docs.temporal.io

3. **Set up Mermaid rendering**
   - Add Mermaid support to Fumadocs (rehype-mermaid or fumadocs built-in)
   - Verify Mermaid code blocks render as diagrams, not code
   - Test with a sample diagram

4. **Update documentation standards**
   - Add to `docs/standards/documentation-standards.md`:
     - Diagram mandate: "Use Mermaid fenced code blocks for all diagrams. Never use `text` code blocks for visual structures."
     - Stale content rule: "Every factual claim must be validated against the current codebase before publishing. When in doubt, check the proto definition or run the CLI command."
   - Update `.cursor/rules/docs/documentation-standards.mdc` with diagram rule
   - Update `_reminders/004_documentation-standards.md`

**Files touched**: Most of `docs/` (deletions), `site/src/app/globals.css`, `docs/standards/documentation-standards.md`, `.cursor/rules/docs/documentation-standards.mdc`, `_reminders/004_documentation-standards.md`, possibly `site/next.config.ts` or Fumadocs config for Mermaid

### Phase 2: Docs Home Page

**Goal**: A polished, Temporal-quality home page with personality.

**Deliverables**:

1. **Rebuild `docs/index.mdx`**
   - Compelling hero copy (not "Build Agents. Skip the Infrastructure." — that's marketing site territory)
   - SDK/language icon row: Go, Java, Python, React, TypeScript — colorful icons like Temporal's
   - Section cards pointing to content sections (Quickstarts, Concepts, Guides, CLI, SDK, Architecture)
   - Cards for sections not yet populated show "Coming Soon" state

2. **Sidebar label**
   - Change "Stigmer Docs" to "Home" in sidebar (update `docs/meta.json`)

3. **SDK icon component**
   - May need a custom MDX component or inline SVGs for the colorful language icons
   - Register in `page.tsx` MDX component mapping if custom component

**Files touched**: `docs/index.mdx`, `docs/meta.json`, possibly `site/src/app/docs/[[...slug]]/page.tsx`, possibly new icon assets or component

### Phase 3: Core Content — Top 5 Concepts (from protos)

**Goal**: Rebuild the top 5 concept docs from the actual protobuf definitions, per-resource docs, and running implementation. Start small, see how it goes, decide whether to continue incrementally.

**Proto source location**: `stigmer/apis/ai/stigmer/` — 18 resources across 4 domains, each with a `docs/` directory alongside the proto files.

**Approach per concept**:
1. Read the proto definition files (`spec.proto`, `api.proto`, `command.proto`, `query.proto`, etc.)
2. Read the per-resource `docs/` directory for existing documentation (may be stale — validate, don't trust)
3. Read the Go/Python implementation to understand actual behavior
4. Write the concept doc following `docs/standards/templates/concept.mdx`
5. Use Mermaid for any diagrams
6. Run `make lint-docs` to verify
7. If the proto docs are stale, fix them in the same pass (separate PR to `apis/`)

**Top 5 concepts** (in priority order):

| # | Concept | Proto source path | Docs path |
|---|---|---|---|
| 1 | What is Stigmer? | Derived from all protos — platform overview | N/A (no single proto) |
| 2 | What is an Agent? | `apis/ai/stigmer/agentic/agent/v1/` | `agentic/agent/docs/` |
| 3 | What is an AgentExecution? | `apis/ai/stigmer/agentic/agentexecution/v1/` | `agentic/agentexecution/docs/` |
| 4 | What is a Session? | `apis/ai/stigmer/agentic/session/v1/` | `agentic/session/docs/` |
| 5 | What is a Workflow? | `apis/ai/stigmer/agentic/workflow/v1/` | `agentic/workflow/docs/` |

**Remaining concepts** (deferred — pick up incrementally after top 5):
McpServer, Skill, Organization, Environment, AgentInstance, WorkflowExecution, WorkflowInstance, ExecutionContext, Project, ApiKey, IamPolicy, IdentityAccount, IdentityProvider.

**Files created**: `docs/concepts/*.mdx` (5 files), updated `docs/concepts/meta.json`

### Phase 4: Quickstart (validated)

**Goal**: A single, verified CLI quickstart where every command is tested against the actual implementation.

**Deliverables**:
1. Rebuild `docs/quickstarts/cli.mdx` from scratch
   - No Docker prerequisite
   - Every command validated against the real CLI
   - Every expected output verified
   - Mermaid diagram showing the flow if useful

**Files created**: `docs/quickstarts/cli.mdx`, `docs/quickstarts/index.mdx`, `docs/quickstarts/meta.json`

### Phase 5: Verification

**Goal**: Everything works, everything passes.

1. `make lint-docs` passes (0 issues)
2. `yarn build` (Node 20) succeeds — all pages generate
3. All internal links resolve
4. Visual spot-check of home page, quickstart, concept pages
5. Create project checkpoint

---

## What This Project Does NOT Cover (deferred to future projects)

- **Concepts 6-18** — remaining concept docs beyond the top 5 (pick up incrementally)
- **CLI reference docs** — rebuild from `stigmer --help` output and actual command behavior
- **Guide/how-to docs** — rebuild as real workflows emerge
- **Architecture docs** — rebuild when specific deep-dives are needed
- **ADRs** — capture new decisions going forward, don't retroactively reconstruct old ones
- **SDK-specific guides** — rebuild when SDKs are documented
- **Sales website changes** — beyond docs-specific CSS
- **Proto docs fixes** — if per-resource `docs/` in `apis/` are stale, that's a separate PR to the protos

---

## Execution Order

Phase 0 (audience & purpose) → Phase 1 (clean + visual foundation) → Phase 2 (home page) → Phase 3 (concepts from protos) → Phase 4 (quickstart) → Phase 5 (verification)

Each phase is independently shippable. Phase 0 must come first — it sets the mindset for everything that follows.

---

## Resolved Questions

1. **Proto file locations**: Found in the OSS repo at `stigmer/apis/ai/stigmer/` — 18 resources across `agentic/`, `iam/`, `tenancy/`, `commons/` domains. Each resource has a `docs/` directory alongside the proto files. The `stigmer-cloud` repo consumes these protos but does not define its own.

2. **How many concept docs?** Start with top 5 only. Evaluate and decide incrementally after that.

3. **Diagram approach**: Mermaid — confirmed.

4. **SDK icons**: Show all 5 SDKs: Go, Java, Python, React, TypeScript.

5. **Internal docs triage**: Eliminated. Delete everything, rebuild from ground truth.

---

## Review Process

**Approve this plan to begin execution.**
- Phase 1 can start immediately after approval.
- I'll present each phase for review before moving to the next.
