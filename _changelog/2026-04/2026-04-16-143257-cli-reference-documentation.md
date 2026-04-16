# CLI Reference Documentation — Enrichment-Based Generator

**Date**: April 16, 2026

## Summary

Delivered state-of-the-art CLI reference documentation with a hybrid enrichment architecture. The gen-cli-docs generator now supports hand-written enrichment templates co-located with Go command source files, producing Vercel CLI-quality documentation pages with auto-generated flags, usage syntax, and subcommand sections merged into hand-authored prose, examples, and cross-references.

## Problem Statement

The existing CLI docs generator produced thin, mechanical pages — essentially `--help` output pasted into MDX. Every command page had a one-paragraph description, a raw flags table, and a code block of examples with no context. This was Fly.io-tier documentation, not what a world-class platform deserves.

### Pain Points

- No hand-written context explaining when and why to use each command
- Flags table with terse one-liner descriptions — no grouped deep-dives
- Examples were undifferentiated code blocks with no explanatory prose
- No cross-references to related commands or concept pages
- Several commands embedded examples inside `Long` descriptions instead of the `Example` field, causing them to not appear in the generated docs
- No CLI section in the docs site navigation at all ("Coming soon" placeholder)
- No CI freshness check for CLI docs

## Solution

Designed and implemented a **template-based hybrid enrichment** system. Each command can have a hand-written `.mdx` enrichment template that controls the full page layout. The generator reads these from `client-apps/cli/cmd/stigmer/root/docs/` (co-located with Go source, mirroring the proto `docs/overview.md` pattern) and replaces `{/* AUTO_USAGE */}`, `{/* AUTO_FLAGS */}`, `{/* AUTO_GLOBAL_FLAGS */}`, `{/* AUTO_SUBCOMMANDS */}` markers with auto-generated content from the Cobra command tree.

## Implementation Details

### Generator Enhancement

- Added `--enrichments-dir` flag to `gen-cli-docs` (default: `./cmd/stigmer/root/docs/`)
- Enrichment files control page structure; AUTO markers inject fresh flags/usage/subcommands
- Commands without enrichments get an improved default template with "See also" back-links
- Renamed "Flags" heading to "Options" (matching Vercel/GitHub CLI convention)

### Enrichment Templates (20 files)

Each enrichment follows the target page anatomy:
1. Overview prose (what it does, when to use it)
2. Auto-generated usage syntax
3. Common patterns (most frequent invocations)
4. Auto-generated options table
5. Key options deep-dives (grouped subsections with prose and examples)
6. Real-world examples (each with heading, code block, and explanatory paragraph)
7. Auto-generated subcommands
8. Related commands table
9. See-also links to guides and concept pages

### Cobra Source Cleanup

- Moved embedded examples from `Long` to `Example` field in 5 commands
- Added missing `Long` and `Example` fields to 10+ subcommands
- Coverage test validates every grouped command has `Long`, every non-hidden command has `Short`

### Docs Site Integration

- `docs/cli/index.mdx` — hand-written overview (installation, backend modes, quick start)
- `docs/cli/meta.json` — section navigation
- `docs/cli/commands/` — 21 auto-generated pages + index + meta.json
- CLI added to sidebar navigation and docs homepage (moved from "Coming soon")

### CI Pipeline

- `make gen-cli-docs` / `make gen-cli-docs-check` — mirroring React SDK pattern
- Wired into `gen-sdk-docs`, `gen-sdk-docs-check`, and `codegen` umbrellas
- `client-apps/cli/**` added to CI trigger paths in `ci.docs.yaml`

## Benefits

- **Developer experience**: CLI docs pages now rival Vercel and GitHub CLI quality — rich prose, grouped option deep-dives, real-world examples with explanations
- **Maintainability**: Enrichments are co-located with command source code; developers see `docs/run.mdx` right next to `run.go`
- **Auto-freshness**: Flags, usage syntax, and subcommands are always generated from the live Cobra tree — no drift
- **CI protection**: `make gen-cli-docs-check` catches stale docs before merge
- **Incremental adoption**: Commands without enrichments still get a functional default page

## Impact

- **Users**: CLI documentation is now a first-class citizen in the docs site, accessible from sidebar navigation and homepage
- **Contributors**: Clear pattern for documenting new commands — create a `.mdx` enrichment file next to the Go source
- **CI**: Documentation freshness is verified on every PR touching CLI or docs

## Related Work

- React SDK docs pipeline (the proven pattern this mirrors)
- Proto SDK docs generator (the `docs/overview.md` co-location pattern)
- Content strategy project (vocabulary, registers, information architecture)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
