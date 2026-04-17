# Ink SDK CLI Integration Guide

**Date**: April 17, 2026

## Summary

Added a dedicated how-to guide for embedding Stigmer agent sessions in CLIs written in Go, Rust, and Python by spawning `@stigmer/ink` as a child process. The existing CLI integration section was a brief teaser; platform builders had no clear documentation on how to replicate the pattern the Stigmer CLI itself uses.

## Problem Statement

The Ink SDK docs included a 30-line "CLI integration" section with a bash one-liner and a Node.js `spawn` example. Platform builders writing CLIs in Go, Rust, or Python — the dominant CLI languages — had no guidance on how to spawn the Ink renderer, wire terminal streams, pin versions, or handle the process lifecycle.

### Pain Points

- No Go code example despite the Stigmer CLI being written in Go
- No Rust or Python examples for the two other major CLI ecosystems
- No explanation of the architecture boundary between parent CLI and Ink process
- No documentation of version pinning, TTY detection, or post-exit state queries
- No parameter reference table for the `stigmer-ink` binary flags

## Solution

Created a new how-to page (`docs/sdk/ink/cli-integration.mdx`) that documents the complete spawn-and-render pattern with examples in Go, Rust, and Python. Updated the Ink SDK overview to link to it, wired it into the sidebar via the docs generator, and cross-linked from the `stigmer run` CLI reference.

## Implementation Details

- **New page**: `docs/sdk/ink/cli-integration.mdx` — covers how-it-works, parameter reference, Go/Rust/Python examples, version pinning, and TTY behavior
- **Ink SDK overview**: trimmed CLI integration section to a teaser with link to the new page; added "Embed in your CLI" card to the navigation footer
- **Docs generator**: updated `renderMetaJson()` in `site/scripts/generate-ink-sdk-docs/renderer.ts` to include `cli-integration` in the generated `meta.json` so it survives regeneration
- **CLI docs cross-link**: updated the `stigmer run` enrichment template output modes table to describe the default mode as "Interactive terminal UI powered by @stigmer/ink" with a link

## Benefits

- Platform builders can now integrate Stigmer terminal rendering into their CLIs in under 10 minutes
- The documentation matches the real pattern used by the Stigmer CLI, grounded in actual production code
- Version pinning and TTY handling guidance prevents common integration pitfalls

## Impact

- SDK documentation consumers building custom CLIs
- `docs/sdk/ink/` section now has three pages (overview, CLI integration, reference) instead of two
- Cross-links from CLI reference docs improve discoverability

## Related Work

- Ink SDK reference documentation (`2026-04-16-151101-ink-sdk-reference-documentation.md`)
- CLI Ink integration TUI replacement (`2026-04-16-112010-cli-ink-integration-tui-replacement.md`)
- CLI reference documentation (`2026-04-16-143257-cli-reference-documentation.md`)

---

**Status**: Production Ready
