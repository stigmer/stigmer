# Use "Apply" Terminology for MCP Server Demo

**Date**: April 3, 2026

## Summary

Replaced "push" with "apply" across the MCP server creation tour demo and its documentation page. "Push" is skill-specific language; non-skill resources such as MCP servers use "apply" to save configurations to the organization library.

## Problem Statement

The MCP server creation demo reused the same "push" terminology from the skill creation tour. This was inconsistent with the product's resource vocabulary, where "push" is reserved for skills and "apply" is the correct verb for other resource types like MCP servers.

### Pain Points

- Demo button read "Push MCP Server to acme" instead of "Apply MCP Server to acme"
- Step caption said "Push to save" instead of "Apply to save"
- AI conversation message told users to "push to save"
- Documentation page referenced clicking **Push** to save

## Solution

Updated all user-facing text in the MCP server creation tour to use "apply" while keeping the skill creation tour unchanged with its correct "push" terminology.

## Implementation Details

Three files changed:

- **`mcp-server-creation-tour/steps.ts`** — Updated the `McpCreationStep` union type (`push-mcp-server` → `apply-mcp-server`), the AI conversation message, and the step caption
- **`mcp-server-creation-tour/index.tsx`** — Changed the artifact `pushLabel` value and updated all switch-case references to the renamed view
- **`docs/getting-started/connect-tools.mdx`** — Changed "click **Push**" to "click **Apply**" in the step-by-step instructions

## Benefits

- Consistent terminology across resource types
- Demo accurately reflects the product's UI language for MCP servers
- Reduces confusion for users reading the getting-started guide

## Impact

Affects the "Connect your tools" getting-started page and its interactive demo. No changes to the skill creation tour or shared component code.

---

**Status**: ✅ Production Ready
