# Next Task: 20260331.01.content-strategy

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260331.01.content-strategy

**Description**: Define content strategy and build content for Stigmer sales website (stigmer.ai) and documentation site (stigmer.ai/docs), targeting platform builders and founders who want to add AI agent capabilities to their products.
**Goal**: Create compelling sales website positioning (agents that work for your business), a progressive documentation experience (5-min skills-only quickstart to full agent tutorials), and a reference sample application.
**Tech Stack**: Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)
**Components**: site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

## Current State

- **Status**: Phase 4 complete, Getting Started "Connect your tools" page delivered
- **Last Session**: 2026-04-02 (Session 12) — "Connect your tools" page, MCP server demos, SDK McpServerDetailView enhancement
- **Active Task**: T01 — Phase 4 complete. Getting Started complete (3 pages). Ready for Phase 5 (Sample Reference Application).

## Session Progress (2026-03-31, Session 8)

- **Phase 2 fully implemented** — all 14 tasks completed, build passes, TypeScript passes, zero linter errors
- **Phase 2A: Theme Foundation**
  - Replaced Geist/Geist Mono with Instrument Sans, Instrument Serif, DM Mono (from Figma design)
  - Rewrote CSS palette to monochromatic (#0a0a0a bg, #f5f5f5 headings, #a3a3a3 body, #505050 labels)
  - Added `--color-subtle` custom token for #505050 label text
  - Removed all glass/glow tokens and utilities
  - Forced dark mode for marketing pages via `className="dark"` on `<html>` (Fumadocs RootProvider overrides for docs)
  - Updated all Fumadocs `--color-fd-*` overrides for both light and dark modes
- **Phase 2B: Layout Shell**
  - Updated `constants.ts` with IA-defined nav (Use Cases, Docs, Pricing, GitHub, Sign In, Start Free), 3-column footer (Product, Developers, Open Source), and positioning-sourced tagline/description
  - Rewrote Header.tsx with `rgba(10,10,10,0.88)` backdrop, monochromatic style, Sign In + Start Free CTAs
  - Rewrote Footer.tsx with 4-column grid, DM Mono uppercase headings, Apache 2.0 badge
  - Updated MobileMenu.tsx for new nav links and Start Free CTA
  - Updated Fumadocs layout.shared.tsx with Use Cases nav link
- **Phase 2C: Homepage Sections (all 8)**
  - Section 1 (Hero): Headline A + sub-headline, Open Source/Apache 2.0 badges, code preview window, stats bar, radial gradient background
  - Section 2 (Demo Story, NEW): Condensed three-act narrative with 01/02/03 numbered acts, proof quotes, before/after
  - Section 3 (Capabilities): Three pillars (Knows/Uses/Asks) in bordered card grid with italic claims
  - Section 4 (How It Works): Teach/Connect/Deploy numbered steps
  - Section 5 (Use Cases): 5 industry cards (Healthcare, HR, FinTech, Education, Legal)
  - Section 6 (Why It Works): 4 foundation items synthesized from positioning Foundation pillar
  - Section 7 (Open Source): Apache 2.0 emphasis with signal badges
  - Section 8 (Final CTA): Start Free + tabbed SDK install snippets (TypeScript/Go/Python)
- **Phase 2D: Supporting Pages**
  - Created `/use-cases` page with expanded 5 use case stories (builder, challenge, capabilities, proof interaction, outcome)
  - Created `/pricing` placeholder with Free/Pro/Enterprise tiers
- **Phase 2E: Docs Theme Alignment**
  - Fonts globally applied via root layout (Instrument Sans replaces Geist across entire site)
  - Updated `docs/index.mdx` with IA-defined 4 routing cards (Getting Started, Core Concepts, Tutorials, SDK Reference)
  - Added Cards/Card to MDX components
- **Phase 2F: Validation**
  - CTA audit: 20+ CTAs verified against IA Section 4 mapping. All fallbacks → `/docs` with TODO comments
  - Vocabulary compliance: Sales copy uses business-register language throughout
  - Build verification: `yarn build` passes, `tsc --noEmit` passes
  - Cleaned up dead code: removed Architecture.tsx, Features.tsx, Quickstart.tsx, StigmerLogo.tsx
- **Key design decisions executed** (from plan):
  - Hero background: CSS radial gradient vignette, no images/JS animations
  - Demo Story: Condensed three-act narrative using Figma numbered-item pattern
  - CTA fallbacks: All links to unbuilt docs pages → `/docs` with TODO comments noting intended targets

## Session Progress (2026-04-01, Session 9)

- **Pre-Phase 3 prerequisites completed** — both tasks from IA Section 6 applied
- **Document writer role corrections** (`_roles/002_document_writer.md`):
  - Correction 1: Replaced absolute "write for a non-technical person" rule with context-sensitive register framework referencing the vocabulary guide's five writing contexts. Plain language remains the default; reference/SDK docs acknowledged as using precise technical language.
  - Correction 2: Added clarifying note that Diataxis content types are a writing-quality rule, not a navigation rule. Sidebar structure is defined by the information architecture.
  - Correction 3: Scoped infrastructure-analogy prohibition (Kubernetes, Docker) to sales site and introductory docs only. Architecture and contributor docs may use such references.
- **docs/CONTRIBUTING.md updated**:
  - Content architecture table: 9 directories replaced with 6 (removed `integration/`, `architecture/`, `deployment/`, `contributing/`; added `tutorials/`)
  - Removed stale `_archive/` reference (deleted in Phase 0)
  - Updated `meta.json` example from fictional page names to IA-actual pages (`quickstart`, `self-hosted`, `first-skill`)
  - Added note listing non-rendered files excluded from sidebar
- **Vocabulary inconsistency #3 resolved** — the audience conflict between document writer role and STYLE.md is now addressed by Correction 1. The inconsistency register entry in `docs/vocabulary.md` should be marked as resolved in a future session.
- **Verification**: `yarn build` passes, `tsc --noEmit` passes

## Session Progress (2026-04-01, Session 10)

- **Web app tagline aligned with content strategy** — updated `client-apps/web/src/app/layout.tsx` metadata
  - Title: `"Stigmer — Agents for Your Platform"` → `"Stigmer — Build agents that work for your business"`
  - Description: Updated to match `SITE_CONFIG.description` from `site/src/lib/constants.ts`
  - Ensures consistent brand messaging across web app and sales website
- **Verification**: No linter errors introduced

## Session Progress (2026-04-01, Session 11)

- **Phase 3: Getting Started documentation — fully implemented**
- Created three tutorial pages: `quickstart.mdx` (Cloud, web console + SDK), `local.mdx` (CLI-based), `first-skill.mdx` (CLI-based Skill creation)
- Built `skill-creation.ts` demo scenario and `DemoSkillCreation.tsx` wrapper for Cloud quickstart embedded demo
- Completed all housekeeping: renamed self-hosted → local in IA, resolved vocabulary inconsistency #3, cleaned up docs/scratch/
- Verified: `tsc --noEmit` passes, `yarn next build` passes (Node 22), all routes render
- Updated `stigmer run` syntax in docs to use `-m` flag (verified against CLI source)
- Prerequisites delivered by sub-project `20260401.01.sp.react-demo-mode`: demo transport, fixtures, samples, scenarios infrastructure

## Session Progress (2026-04-02, Session 12)

- **"Connect your tools" Getting Started page** — third and final Getting Started page completing the tagline narrative ("teach your domain, bring your tools, set your rules")
- Built 4 new demo scenarios: `mcp-server-creation-tour` (12-step guided tour), `discover-capabilities-playback`, `generate-policies-playback`, static `mcp-server-detail`
- Created `McpServersListView` demo view component
- Parameterized `ComposerView` artifact panel with `ArtifactMeta` interface — supports Skill and MCP Server artifact types
- Added `defaultCapabilityTab` prop to SDK `McpServerDetailView` (non-breaking enhancement)
- Replaced custom `McpServerDetailDemo` with real SDK `McpServerDetailView` in discover/generate scenarios using per-step client map pattern
- Fixed pre-existing SSR build bug in `api-key-setup` scenario
- Registered all new components in barrel exports and MDX map
- Build verified: `tsc --noEmit` passes, `yarn next build` passes (Node 22), all 23 pages generated

## Next Steps

1. **Begin Phase 5** — Sample Reference Application
2. **Or continue with Phase 6** — Progressive Tutorials (tools tutorial, approval flows tutorial)
3. **Resolve Cloud README vocabulary inconsistencies** — #2 and #4 deferred from Phase 1 (separate repo)

## Context for Resume

- Phase 2 (sales website) and Phase 3 (getting started docs) are fully built and passing build.
- Phase 3 deliverables: `quickstart.mdx`, `local.mdx`, `first-skill.mdx` with embedded `DemoSkillCreation` component
- React demo mode infrastructure (`@stigmer/react/demo`) provides `createDemoClient`, `buildScenario`, `fixtures`, `samples` for creating mock-backed components in docs
- Remaining TODO comments in the codebase mark where links need updating as later phases deliver their content:
  - Phase 4 TODOs: `/docs/concepts/what-is-stigmer`
  - Phase 6 TODOs: `/docs/tutorials/give-your-agent-tools`, `/docs/tutorials/add-approval-flows`, `/docs/tutorials/connect-tools`
  - Phase 7 TODOs: `/docs/sdks/typescript`, `/docs/sdks/react`, `/docs/reference/api`
  - Cloud URLs: `cloudSignupUrl`, `cloudSigninUrl` need real Stigmer Cloud URLs
- The old section components (Architecture.tsx, Features.tsx, Quickstart.tsx) have been deleted — their patterns are no longer needed
- The Figma design was used for theme extraction only — colors, fonts, visual style. Content and section structure comes from Phase 1 deliverables exclusively.
- `docs/index.mdx` links to Phase 3-7 pages that don't exist yet — Fumadocs handles 404s gracefully
- The `FEATURES` export was removed from `constants.ts` — no longer needed
- Badge component variants were simplified: `emerald`/`purple`/`cyan` removed in favor of monochromatic `outline`/`muted`
- Card component variants simplified: `glass`/`glassAccent`/`feature` removed in favor of flat `default`/`elevated`/`bordered`/`ghost`
- **The positioning document is the source of truth for all messaging decisions**
- **The vocabulary guide (`docs/vocabulary.md`) governs all terminology**
- **The information architecture is the structural blueprint for all pages**

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/tasks/T01_0_plan.md
```

### 3. Phase 2 Plan (reference only)
```
/Users/suresh/.cursor/plans/phase_2_sales_website_2b34002b.plan.md
```

### 4. Positioning Document (Phase 1 foundation)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md
```

### 5. Vocabulary Guide (Phase 1 deliverable 2)
```
/Users/suresh/scm/github.com/stigmer/stigmer/docs/vocabulary.md
```

### 6. Information Architecture (Phase 1 deliverable 5)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/information-architecture.md
```

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Read the positioning document at `design-decisions/positioning.md`
3. [ ] Read the vocabulary guide at `docs/vocabulary.md`
4. [ ] Read the information architecture at `design-decisions/information-architecture.md`
5. [ ] Check current task status in `tasks/T01_0_plan.md`
6. [ ] Review TODO comments in site/ for CTA targets that need updating
7. [ ] Check coding guidelines in `coding-guidelines/`
8. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`

## Quick Commands

After loading context:
- "Start Phase 3" - Begin Getting Started documentation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review TODO targets" - Check which CTA links need updating

---

*This file provides direct paths to all project resources for quick context loading.*

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/next-task.md` - Build a demo/mock mode for @stigmer/react that allows components to render with realistic sample data without a live Stigmer backend, enabling real product components to be embedded in documentation.
- `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.02.sp.getting-started-revision/next-task.md` - Revise the Getting Started documentation to tell a connected, progressive story. Rewrite Cloud Quickstart (sign up, SDK, implicit assistant agent), Your First Skill (domain knowledge before/after), Local Quickstart (alternative entry), and docs homepage. Build a ScenarioPlayer component for animated playback of real @stigmer/react components in docs. Update the document writer role with narrative continuity, aha-moment design, and progressive disclosure principles.
