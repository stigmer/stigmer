# Editor Integration Docs: Connect Stigmer to Claude Code, Cursor, and Claude Desktop

**Date**: June 3, 2026

## Summary

Added a new "AI editors" guides section documenting how to connect Stigmer's
hosted MCP server to AI editors and how to use Stigmer's creator Skills from
those editors. Two pages — one for the connector setup, one for Skills — fill a
gap where the docs told users to "add the Stigmer MCP server" or "use the
creator Skills" without ever explaining how.

## Problem Statement

The only place the hosted MCP endpoint (`https://mcp.stigmer.ai`) was documented
was the auto-generated `stigmer mcp-server` CLI reference, which is
command-focused and easy to miss. There was no task-oriented guide for someone
who just wants to wire Stigmer into their editor. Likewise, the Skills material
covered authoring and the web app, but never said where to download the creator
Skills or how different assistants pick them up.

### Pain Points

- No step-by-step for adding the connector to Claude Code, Cursor, or Claude
  Desktop — users had to reverse-engineer it from the CLI reference.
- The creator Skills (`agent-creator`, `workflow-creator`, `mcp-server-creator`,
  `skill-creator`) were referenced as something to "use," with no download
  links or install instructions.
- Claude Desktop's three modes (Chat, Cowork, Code) behave differently for
  Skills — folder auto-loading versus ZIP upload — and nothing captured that.

## Solution

A new `docs/guides/editors/` section with two task-oriented pages, registered in
the guides navigation ahead of the existing integrations content.

## Implementation Details

- `docs/guides/editors/connect-mcp.mdx` — connect the hosted MCP server to
  Claude Desktop (OAuth, no API key), Claude Code (`claude mcp add` with a Bearer
  header), and Cursor (`mcp.json`). Leads with the no-key OAuth path and scopes
  the API-key step to the header-based editors.
- `docs/guides/editors/skills.mdx` — how each assistant picks up Skills
  (`.claude/skills/` auto-loading for Code/Cursor/Cowork vs. ZIP upload under
  Customize → Skills for Claude Desktop Chat), a "Get the creator Skills" section
  with GitHub Seedpack download links, and how to author and push your own domain
  Skills with `stigmer push skill`.
- `docs/guides/editors/meta.json` plus an `"editors"` entry added to
  `docs/guides/meta.json`.
- Verified with `make lint-docs` (0 errors) and `make format-docs-check` (clean);
  prose follows the Stigmer term-capitalization style.

## Benefits

- A clear, copy-pasteable path from "I have a Stigmer account" to "my editor can
  see and build my resources."
- Honest, mode-specific guidance for Claude Desktop so users don't try folder
  auto-discovery in Chat mode (where it doesn't apply).
- Direct download links make the creator Skills actually obtainable.

## Impact

Affects documentation only. New readers onboarding through an AI editor; no code
or API surface changed.

## Related Work

Backs the Tiny Tactics client handoff README, which links to both pages for
connector setup and Skills.

---

**Status**: ✅ Production Ready
