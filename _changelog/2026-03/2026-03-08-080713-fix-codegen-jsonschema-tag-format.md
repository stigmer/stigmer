# Fix MCP Server Startup Panic Caused by Invalid jsonschema Struct Tags

**Date**: March 8, 2026

## Summary

The Stigmer MCP server was panicking on startup because the codegen tool emitted `jsonschema` struct tags in a `key=value` format (`required,description=...`) that `google/jsonschema-go` v0.4.2 rejects. Fixed the codegen to emit plain description strings, restoring successful server startup across all 16 generated resource packages.

## Problem Statement

Running `stigmer discover mcp-server mcp-server-stigmer` produced:

```
panic: AddTool: tool "apply_agent": input schema: ForType(agent.AgentInput):
  tag must not begin with 'WORD=': "required,description=Human-readable name of the resource."
```

The MCP Go SDK v1.3.0 uses `google/jsonschema-go` v0.4.2's `ForType()` to generate JSON schemas from Go struct types. That library treats the `jsonschema` struct tag as a **plain description string only** — the entire tag value becomes the field's `description` property.

### Pain Points

- MCP server could not start at all — complete startup failure
- Every `apply_*` and some `get_*` tools were affected (any tool with generated input structs)
- The `discover` CLI command could not connect to the server, blocking all MCP-based agent workflows

## Solution

Updated three tag-generation sites in the `stigmer-codegen` tool (`tools/codegen/generator/mcp.go`) to emit tags compatible with `google/jsonschema-go` v0.4.2's tag contract:

1. **`buildJsonSchemaTag()`** — Removed `required` keyword (auto-inferred from `json` tag without `omitempty`), removed `description=` prefix, and folded `enum` values into the description text as "Allowed values: X, Y, Z."
2. **Hardcoded identity fields in `genStruct()`** — Stripped `required,description=` and `description=` prefixes from the six top-level fields (Name, Slug, Org, Visibility, Labels, Tags).
3. **`expandedConfigField()`** — Stripped `description=` prefix from workflow task config fields.

Regenerated all 16 `gen/*_gen.go` packages.

## Implementation Details

The root cause was in `google/jsonschema-go@v0.4.2/jsonschema/infer.go`:

```go
if disallowedPrefixRegexp.MatchString(tag) {  // regexp: ^[^ \t\n]*=
    return nil, fmt.Errorf("tag must not begin with 'WORD=': %q", tag)
}
fs.Description = tag  // entire tag value IS the description
```

**Before** (panic):
```go
Name string `json:"name" jsonschema:"required,description=Human-readable name of the resource."`
```

**After** (working):
```go
Name string `json:"name" jsonschema:"Human-readable name of the resource."`
```

The `required` semantic was already correctly handled by the `json` tag — fields without `omitempty` are automatically added to the schema's `required` array by the library.

## Benefits

- MCP server starts successfully and all tools register without panic
- All 16 generated packages produce valid JSON schemas
- Field descriptions are preserved in the schema (important for LLM tool understanding)
- Required field semantics are maintained via the `json` tag convention
- All existing tests pass (build + test verified)

## Impact

- **MCP Server**: Fully operational again — all `apply_*`, `get_*`, `delete_*`, and `search` tools register correctly
- **Codegen**: Future regenerations will produce correct tags
- **Downstream**: Any agent or workflow that relies on the Stigmer MCP server is unblocked

## Related Work

- Triggered by upgrade to `modelcontextprotocol/go-sdk` v1.3.0 which switched from the legacy `jsonschema-go` package to `google/jsonschema-go/jsonschema` sub-package with stricter tag validation

---

**Status**: ✅ Production Ready
