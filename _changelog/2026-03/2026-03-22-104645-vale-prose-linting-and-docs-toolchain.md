# Vale Prose Linting and Documentation Toolchain

**Date**: March 22, 2026

## Summary

Established Vale prose linting, Prettier markdown formatting, and Lychee link checking as the documentation quality toolchain for the Stigmer monorepo. This replaces the previously broken `make lint-docs` target (which referenced a missing script and incorrect file globs) with a working, Vale-based documentation quality pipeline that enforces Stigmer domain terminology, prose style, and formatting standards.

## Problem Statement

The documentation tooling was non-functional and there was zero automated quality enforcement for the 112 markdown files in `docs/`.

### Pain Points

- `make lint-docs` was broken — referenced missing `scripts/lint-docs.mjs` and globbed for `.mdx` files (none exist; all docs are `.md`)
- `make lint-docs-audit` was also broken for the same reasons
- No prose linter — no enforcement of Stigmer domain terminology capitalization (Agent, Workflow, Skill, etc.)
- No markdown formatting — no Prettier config at root level
- No link checking — broken internal links went undetected
- `make check` included the broken `lint-docs` target

## Solution

Set up Vale as the prose linter with Stigmer-specific domain term enforcement, added Prettier for deterministic markdown formatting, and added Lychee for fast link checking. All wired into Make targets that follow the existing repo conventions.

## Implementation Details

### Vale Configuration

- `.vale.ini` at repo root — uses Google, Microsoft, and alex style packages (same proven baseline as Temporal docs)
- `MinAlertLevel = warning` — avoids suggestion noise while catching real issues
- `[formats] mdx = md` — future-proofs for the `.mdx` migration planned in Phase 2
- 8 disabled rules that conflict with docs conventions (contractions, headings, passive voice)

### Stigmer Domain Terms

- `vale/styles/Stigmer/terms.yml` — 45 substitution rules covering all three domain pillars:
  - **Agentic**: Agent, AgentInstance, Session, AgentExecution, Skill, MCP Server, Sub-Agent
  - **Workflow**: Workflow, WorkflowInstance, WorkflowExecution
  - **Platform**: Organization, Environment, Project, API Key, IAM Policy, Identity Account
  - **Infrastructure**: Stigmer Server, Agent Runner, Workflow Runner, Durable Execution

### Vocabulary

- `accept.txt` — 38 terms Vale should not flag (gRPC, proto, SDK, CLI, MCP, SQLite, apiVersion, slug, etc.)
- `reject.txt` — 10 terms to avoid in Stigmer docs (straightforward, very, simple, simply, robust, utilize)

### Make Targets

| Target | Purpose |
|--------|---------|
| `make lint-docs` | Vale lint, strict (fails on warnings+) |
| `make lint-docs-audit` | Vale lint, non-blocking (for triage) |
| `make format-docs` | Prettier format (writes) |
| `make format-docs-check` | Prettier check (CI, no writes) |
| `make check-links` | Lychee broken link detection |

### Dependencies

- Vale 3.14.1 (binary, `brew install vale`)
- Prettier 3.8.1 (npm, root devDependency)
- Lychee 0.23.0 (binary, `brew install lychee`)

## Benefits

- **Terminology enforcement**: Stigmer domain terms are now automatically enforced — `agent` is flagged and corrected to `Agent`, `workflow` to `Workflow`, etc. This maintains ubiquitous language consistency across all documentation.
- **Working CI gate**: `make lint-docs` now actually works. Once stale docs are archived (T05), it can be restored to `make check`.
- **Formatting determinism**: Prettier ensures consistent markdown formatting across all contributors.
- **Broken link detection**: Lychee catches broken internal references before they reach users.
- **Developer setup**: `make setup` now validates Vale and Lychee are installed and syncs Vale packages.

## Impact

- **Developers**: Can now run `make lint-docs-audit` to see the quality state of any documentation
- **CI pipeline**: Once clean docs exist, `lint-docs` and `format-docs-check` can gate PRs
- **Documentation quality**: Establishes the foundation for all subsequent documentation infrastructure work (Fumadocs, Snipsync, CLI/API reference generation)

## Related Work

- Part of project `20260322.01.documentation-infrastructure` (Phase 1: Quality Foundation)
- Based on comparative analysis of Temporal, Pulumi, HashiCorp, GitHub, Crossplane, and Next.js documentation repositories
- Next: T03 (pre-commit hooks), T04 (style guide), T05 (archive stale docs + fresh content architecture)

---

**Status**: Production Ready
**Timeline**: Single session
