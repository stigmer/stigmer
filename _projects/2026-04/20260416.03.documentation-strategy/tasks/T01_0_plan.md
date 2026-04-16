# Task T01: CLI Reference Documentation — Content Quality and Docs Site

**Created**: 2026-04-16
**Status**: PENDING REVIEW
**Type**: Content + Infrastructure

## Objective

Deliver CLI reference documentation on the docs site with quality gates:
1. Audit and rewrite Cobra command descriptions for the docs website voice
2. Add a Go test enforcing documentation coverage (every command has `Long` + `Example`)
3. Generate and commit CLI docs, create the `docs/cli/` structure
4. Write a hand-authored `docs/cli/index.mdx` overview page
5. Wire CLI docs into the site navigation and homepage
6. Add `gen-cli-docs` + `gen-cli-docs-check` to root Makefile and CI

## Context

### What Already Exists
- **Generator**: `client-apps/cli/cmd/gen-cli-docs/main.go` walks the Cobra command tree and produces per-command MDX pages, `index.mdx`, and `meta.json`
- **CLI Makefile targets**: `gen-cli-docs` and `gen-cli-docs-check` in `client-apps/cli/Makefile`
- **Vale config**: `.vale.ini` has a rule block for `docs/cli/commands/**/*.{md,mdx}`
- **Site scripts**: `generate-llms-txt.ts` anticipates a `cli/commands` path segment

### What's Missing
- Output directory `docs/cli/commands/` does not exist (not generated, not committed)
- No entry in `docs/meta.json` for `cli`
- No root Makefile targets (only in `client-apps/cli/Makefile`)
- No CI workflow step
- No hand-written overview page (`docs/cli/index.mdx`)
- `docs/index.mdx` shows "CLI Reference — Coming soon" with no href
- Cobra `Long` and `Example` fields were written for terminal `--help`, not for a docs website

### Analog: React SDK Pipeline
The React SDK has a proven pipeline: TSDoc in source → TypeDoc JSON → custom MDX generator → Fumadocs pages, with CI freshness check and a coverage script. We mirror the same pattern for CLI (Cobra source → `gen-cli-docs` → MDX → Fumadocs, with CI check and a Go coverage test).

## Task Breakdown

### Step 1: Audit CLI Command Descriptions

Walk through every non-hidden command in `client-apps/cli/cmd/stigmer/root/*.go` and ensure:
- **`Short`**: One sentence, starts with a verb
- **`Long`**: 2-5 paragraphs explaining what the command does, when to use it, key behaviors (idempotent? destructive?), and relationships to other commands. Written as prose for a docs website, not terminal formatting. Use the "reference/SDK" register from `docs/vocabulary.md`.
- **`Example`**: At least one realistic example per command; multi-example for complex commands (`run`, `apply`, `connect`). Each example has a comment explaining what it does.

Commands to audit (from `root.go` AddCommand sequence):
- Core: `run`, `apply`, `validate`, `search`
- Resource: `get`, `list`, `delete`
- Artifact: `push`, `download`, `draft`
- Server: `server`, `mcp-server`, `connect`
- Config: `backend`, `config`, `auth`

### Step 2: Add CLI Doc Coverage Go Test

Create `client-apps/cli/cmd/gen-cli-docs/coverage_test.go`:
- Every non-hidden command with a `GroupID` has a non-empty `Long`
- Every non-hidden command has at least one `Example`
- Every subcommand has a non-empty `Short`
- All flag `Usage` strings are non-empty

This runs as part of `make test` and prevents undocumented commands from being merged.

### Step 3: Generate and Commit CLI Docs

Run `go run ./cmd/gen-cli-docs --output ../../docs/cli/commands/` from `client-apps/cli/`.

Create the docs structure:
```
docs/cli/
  index.mdx              ← hand-written overview
  meta.json              ← { "title": "CLI", "pages": ["index", "commands"] }
  commands/
    index.mdx            ← auto-generated grouped command table
    run.mdx              ← auto-generated per command
    apply.mdx
    ...
    meta.json            ← auto-generated sidebar with group separators
```

### Step 4: Write `docs/cli/index.mdx`

Hand-written overview page (following pattern of `docs/sdk/react/index.mdx`):
- What the CLI is and who it's for
- Install instructions (brew, shell script, from source)
- Backend modes (local vs cloud) and `stigmer backend`
- LLM configuration (brief, link to full guide)
- Link to auto-generated Command Reference
- Link to Local Quickstart (`/docs/getting-started/local`)

### Step 5: Wire into Docs Navigation

- Add `"cli"` to `docs/meta.json` pages array (between `sdk` and `concepts`)
- Replace "Coming soon" CLI Reference card in `docs/index.mdx` with working link to `/docs/cli`

### Step 6: Root Makefile and CI

Add to root `Makefile`:
- `gen-cli-docs` target
- `gen-cli-docs-check` target (diff-based freshness check)
- Add both to `codegen` umbrella

Add `gen-cli-docs-check` to CI workflow alongside `gen-react-sdk-docs-check`.

## Success Criteria

- [ ] Every non-hidden command has quality `Long` description and `Example`
- [ ] Go coverage test passes and is part of `make test`
- [ ] `docs/cli/commands/` committed with auto-generated MDX pages
- [ ] `docs/cli/index.mdx` hand-written overview published
- [ ] CLI appears in docs sidebar and homepage (no more "Coming soon")
- [ ] `make gen-cli-docs-check` passes in CI

## Files Touched

- `client-apps/cli/cmd/stigmer/root/*.go` (Cobra descriptions)
- `client-apps/cli/cmd/gen-cli-docs/coverage_test.go` (new)
- `docs/cli/index.mdx` (new, hand-written)
- `docs/cli/meta.json` (new)
- `docs/cli/commands/*.mdx` (new, auto-generated)
- `docs/cli/commands/meta.json` (new, auto-generated)
- `docs/meta.json` (add `cli`)
- `docs/index.mdx` (replace Coming soon card)
- `Makefile` (add targets)
- CI workflow file (add check step)

## Notes

- The `gen-cli-docs` generator already handles ALL-CAPS section headers → `###` headings and MDX escaping, so rewritten `Long` content flows naturally into both terminal help and MDX pages
- Task logs can be updated freely; knowledge folders require permission
