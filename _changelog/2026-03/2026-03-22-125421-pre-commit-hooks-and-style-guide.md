# Pre-commit hooks and documentation style guide

**Date**: March 22, 2026

## Summary

Added Husky pre-commit hooks with lint-staged for automated docs quality
enforcement, and created the Stigmer documentation style guide and contributor
guide. This completes Phase 1 (Quality Foundation) of the documentation
infrastructure project.

## Problem Statement

Documentation quality checks (Vale prose linting, Prettier formatting) existed
as Make targets but had no automated enforcement at commit time. Contributors
could bypass all checks and land poorly formatted or incorrectly capitalized
docs. There was also no written reference for Stigmer's documentation conventions
or contributor workflow.

### Pain Points

- No pre-commit enforcement: quality checks were opt-in only
- No style guide: domain term capitalization rules existed in Vale config but
  weren't documented for humans
- No contributor guide: new contributors had no reference for the docs workflow,
  prerequisites, or content architecture
- The AI-facing cursor rule (437 lines) was the only documentation about
  documentation conventions, with no human-facing equivalent

## Solution

Two complementary deliverables:

1. **Pre-commit hooks** (Husky v9 + lint-staged) that automatically run Prettier
   and Vale on staged docs files at every commit.
2. **Style guide and contributing guide** that document the conventions enforced
   by the toolchain.

## Implementation Details

### Pre-commit hooks (T03)

- Added `husky` (v9.1.7) and `lint-staged` (v16.4.0) to root `package.json`
- `"prepare": "husky"` script auto-installs hooks on `npm install`
- lint-staged runs `prettier --write --prose-wrap always` on
  `docs/**/*.{md,mdx}`
- `.husky/pre-commit` runs lint-staged, then conditionally runs Vale (graceful
  degradation if Vale binary is not installed---prints warning but does not block
  commit)
- `Makefile` `setup` target updated to include `npm install` for Husky init

### Style guide and contributing guide (T04)

- `docs/STYLE.md` (~100 lines): audience (platform builders), domain term
  capitalization, heading conventions, code block rules, prose style, file naming,
  formatting, Mermaid diagrams, linking
- `docs/CONTRIBUTING.md` (~120 lines): prerequisites, fork/branch/PR workflow,
  content architecture table, adding pages, `meta.json` sidebar ordering, Make
  targets, pre-commit hooks explanation
- `.cursor/rules/stigmer-oss-documentation-standards.md`: added canonical
  reference pointers to both new human-facing docs
- Vale vocabulary expanded with 10 terms: CLIs, Seedpack, Seedpacks, alex,
  autoformats, config, dev, frontmatter, reformats, repo

## Benefits

- Every docs commit is automatically quality-checked (formatting + prose lint)
- Contributors have a clear reference for writing conventions
- New contributors can onboard to docs work via `CONTRIBUTING.md`
- Domain term capitalization rules are documented for humans, not just enforced
  by tooling
- All 38 docs files pass `make lint-docs` (0 errors, 0 warnings) and
  `make format-docs-check`

## Impact

- **Contributors**: clear docs workflow and writing conventions
- **Quality**: automated enforcement prevents regressions
- **Project**: Phase 1 (Quality Foundation) is now complete---all 5 tasks done
  (T01 Vale, T02 lint fix, T03 hooks, T04 style guide, T05 archive + content)

## Related Work

- [Vale prose linting and docs toolchain](2026-03-22-104645-vale-prose-linting-and-docs-toolchain.md) (T01/T02)
- [Archive docs and content architecture](2026-03-22-112920-archive-docs-and-content-architecture.md) (T05)
- [Fumadocs integration](2026-03-22-123515-fumadocs-integration-docs-site.md) (T06, Phase 2)

---

**Status**: ✅ Production Ready
**Timeline**: ~45 minutes (Session 4)
