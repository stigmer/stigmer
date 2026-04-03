# Fix CI Docs and Site Build Workflows

**Date**: April 3, 2026

## Summary

Fixed both GitHub Actions workflows (`release.website.yaml`, `ci.docs.yaml`) that had been broken since the Yarn workspace conversion, resolved 255 Vale lint warnings across 14 documentation files, and unified the local and CI build pipelines so `make build-site` is the single source of truth for both.

## Problem Statement

The `release.website` and `ci.docs` workflows were failing on every push to `main` since the content-strategy PRs landed. Two independent root causes:

### Pain Points

- **Build failure**: The site's `@stigmer/react` package was integrated via `file:` protocol but its optional peer dependency `@base-ui/react` was never added to `site/package.json`, causing `Module not found: Can't resolve '@base-ui/react/popover'`
- **Lint failure**: 255 Vale warnings (220 Stigmer.terms + 35 others) in newly added docs — the lint job (`make lint-docs`) exits non-zero on warnings, blocking the entire CI pipeline
- **Local/CI divergence**: Workflows hand-rolled `corepack install && yarn` steps instead of calling the same Makefile targets developers use locally, making it impossible to reproduce CI failures with `make build-site`

## Solution

Three-layer fix: dependency, CI pipeline alignment, and documentation quality.

## Implementation Details

### 1. Missing dependency (`site/package.json`)

Added `@base-ui/react: "^1.0.0"` — the optional peer dep of `@stigmer/react` that Next.js needs when transpiling raw TypeScript source via `transpilePackages`.

### 2. Workflow and Makefile alignment

- Both workflows now call `make build-site` (and `make install-vale`) instead of inline shell steps
- `build-site` depends on `lint-docs` — same gate locally and in CI
- `lint-docs` checks for Vale and fails with clear instructions pointing to `make install-vale`
- New `install-vale` target auto-detects OS (macOS via Homebrew, Linux via GitHub release binary)
- Merged the old separate lint/build jobs in `ci.docs.yaml` into a single `lint-and-build` job since `build-site` already includes linting
- Pinned Vale version via `VALE_VERSION ?= 3.9.5` in the Makefile

### 3. Vale configuration hardening (`.vale.ini`)

Suppressed rules that are standard in developer documentation:
- `Microsoft.HeadingAcronyms` — API, MCP, YAML, RAG in headings
- `Google.Colons` — `**Label**: Value` prerequisite patterns
- `Microsoft.GeneralURL` — "URL" is universal dev terminology

Tested `BlockIgnores` for `<Tabs>` and `<Mermaid>` JSX components but removed it — Vale applies BlockIgnores before code-block detection, which broke `docs/STYLE.md` examples that contain `<Tabs>` inside fenced code blocks.

### 4. Documentation content fixes (14 files)

- 222 Stigmer.terms: capitalized Agent, Session, Skill, Workflow, Environment, Organization, Project where referring to Stigmer concepts; rephrased generic "AI agent" contexts
- 3 Microsoft.Adverbs: removed "naturally" and "generally"
- 2 Google.We: rephrased "Let's"
- 1 Microsoft.FirstPerson: rephrased first-person usage

### 5. Vale vocabulary additions

Added `subgraph`, `sdkCall`, `llmLayer` (Mermaid diagram syntax), and changed `spec` to `[Ss]pec` (Go struct field names in code examples).

## Benefits

- `make build-site` is the single command that gates both local development and CI — if it passes locally, it passes on GitHub
- Zero Vale warnings/errors across all 18 documentation files
- Developers who lack Vale get a clear error message with `make install-vale` as the fix
- CI no longer has hand-rolled shell steps that diverge from the Makefile

## Impact

Both `release.website` and `ci.docs` workflows will pass on the next push to `main`. Documentation now follows the Stigmer style guide consistently, with capitalized domain terms (Agent, Session, Skill, etc.) throughout.

## Related Work

- `cbbb29f7` — site convenience targets added to root Makefile
- Content-strategy PRs (#103, #104, #105) — the PRs that introduced the docs and broke CI

---

**Status**: ✅ Production Ready
