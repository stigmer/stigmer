# T01 Review: Developer Feedback

**Date**: 2026-03-21
**Reviewer**: Suresh

## Decisions on Open Questions

### 1. Framework: Fumadocs — Approved
Go with Fumadocs as recommended.

### 2. Content Location: Repo Root `docs/`
Keep content at the repo root `docs/` directory. The site build should source from there. This keeps docs accessible to people browsing the repo without touching the site code.

**Technical note**: Fumadocs `source.config.ts` in `site/` can source from `../docs` via relative path. Verified this works with Fumadocs content collections.

### 3. Tagline: Delegated
Leave to AI judgment. Make it consistent with the existing site tagline ("Build Agents. Skip the Infrastructure.").

### 4. Quickstart Scope: Agent Only
No workflow in the quickstart. Focus on agent-only flow: install → start server → create agent → run → verify.

### 5. Static Export: Pragmatic
Open to whatever works best. Static export preferred if possible, but not a hard constraint. Trust engineering judgment.

**Technical note**: Fumadocs officially supports `output: "export"`. Search needs static configuration (Orama static mode). Verified from Fumadocs docs and GitHub issues.

### 6. Lint Strictness: `make check` Integration
Integrate into `make check` locally. No CI-specific setup needed — if it runs in `make check`, that's sufficient. The developer runs `make check` before every commit.

## No Structural Objections
No changes requested to the 5-phase structure or scope boundaries.
