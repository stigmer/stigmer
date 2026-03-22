# CLI Reference Documentation Generation

**Date**: March 22, 2026

## Summary

Built a custom Go documentation generator that walks the Cobra command tree and
produces MDX reference pages for every `stigmer` CLI command. The generator
outputs 20 command pages, an index page, and a `meta.json` sidebar configuration
into `docs/cli/commands/`. Generated files are committed to the repo, and a CI
freshness check ensures they stay in sync with the CLI source.

## Problem Statement

The Stigmer CLI has ~20 top-level commands with subcommands, flags, and examples,
but none of this was reflected in the documentation site. Users had to rely on
`stigmer --help` output, which is not discoverable, not searchable, and not
cross-linked with the rest of the docs.

### Pain Points

- No web-based CLI reference documentation existed. Users could only discover
  commands through terminal `--help` output.
- Cobra's built-in `cobra/doc` package outputs plain `.md` without Fumadocs
  frontmatter, renders flags as preformatted text blocks, and offers no control
  over grouping, sidebar ordering, or `meta.json` generation.
- CLI descriptions use terminal conventions (UPPERCASE headers, indentation) that
  look poor when rendered directly on the web.
- No mechanism existed to detect when CLI changes made documentation stale.

## Solution

A standalone Go program (`client-apps/cli/cmd/gen-cli-docs/main.go`, ~350 lines)
that imports `GetRootCommand()` from the CLI package, traverses the entire Cobra
command tree, and generates well-formatted MDX pages with proper Fumadocs
integration. Generated files are committed, with a CI check that catches drift.

## Implementation Details

### Generator (`client-apps/cli/cmd/gen-cli-docs/main.go`)

- Imports the CLI root command and walks the tree, skipping hidden/internal
  commands (`internal-server`, `internal-workflow-runner`, `internal-daemon`).
- Produces one MDX file per top-level command with subcommands documented inline
  as `##` sections (flat page structure).
- Each page includes: frontmatter (`title`, `description`), usage block, flags
  table (name, type, default, description), global flags table, examples in
  fenced code blocks, and subcommand sections with their own flags/examples.
- Terminal formatting adapted for web: UPPERCASE section headers converted to
  Markdown `###` headings, indentation preserved in code blocks, blank lines
  collapsed.
- Generates `meta.json` with grouped sidebar ordering (Core Commands, Resource
  Management, Discovery and Templates, Server and Infrastructure, Authentication
  and Configuration, Shell Completion).
- Generates `index.mdx` overview page with commands grouped by category in
  tables.

### Makefile Integration

- `client-apps/cli/Makefile`: Added `gen-cli-docs` (generate) and
  `gen-cli-docs-check` (verify freshness) targets. The CLI owns its own doc
  generation.
- Root `Makefile`: Delegates to CLI Makefile. Introduced `codegen` umbrella
  target that combines `protos` + `gen-cli-docs`. Updated `check` target to use
  `codegen` instead of `protos` directly.

### CI Freshness Check

- Added `cli-docs-freshness` job to `.github/workflows/ci.docs.yaml`.
- Triggers on PRs touching `client-apps/cli/**`.
- Runs `make gen-cli-docs-check`: generates docs to a temp directory, diffs
  against committed docs, fails if stale.

### Vale Configuration

- Created dedicated scope `[docs/cli/commands/**.{md,mdx}]` in `.vale.ini` that
  reduces to only `alex` (inclusive language) checks.
- Auto-generated content inherits style from CLI source code. Style issues should
  be fixed in the Go source, not the docs layer.
- Added technical terms (`subcommand`, `OAuth`, `zsh`, `Powershell`, `autoload`,
  `compinit`) to the Stigmer vocabulary.

### Documentation Updates

- Updated `docs/cli/meta.json` to include `commands` in sidebar navigation.
- Enhanced `docs/cli/index.mdx` with links to the command reference and
  configuration pages.

## Benefits

- **Discoverability**: All CLI commands are now searchable and browsable on the
  docs site, integrated with Fumadocs sidebar navigation and Orama search.
- **Always current**: The CI freshness check catches any CLI change that
  introduces stale docs. Developers run `make gen-cli-docs` after modifying
  commands.
- **Zero maintenance**: Adding a new command to the CLI automatically produces a
  new docs page on the next `make gen-cli-docs` run. No manual MDX authoring.
- **PR visibility**: Generated docs are committed, so reviewers see exactly what
  documentation changes result from CLI modifications.
- **Extensible**: The `codegen` umbrella target provides a natural home for future
  generators (T13 proto API docs will slot in the same way).

## Impact

- **Users**: Can browse all 20 CLI commands with flags, examples, and
  subcommands on the documentation site.
- **Contributors**: `make gen-cli-docs` regenerates docs after command changes.
  `make codegen` regenerates all derived code.
- **CI**: New `cli-docs-freshness` job prevents stale documentation from merging.

## Related Work

- T06 (Fumadocs Setup) — The documentation site that hosts these pages.
- T14 (CI Quality Gates) — The CI workflow extended with the freshness check.
- T13 (Proto API Reference) — Future task that will follow the same pattern.

---

**Status**: Production Ready
**Timeline**: Single session (~3 hours)
