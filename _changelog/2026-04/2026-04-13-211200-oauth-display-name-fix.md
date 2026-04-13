# Fix "O Auth App" Display Name in Proto SDK Docs Codegen

**Date**: April 13, 2026

## Summary

Fixed the `docDisplayName` function in the proto SDK docs generator to produce
"OAuth App" instead of "O Auth App". The function's camelCase splitting logic
treated `OAuthApp` as three separate words (`O`, `Auth`, `App`) because it
inserts a space before every uppercase letter. Added `OAuth` to the
post-processing replacement list alongside the existing `MCP`, `API`, and `IAM`
fixes. Added unit tests for `docDisplayName` and `docSlug` — no tests existed
previously.

## Problem Statement

The `docDisplayName` function in `tools/codegen/generator/sdk_docs.go` converts
PascalCase proto type names to human-readable display names by inserting a space
before each uppercase letter. It already had post-processing replacements for
three acronyms (`Mcp` → `MCP`, `Api` → `API`, `Iam` → `IAM`), but `OAuth` was
not handled.

### Pain Points

- The SDK resource reference page title displayed as "O Auth App"
- The generated file slug was `o-auth-app` instead of `oauth-app`
- Code examples used `my-o-auth-app` as the example resource name
- The `meta.json` entry listed `o-auth-app`

## Solution

Added one replacement line to `docDisplayName`:

```go
name = strings.ReplaceAll(name, "O Auth", "OAuth")
```

Unlike the existing replacements (which re-capitalize acronyms while preserving
the trailing space), this one **merges** two tokens back into the compound word
"OAuth". Placed before the existing acronym replacements to ensure correct
ordering.

## Implementation Details

### Codegen fix

Single line added to `tools/codegen/generator/sdk_docs.go` in the
`docDisplayName` function. The fix cascades through `docSlug` and
`docExampleResourceName` automatically:

- Display name: `O Auth App` → `OAuth App`
- Slug / filename: `o-auth-app.mdx` → `oauth-app.mdx`
- URL path: `/sdk/resources/o-auth-app` → `/sdk/resources/oauth-app`
- Example resource names: `my-o-auth-app` → `my-oauth-app`
- `meta.json` entry: `o-auth-app` → `oauth-app`

### Unit tests

Created `tools/codegen/generator/sdk_docs_test.go` with table-driven tests for
`docDisplayName` (9 cases) and `docSlug` (7 cases). Covers standard camelCase
splitting, all four acronym replacements, and compound word merging.

### Regeneration

Ran `make gen-proto-sdk-docs` to regenerate all 20 resource MDX files and
`meta.json`. Deleted stale `o-auth-app.mdx`. Build verified with `yarn build`.

## Benefits

- Correct display name ("OAuth App") on the SDK resource reference page
- Clean URL path (`/sdk/resources/oauth-app`)
- Idiomatic example resource names in generated code snippets
- Unit test coverage for display name and slug generation (previously untested)

## Impact

- **SDK reference docs**: OAuth App resource page now displays correctly
- **URLs**: Path changed from `/sdk/resources/o-auth-app` to
  `/sdk/resources/oauth-app` (no existing cross-links affected — verified via
  grep)
- **Generated files**: `oauth-app.mdx`, `meta.json`, `mcp-server.mdx`
  (regeneration picked up T07's overview.md update)

---

**Status**: ✅ Production Ready
