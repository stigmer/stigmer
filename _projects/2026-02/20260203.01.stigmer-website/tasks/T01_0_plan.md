# Task T01: Stigmer Website Implementation Plan

**Created**: 2026-02-03
**Status**: PENDING REVIEW
**Type**: Feature Development
**Timeline**: 1 week (this week)

⚠️ **This plan requires your review before execution**

---

## Executive Summary

Build the Stigmer product website at https://stigmer.ai following the OpenMCF website pattern:
- Next.js 15 static export deployed via GitHub Pages
- Dark theme with gradient accents (matching Stigmer brand)
- Landing page with hero, features, documentation sections
- Mobile-first, semantic HTML, accessible

---

## Reference Architecture (from OpenMCF)

```
site/
├── .github/workflows/pages.yml    # GitHub Pages deployment
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout with metadata
│   │   ├── page.tsx              # Landing page
│   │   ├── docs/                 # Documentation routes
│   │   └── globals.css           # Tailwind + custom styles
│   ├── components/
│   │   ├── pages/HomePage.tsx    # Main landing composition
│   │   ├── sections/             # Page sections (Hero, Features, etc.)
│   │   └── ui/                   # Atomic components (Button, Badge)
│   └── lib/                      # Utilities, constants, MDX helpers
├── public/
│   ├── docs/                     # Markdown documentation files
│   └── images/                   # Static assets
├── next.config.mjs               # Static export config
├── package.json
└── tailwind.config.ts
```

---

## Phase Breakdown

### Phase 1: Infrastructure Setup (Day 1) 
**Model: Opus 4.5** (development)

| Task | Description | Deliverable |
|------|-------------|-------------|
| 1.1 | Create `site/` folder structure | Folder hierarchy matching OpenMCF |
| 1.2 | Initialize Next.js 15 project | `package.json`, `tsconfig.json` |
| 1.3 | Configure static export | `next.config.mjs` with `output: 'export'` |
| 1.4 | Setup Tailwind CSS 4 | `tailwind.config.ts`, `globals.css` |
| 1.5 | Create GitHub Actions workflow | `.github/workflows/pages.yml` |
| 1.6 | Add `.gitignore`, `Makefile` | Developer tooling |

**Acceptance Criteria:**
- `yarn dev` runs locally
- `yarn build` produces `out/` directory
- GitHub Action triggers on push to main

---

### Phase 2: Core Components (Day 2)
**Model: Opus 4.5** (development)

| Task | Description | Deliverable |
|------|-------------|-------------|
| 2.1 | Create UI atoms | `button.tsx`, `badge.tsx`, `card.tsx` |
| 2.2 | Create layout components | `Header.tsx` with nav, `Footer.tsx` |
| 2.3 | Setup root layout | `app/layout.tsx` with metadata, fonts |
| 2.4 | Create HomePage composition | `components/pages/HomePage.tsx` |

**Acceptance Criteria:**
- Components follow atomic design principles
- Accessible with proper ARIA attributes
- Mobile-first responsive design

---

### Phase 3: Landing Page Content (Days 3-4)
**Model: Sonnet 4.5 for copy → Opus 4.5 for implementation**

#### 3.1 Hero Section
- **Copy (Sonnet)**: Tagline, subheading, CTAs
- **Dev (Opus)**: `Hero.tsx` with gradient background, install command

**Content to define:**
- Primary headline (what is Stigmer?)
- Subheadline (value proposition)
- Primary CTA (Get Started / Install)
- Secondary CTA (View Docs)
- Badge chips (Open Source, CLI-first, etc.)

#### 3.2 Problem Statement
- Why existing solutions fail
- Pain points Stigmer solves

#### 3.3 Feature Cards
- Key capabilities with icons
- 4-6 features max for MVP

#### 3.4 How It Works
- 3-4 step visual flow
- Code snippets if applicable

#### 3.5 Quickstart
- Installation command
- First example

#### 3.6 Footer
- Links: GitHub, Docs, Community
- Copyright

---

