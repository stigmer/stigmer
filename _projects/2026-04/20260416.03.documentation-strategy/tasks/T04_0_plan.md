# Task T04: README Overhaul

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Content

## Objective

Restructure the root `README.md` to align with the content strategy positioning, fix all broken links, and present a clear above-the-fold story for GitHub visitors.

## Context

### Current Problems
1. **Broken links**: `docs/getting-started/local-mode.md` (doesn't exist), `docs/architecture/*`, `docs/guides/*` (removed during content strategy Phase 0)
2. **Positioning drift**: Tagline "Build AI agents and workflows with zero infrastructure" doesn't match content strategy's "AI agent platform" category or four pillars
3. **Missing signals**: No badges, no visual, no community proof
4. **Too long**: 425 lines; important content below GitHub's fold
5. **Stale Documentation section**: Links to relative file paths that were removed

### Content Strategy Guidance
- README uses the "README/GitHub" register from `docs/vocabulary.md`: developer-direct, CLI-first, technical
- Category: "AI agent platform"
- Pillars: Knows your business / Uses your tools / Asks before acting / Built for production
- Cloud-primary on sales site, but README stays developer-first (per positioning.md Decision 3)

## Task Breakdown

### Step 1: Fix All Broken Links
Audit every link in README.md. Replace relative file paths that no longer exist with:
- Live docs site URLs (`https://stigmer.ai/docs/...`) for documentation links
- Valid relative paths for files that still exist in repo (e.g., `sdk/go/README.md`, `CONTRIBUTING.md`)

### Step 2: Restructure into Three Tiers

**Tier 1 — Above the fold (~80 lines):**
- Banner (keep existing)
- Tagline aligned with content strategy positioning
- Badge row: CI status, license (Apache 2.0), Discord, npm
- Quick start: 4 commands only (install → server → apply → run)
- "What is Stigmer?" — 3 sentences using the four pillars

**Tier 2 — Core content (~150 lines):**
- Agent YAML example (keep, signature artifact)
- CLI command table (keep, useful for scanners)
- Local vs Cloud table (keep, differentiator)
- Architecture diagram (keep)

**Tier 3 — Footer (~60 lines):**
- SDKs section (brief: Go SDK, React SDK, Ink SDK with links)
- Development / from-source build
- Contributing + community
- License

### Step 3: Move Detailed Content to Docs Site
- LLM configuration details → `docs/cli/index.mdx` or dedicated guide
- Troubleshooting → `docs/cli/index.mdx` or dedicated guide
- Extensive Go SDK examples → keep only one minimal example, link to SDK docs
- Workflows detailed explanation → link to concepts page

### Step 4: Add Documentation Section with Valid Links
Replace current stale Documentation section with links to:
- Getting Started (Cloud): `https://stigmer.ai/docs/getting-started/quickstart`
- Getting Started (Local/OSS): `https://stigmer.ai/docs/getting-started/local`
- CLI Reference: `https://stigmer.ai/docs/cli`
- SDK Reference: `https://stigmer.ai/docs/sdk`
- Core Concepts: `https://stigmer.ai/docs/concepts`

## Success Criteria

- [ ] Zero broken links in README
- [ ] Tagline and vocabulary aligned with content strategy
- [ ] Badge row present
- [ ] Key content visible above GitHub's fold
- [ ] Documentation section links to live docs site
- [ ] SDKs section mentions Go, React, and Ink SDKs
- [ ] Total length reduced to ~300 lines

## Files Touched

- `README.md`

## Dependencies

- T01 (CLI docs) should be complete so `/docs/cli` link is valid
- T02 (OSS path) should be complete so `/docs/getting-started/local` link is in nav
- T03 (Ink SDK) should be complete so Ink SDK can be mentioned in SDKs section
