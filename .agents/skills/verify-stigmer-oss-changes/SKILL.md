---
name: verify-stigmer-oss-changes
description:
  Runs the checks that apply to the files a session changed, using the root
  guide's verification map, and reports new findings apart from pre-existing
  ones. Use before every commit, when asked to verify changes, or when a
  session's work is about to be called done.
---

# Verify Stigmer OSS changes

The full `make check` gate takes twenty minutes and more. This procedure runs
the subset that the session's changes can have affected, so that a commit is
verified in minutes and the full gate is left to CI.

## Procedure

1. **Find the changed files.** `git diff --name-only` for uncommitted work,
   `git diff --name-only origin/main...HEAD` for the branch's commits; combine
   both when the session did both. Work happens in a worktree, so the paths are
   relative to it.
2. **Map paths to checks.** The mapping is the `## Verification map` in the root
   `AGENTS.md`, one row per path prefix. Do not keep a second copy of it
   anywhere; when a row is wrong, fix the map.
3. **Run the matched checks**, independent ones in parallel, from the directory
   each row names (the server and the runner run from their own directory; they
   are outside the npm workspace).
4. **Report** one line per check with its summary quoted, then the findings.
   Separate findings in files the session touched from findings in files it did
   not: the first block blocks the commit, the second is pre-existing and is
   named, not fixed in passing. A check that could not run says why.

## Notes the map does not carry

- After any `.proto` change the docs-facing checks
  (`make check-docs-yaml gen-proto-sdk-docs-check gen-task-docs-check gen-task-registry-check`)
  are mandatory. They run in seconds and are historically the gates that break
  CI after a proto change.
- The TypeDoc-based checks (`gen-react-sdk-docs-check`,
  `gen-ink-sdk-docs-check`, `gen-theme-docs-check`) are slow and, on pushes to
  `main`, self-healed by the docs workflow; on a pull request they are a gate,
  so a change to an exported symbol's TSDoc regenerates the docs before the push
  (`make gen-react-sdk-docs`; the site's dependencies must be installed first,
  as `.github/workflows/ci.docs.yaml` shows).
- Slow, rarely affected targets (`check-links`, `validate-demos`, `test-demos`)
  stay out unless asked for. `make build-site` is not among them: it is the only
  MDX compile, and the `docs/**` row asks for it.
- The conformance rows cover what runs on this machine alone. The execution
  class (`make test-conformance-execution`, needs the `temporal` and `stigmer`
  CLIs and git) and the cloud classes stay by hand; run the execution class when
  a suite under `test/conformance/src/suites-execution/` or a runner behaviour
  changes. `test/conformance/README.md` has the recipes.
- In a fresh worktree, `npm ci` and `make build-ts-stubs` (or
  `npm run build -w @stigmer/protos`) come first; without them the TypeScript
  packages cannot resolve `@stigmer/protos` and every typecheck fails for the
  wrong reason.
- When in doubt whether a row applies, run it. A few seconds of checking beats a
  red pipeline.
