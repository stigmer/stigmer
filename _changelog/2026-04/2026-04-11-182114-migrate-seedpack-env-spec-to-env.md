# Migrate Seedpack from `env_spec.data` to `env`

**Date**: April 11, 2026

## Summary

Migrated all 32 seedpack MCP server YAML files from the deprecated `env_spec.data` nesting to the new flat `env` field backed by `EnvVarDeclaration`. Updated all seedpack documentation, skills, and agent instructions to reference `env` instead of `env_spec`, ensuring the platform's own agents generate correct YAML from day one.

## Problem Statement

The previous `env_spec.data.KEY` structure used `EnvironmentSpec` (a storage-oriented message) for declarations, adding an unnecessary `data` nesting level in YAML. The new `EnvVarDeclaration` proto (added in T02) provides a dedicated declaration message with proper `optional` semantics, but seedpack YAML files and all teaching materials (skills, docs) still used the old format.

### Pain Points

- YAML authors had to write `spec.env_spec.data.KEY` instead of the simpler `spec.env.KEY`
- No way to distinguish required vs optional env vars in blueprints
- Skills that teach agents to create MCP servers referenced the deprecated field, meaning AI-generated YAMLs would use the wrong format

## Solution

Flat migration of `env_spec.data` to `env` across the entire seedpack, with thoughtful classification of optional vs required env vars using the new `EnvVarDeclaration.optional` field.

## Implementation Details

### Part A: 32 MCP Server YAML Files

Mechanical transformation: lift each `env_spec.data.KEY` block up to `env.KEY`, remove the `env_spec` wrapper entirely. The field shape is nearly identical (`is_secret`, `description`) with the addition of `optional`.

Optionality classification applied to 4 vars across 3 files:
- `FASTMCP_LOG_LEVEL` (aws-cdk, aws-documentation) — log level with default, server works without it
- `AWS_PROFILE` (aws-lambda) — has a sensible default ("default")
- `MYSQL_PORT` (mysql) — has default 3306
- `MYSQL_DB` (mysql) — description explicitly says "omit for multi-database access"

All other ~36 vars remain required by default (the safe default — execution fails if missing rather than silently sending literal `${VAR_NAME}` placeholders).

### Part B: Documentation and Skill Coherence (9 files)

- `CONTRIBUTING.md` — updated templates and field table
- `mcp-server-creator.yaml` — agent instructions (3 references)
- `mcp-server-creator` skill — SKILL.md, schema.md, validation.md, examples.md
- `agent-creator` skill — SKILL.md, schema.md, examples.md

## Benefits

- YAML nesting reduced by one level: `spec.env_spec.data.KEY` → `spec.env.KEY`
- Environment variables can now be classified as required (default) or optional
- Platform agents generate correct, non-deprecated YAML
- Seedpack serves as the living reference for the new field format

## Impact

- **Seedpack**: 42 files changed (32 YAML + 9 docs/skills + 1 project tracker), net -22 lines
- **Runtime**: Zero impact — no consumer code reads `env` yet (T05 pending)
- **Backward compatibility**: The proto retains `env_spec` (deprecated) for existing user resources; consumer fallback logic will be added in T05

## Related Work

- Follows [no-retry-connect-workflow-and-envvardeclaration-proto](2026-04-11-180042-no-retry-connect-workflow-and-envvardeclaration-proto.md) which added the `EnvVarDeclaration` proto and deprecated `env_spec`
- Precedes T05 (consumer code fallback pattern) and T06 (required/optional enforcement in handlers)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
