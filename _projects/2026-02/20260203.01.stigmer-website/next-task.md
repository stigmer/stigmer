# Next Task: 20260203.01.stigmer-website

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260203.01.stigmer-website

**Description**: Launch the Stigmer product website at https://stigmer.ai using GitHub Pages with Next.js static export, following the OpenMCF website pattern
**Goal**: Bring https://stigmer.ai to life with a modern, high-conversion landing page, features showcase, and documentation - establishing Stigmer's web presence as an open source project
**Tech Stack**: Next.js 15, TypeScript, Tailwind CSS 4, GitHub Pages, GitHub Actions
**Components**: New site/ folder, GitHub Actions workflow, DNS configuration, Landing page, Features page, Documentation section

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260203.01.stigmer-website/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-03 15:53
**Last Updated**: 2026-02-03 18:07
**Current Task**: Phase 3 (Content Polish) - ✅ COMPLETED
**Status**: Production-Ready with Code-First Messaging

## Session Progress (2026-02-03)

### Phase 1 Completed (16:46)
- ✅ Created complete site/ infrastructure (20 files)
- ✅ Configured Next.js 15 with static export
- ✅ Setup Tailwind CSS 4 with Stigmer design tokens
- ✅ Created Button and Badge UI components
- ✅ Implemented GitHub Actions deployment workflow
- ✅ Verified build pipeline (typecheck, lint, build all pass)
- ✅ Generated static export (106 kB First Load JS)

### Phase 2 Completed (17:08)
- ✅ Created 10 production-ready components (1,314 lines)
- ✅ Built complete component architecture (primitives → layout → sections → pages)
- ✅ Implemented Header with fixed nav and mobile menu
- ✅ Created responsive Footer with 4-column grid
- ✅ Built Hero section with gradients, CTAs, and install command
- ✅ Created Features section with 6-card grid
- ✅ Implemented Quickstart with 3-step guide and code blocks
- ✅ Composed full HomePage landing page
- ✅ Zero linter/TypeScript errors
- ✅ Optimized build: 124 kB First Load JS

### Phase 3 Completed (18:07)
- ✅ Comprehensive content rewrite with code-first messaging
- ✅ Updated tagline: "Agentic Workflows as Code"
- ✅ Repositioned for engineering teams (vs business analysts)
- ✅ Emphasized Dual-Track architecture (YAML + SDK)
- ✅ Fixed CLI commands: brew install, stigmer server
- ✅ Fixed license: Apache 2.0 (was MIT)
- ✅ Rewrote all 6 features with outcome focus
- ✅ Updated Hero badges: Apache 2.0, Built on Temporal, YAML + SDK
- ✅ Completely revamped Quickstart: 4-step 60-second flow
- ✅ Added SDK callout box explaining progression path
- ✅ Validated against 6 content tests (clarity, differentiation, outcome, respect, proof, code-first)
- ✅ Zero linter errors maintained

### Key Decisions
- Used Next.js 15 App Router with static export for GitHub Pages
- Adopted Tailwind 4 CSS-first pattern with PostCSS
- Established Stigmer brand colors (blue #3b82f6, purple #8b5cf6)
- Followed OpenMCF reference architecture for proven patterns
- Used class-variance-authority for type-safe component variants
- Server components by default, client only where needed
- Type aliases instead of empty interfaces (ESLint compliance)
- Focus trap and keyboard navigation in mobile menu
- Copy-to-clipboard with visual feedback

**Content Strategy (Phase 3):**
- Positioned as "Agentic Workflows as Code" for engineers
- Implicit contrast to visual BPMN tools (no explicit competitor mentions)
- Dual-Track architecture as core differentiator (YAML for experiments, SDK for production)
- Technical credibility through specific stack mentions (Temporal, BadgerDB, gRPC)
- Messaging framework: Hair on Fire → Intellectual Insight → Aha Moment
- Voice: Clear > Clever, Precise Language, High Agency, No Fluff

### Files Created (Total: 30 files)
**Phase 1:**
- Configuration: 9 files (package.json, tsconfig.json, next.config.ts, etc.)
- Application: 6 files (layout.tsx, page.tsx, globals.css, etc.)
- Libraries: 2 files (utils.ts, constants.ts)
- Components: 2 files (button.tsx, badge.tsx)
- Deployment: 1 file (pages.yml GitHub Actions workflow)

**Phase 2:**
- UI Primitives: 3 files (logo.tsx, icon.tsx, card.tsx)
- Layout: 3 files (Header.tsx, MobileMenu.tsx, Footer.tsx)
- Sections: 3 files (Hero.tsx, Features.tsx, Quickstart.tsx)
- Pages: 1 file (HomePage.tsx)

## Next Steps

**Ready for Production Deployment**

1. Deploy to GitHub Pages
   - DNS configuration for stigmer.ai
   - Verify GitHub Actions workflow
   - Enable HTTPS enforcement
   - Test on production domain

3. Phase 4: Documentation Foundation
   - Create /docs/[...slug] dynamic route
   - Setup MDX/Markdown rendering
   - Docs sidebar navigation
   - Migrate existing docs content

**Immediate Deployment Path:**
The site is production-ready now. To deploy:
1. Configure DNS (GoDaddy) - see T01_0_plan.md for records
2. Push to main branch
3. GitHub Actions will deploy automatically
4. Verify at https://stigmer.ai

## Changelog

- 📝 [2026-02-03-164601-stigmer-website-phase-1-infrastructure.md](/_changelog/2026-02/2026-02-03-164601-stigmer-website-phase-1-infrastructure.md)
- 📝 [2026-02-03-170506-stigmer-website-phase-2-core-components.md](/_changelog/2026-02/2026-02-03-170506-stigmer-website-phase-2-core-components.md)
- 📝 [2026-02-03-180701-website-content-polish-code-first-messaging.md](/_changelog/2026-02/2026-02-03-180701-website-content-polish-code-first-messaging.md)

## Quick Commands

After loading context:
- "Continue with Phase 2" - Begin Core Components phase
- "Show build output" - View static export
- "Test locally" - Run dev server
- "Review design tokens" - Check globals.css

---

*This file provides direct paths to all project resources for quick context loading.*
