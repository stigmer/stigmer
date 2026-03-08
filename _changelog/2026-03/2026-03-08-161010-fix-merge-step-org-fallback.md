# Fix MergeMcpServerEnvSpecs org Fallback to Agent's Own Org

**Date**: March 8, 2026

## Summary

Fixed the `MergeMcpServerEnvSpecs` pipeline step in both OSS (Go) and Cloud (Java) to fall back to the agent's own `metadata.org` when a `mcp_server_ref` has an empty `org` field, instead of silently skipping the MCP server lookup entirely. This resolves the issue where agents authored with omitted org on their MCP server references would end up with an empty `env_spec`.

## Problem Statement

Agent YAML files typically omit the `org` field on `mcp_server_ref` for same-org references — this is the expected authoring convention:

```yaml
mcp_server_usages:
  - mcp_server_ref:
      kind: mcp_server
      slug: mcp-server-planton    # org intentionally omitted
```

The `MergeMcpServerEnvSpecs` step, introduced earlier the same day, contained a guard condition that skipped the MCP server lookup when `org` was empty:

- **Go**: `if org == "" || slug == "" { continue }`
- **Java**: `if (org.isEmpty() || slug.isEmpty()) { continue; }`

### Pain Points

- The merge step silently skipped all MCP server lookups when `org` was empty on the reference, producing an agent with no `env_spec` and no error or warning
- The step was implicitly dependent on `NormalizeReferencesStep` having already filled the `org` field — a coupling that made the step fragile
- Real-world agent definitions (e.g., `infra-chart-composer`) never populated `env_spec` despite referencing MCP servers with declared env vars

## Solution

Changed the guard logic in both implementations: if `ref.org` is empty, fall back to `agent.metadata.org` before deciding to skip. Only skip if `slug` is empty (a lookup is impossible without a slug).

```go
slug := ref.GetSlug()
if slug == "" {
    continue
}

org := ref.GetOrg()
if org == "" {
    org = agent.GetMetadata().GetOrg()
}
if org == "" {
    continue
}
```

This makes the merge step self-sufficient — it works correctly regardless of whether `NormalizeReferencesStep` has already resolved the org.

## Implementation Details

### stigmer (OSS / Go)

- **Modified**: `backend/services/stigmer-server/pkg/domain/agent/controller/merge_mcp_env_specs.go` — replaced single `org == "" || slug == ""` guard with slug-first check and agent-org fallback
- **Modified**: `backend/services/stigmer-server/pkg/domain/agent/controller/agent_controller_test.go` — added `"merges env_spec when mcp_server_ref omits org"` integration test

### stigmer-cloud (Cloud / Java)

- **Modified**: `MergeMcpServerEnvSpecsStep.java` — identical guard logic change
- **Modified**: `MergeMcpServerEnvSpecsStepTest.java` — split `emptyOrgOrSlug` into `emptySlug` (still skips) and added `shouldFallbackToAgentOrgWhenRefOrgIsEmpty` (verifies merge via fallback)

## Benefits

- **Correct behavior on first apply**: Agents now get their `env_spec` populated from MCP servers even when the YAML omits `org` on references
- **Self-sufficient step**: The merge step no longer silently depends on `NormalizeReferencesStep` having run first
- **No behavioral change for explicit org**: References that already include `org` work exactly as before

## Impact

- **Agent authors**: `env_spec` is now correctly populated when using the standard convention of omitting `org` on same-org MCP server references
- **Seedpack bootstrap**: System agents get their `env_spec` merged on first startup without requiring normalized references
- **Execution reliability**: Agents like `infra-chart-composer` will no longer fail at execution time due to missing env var declarations

## Related Work

- [Auto-Merge MCP Server env_spec into Agent](2026-03-08-153740-merge-mcp-server-env-specs-into-agent.md) — the original feature this fixes
- [Dependency-Aware Resource Apply Ordering](2026-03-08-155319-dependency-aware-resource-apply-ordering.md) — ensures MCP servers exist before agents are applied

---

**Status**: ✅ Production Ready
**Timeline**: Single-session fix across both repositories
