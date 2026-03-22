# Docs Navigation Simplification and Content Rewrite

**Date**: March 22, 2026

## Summary

Simplified the docs site navigation by removing the redundant Home/Docs tabs from the Fumadocs sidebar, and completely rewrote the "What is Stigmer?" landing page to follow the Document Writer role: plain language, no Kubernetes analogies, no jargon dependencies. The Stigmer logo now serves as the sole navigation back to the marketing website.

## Problem Statement

The docs site had two issues affecting the user experience for platform builders arriving at the documentation.

### Pain Points

- **Redundant navigation tabs.** The sidebar showed "Home," "Docs," and "GitHub" as top-level tabs. "Docs" was always active when viewing documentation, making it dead weight. "Home" only redirected to the marketing website — a purpose better served by the logo.
- **Jargon-heavy introduction.** The "What is Stigmer?" page opened with a Kubernetes analogy ("provides the same operational rigor for Agents that Kubernetes provides for containers") and relied on unexplained technical concepts: declarative definitions, YAML resources, apiVersion/kind/metadata/spec/status, Durable Execution, gRPC API, Temporal. This created a prerequisite knowledge barrier for platform builders who don't have infrastructure engineering backgrounds.

## Solution

Two targeted changes to eliminate the noise and make the documentation accessible to any platform builder.

## Implementation Details

### Navigation simplification (`site/src/lib/layout.shared.tsx`)

Removed `"Home"` and `"Docs"` from the Fumadocs `baseOptions().links` array. Only the GitHub external link remains. The Stigmer logo in the top-left links to `/` (the marketing page) by default via Fumadocs' `nav.url` — no configuration needed.

**Before:** Three links (Home, Docs, GitHub) creating tab clutter above the sidebar tree.
**After:** One link (GitHub). The sidebar shows the page tree directly.

### Content rewrite (`docs/index.mdx`)

Complete rewrite from scratch following the Document Writer role guidelines:

- **Removed** all Kubernetes and Docker analogies
- **Removed** all unexplained jargon (declarative definitions, Durable Execution, gRPC, apiVersion/kind/metadata/spec/status)
- **Removed** technology name-drops (SQLite, MongoDB, Ollama, Anthropic, Temporal)
- **Added** recipe card analogy to explain the definition file concept in everyday terms
- **Explained** YAML, API, Environment, MCP Server, Skill, and Execution in plain language inline
- **Restructured** the flow: What is it → Why it exists → How it works → Building blocks → For product teams → Reliability → Get started

Every sentence uses active voice, addresses the reader as "you," and carries one idea. The YAML code example is retained but introduced gently with "Here is what a definition file looks like" and a plain-language explanation of what YAML is.

## Benefits

- **Lower barrier to entry.** Platform builders can understand what Stigmer is without knowing Kubernetes, Docker, or infrastructure engineering concepts.
- **Cleaner navigation.** The sidebar shows the docs page tree directly — no tab switching needed.
- **Consistent with role guidelines.** The content fully complies with the Document Writer role's plain language mandate.

## Impact

- **docs/index.mdx** — The first page every visitor sees. Affects all new users.
- **site/src/lib/layout.shared.tsx** — Affects navigation on every docs page.
- **Quality gates passed** — Vale: 0 errors, 0 warnings. Prettier: clean. Build: 42 pages generated.

## Related Work

- Document Writer role update (`_roles/002_document_writer.md`) — Role guidelines were revised in this session to explicitly prohibit Kubernetes/Docker analogies and require plain-language-first writing.
- Session 5 (T14: CI Quality Gates) — Established the quality gate pipeline that validated this content change.
- Session 3 (T06: Fumadocs Integration) — Set up the Fumadocs infrastructure that renders this page.

---

**Status**: Production Ready
**Timeline**: Single session