### Phase 4: Documentation Foundation (Day 5)
**Model: Opus 4.5** (development)

| Task | Description |
|------|-------------|
| 4.1 | Create docs routing (`/docs/[...slug]`) |
| 4.2 | Setup MDX/Markdown renderer |
| 4.3 | Create docs sidebar navigation |
| 4.4 | Add initial docs structure |

**Initial Doc Structure:**
```
public/docs/
├── index.md           # Getting Started
├── installation.md    # Install guide
├── quickstart.md      # First steps
└── concepts/
    └── overview.md    # Core concepts
```

---

### Phase 5: Polish & Deploy (Days 6-7)
**Model: Opus 4.5** (development)

| Task | Description |
|------|-------------|
| 5.1 | Add meta tags, OG images |
| 5.2 | Verify Core Web Vitals (LCP, CLS) |
| 5.3 | Test mobile responsiveness |
| 5.4 | Configure custom domain |
| 5.5 | Enable HTTPS via GitHub |
| 5.6 | Verify DNS propagation |

---

## DNS Configuration Checklist

**User Action Required** (GoDaddy):

```
Type  | Name | Value             | TTL
------|------|-------------------|-----
A     | @    | 185.199.108.153   | 600
A     | @    | 185.199.109.153   | 600
A     | @    | 185.199.110.153   | 600
A     | @    | 185.199.111.153   | 600
CNAME | www  | stigmer.github.io | 600
```

**Post-DNS Actions** (CLI):
```bash
# Verify DNS propagation
dig stigmer.ai +short
dig www.stigmer.ai +short

# Configure GitHub Pages custom domain
gh api repos/stigmer/stigmer/pages \
  --method PUT \
  --field cname="stigmer.ai" \
  --field https_enforced=true
```

---

## Model Selection Guide

| Task Type | Model | Rationale |
|-----------|-------|-----------|
| Taglines, headlines, value props | **Sonnet 4.5** | Faster iteration on creative copy |
| Feature descriptions, marketing copy | **Sonnet 4.5** | Better at persuasive writing |
| React components, build configs | **Opus 4.5** | Complex code, architecture |
| GitHub Actions, deployment | **Opus 4.5** | Needs precise YAML, debugging |
| CSS/styling refinements | **Opus 4.5** | Technical precision |
| Content iterations | **Sonnet 4.5** | Quick feedback loops |

**Workflow:**
1. Draft all copy with Sonnet → Get approval
2. Implement with Opus using finalized copy
3. Use Sonnet for post-launch copy tweaks

---

## Success Criteria

- [ ] Site accessible at https://stigmer.ai
- [ ] HTTPS enforced
- [ ] Landing page loads < 2s (LCP)
- [ ] Mobile responsive (< 768px works)
- [ ] Hero section with clear value prop
- [ ] Features section showcasing capabilities
- [ ] /docs route with basic documentation
- [ ] Footer with GitHub link, copyright

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| DNS propagation delays | Start DNS config early (Day 1), verify before deploy |
| GitHub Pages custom domain issues | Have fallback to stigmer.github.io/stigmer |
| Content not ready | Use placeholder copy, iterate post-launch |
| Scope creep | MVP first, iterate. No pricing page in v1. |

---

## Open Questions for Review

1. **Branding**: Do you have Stigmer logo assets (SVG)? Brand colors?
2. **Tagline**: Any preferred messaging for the hero section?
3. **Features**: Which Stigmer capabilities should be highlighted first?
4. **Docs content**: Do existing docs in `/docs/` need to be migrated?

---

## Review Process

**What happens next:**
1. **You review this plan** - Consider timeline, scope, approach
2. **Provide feedback** - Adjustments, priorities, content direction
3. **I'll revise** - Create T01_1_review.md and T01_2_revised_plan.md
4. **You approve** - Explicit go-ahead
5. **Execution begins** - Tracked in T01_3_execution.md

**Please confirm:**
- Does this approach align with your vision?
- Are phase timelines realistic?
- Any missing requirements?
- Ready to proceed?
