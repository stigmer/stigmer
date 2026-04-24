# Add Context7 MCP Server to Seedpack Marketplace

**Date**: April 23, 2026

## Summary

Added Context7 as a curated MCP server in the Stigmer seedpack marketplace. Context7 provides up-to-date, version-specific library documentation and code examples that agents can pull directly into their context, preventing stale training data from producing hallucinated APIs or outdated code patterns.

## Problem Statement

LLM agents performing coding tasks rely on training data that may be months or years old. When working with rapidly evolving libraries (React, Next.js, Prisma, etc.), this leads to hallucinated APIs, deprecated patterns, and incorrect version-specific guidance.

### Pain Points

- Agents generate code using outdated library APIs that no longer exist
- Version-specific documentation is unavailable at inference time
- Users must manually correct agent output against current docs

## Solution

Added Context7 (53k+ GitHub stars, MIT licensed, actively maintained) to the seedpack as `mcp-server-context7`. The server exposes two MCP tools — `resolve-library-id` and `query-docs` — that let agents fetch current documentation on demand during code generation.

## Implementation Details

Two files created:

- `seedpack/mcp-servers/mcp-server-context7.yaml` — McpServer resource using HTTP transport (`https://mcp.context7.com/mcp`) with optional API key for higher rate limits
- `seedpack/icons/mcp-servers/context7.svg` — Brand icon extracted from Context7's official logo, adapted with `fill="currentColor"` for theme compatibility

Key decisions:
- **HTTP over stdio**: Context7's value is entirely in its remote documentation index; the npm package is just a local proxy. HTTP is more direct, avoids npm/npx dependency in agent runner environments, and matches the Tavily pattern.
- **Category: `developer-tools`**: Context7 is a coding-specific documentation retrieval tool, not a general web search engine.
- **Optional API key**: The server works without authentication at lower rate limits, lowering the barrier for new users.

## Benefits

- Agents can fetch current library documentation mid-conversation
- Reduces hallucinated API calls and outdated code patterns
- Zero-config for basic usage (API key optional)
- Consistent with existing seedpack conventions (HTTP transport, env declarations, SVG icon)

## Impact

All Stigmer users gain access to Context7 in the MCP marketplace after the next seedpack bootstrap cycle. Agents with Context7 connected can autonomously look up library documentation without user intervention.

## Related Work

- Existing search-category servers (Brave, Tavily, Exa) provide general web search; Context7 complements these with specialized library documentation retrieval
- MCP marketplace curation pipeline (`seedpack/mcp-servers/CONTRIBUTING.md`)

---

**Status**: Production Ready
