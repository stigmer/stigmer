# Clean Removal of env_spec: Full Consumer Migration to EnvVarDeclaration

**Date**: April 11, 2026

## Summary

Removed the `env_spec` field entirely from McpServerSpec, AgentSpec, and WorkflowSpec proto definitions and migrated all consumers across Go, Java, Python, and TypeScript to read the new `env` field (`map<string, EnvVarDeclaration>`) directly. This clean break eliminates the architectural debt of overloading `EnvironmentValue` for both data storage and blueprint declarations, and makes the "blueprints carry zero values" invariant explicit in the type system.

## Problem Statement

Blueprint specs (McpServer, Agent, Workflow) used `env_spec` (type `EnvironmentSpec` with a `data` map of `EnvironmentValue` entries) to declare what environment variables they need. But `EnvironmentValue` was designed for the `Environment` resource — it carries a `value` field for actual secrets and config. On blueprints, the `value` was always empty (declarations don't hold secrets), making the type semantically wrong and confusing for both developers and the execution pipeline.

### Pain Points

- `EnvironmentValue.value` was always empty on blueprints but consumers had to handle it anyway
- No `optional` field — required vs optional was inferred from empty-value heuristics
- Extra nesting: YAML required `spec.env_spec.data.KEY` instead of `spec.env.KEY`
- The merge pipeline had a dead "template defaults" layer that never contributed any values
- `MergeMcpServerEnvSpecsStep` had to convert between same types with empty values (code smell)

## Solution

Clean break: remove `env_spec` from all three blueprint protos, give `env` the vacated field numbers, and update every consumer to read `EnvVarDeclaration` directly. No backward compat, no deprecated flags, no dual-write fallback logic.

## Implementation Details

### Proto changes (3 files)

- Removed `env_spec` (type `EnvironmentSpec`) from `McpServerSpec`, `AgentSpec`, `WorkflowSpec`
- Renumbered `env` to take `env_spec`'s field numbers: McpServerSpec=8, AgentSpec=7, WorkflowSpec=4
- Cleaned up comments on `McpServerAuth.target_env_var` and `StdioServerConfig.args` that referenced `env_spec`

### Go (stigmer repo — 14 files)

- **envmerge library**: `MergeEnvironmentLayers` — removed `templateData` parameter (merge is now 2-layer: environments + runtime). `FilterByEnvSpec` renamed to `FilterByDeclaredKeys` with `map[string]*EnvVarDeclaration` parameter.
- **Server controllers**: `connect.go`, `merge_mcp_env_specs.go`, both `create_execution_context_step.go` — all read `GetEnv()` directly.
- **CLI**: `discover.go`, `env_resolver.go`, `run_agent_exec.go` — use `GetEnv()` for key sets and `IsSecret` flags.
- **Tests**: envmerge tests, agent_controller_test.go, 3 mcp-server convert tests, workflow loader test — all fixtures use `Env`/`EnvVarDeclaration`.

### Java (stigmer-cloud repo — 8 files)

- **EnvironmentMergeService**: Removed `templateEnvSpec` parameter from `merge()`, renamed `filterByEnvSpec` → `filterByDeclaredKeys` with `Map<String, EnvVarDeclaration>`.
- **McpServerConnectHandler**: `resolveFromPersonalEnvironment()` accepts `Map<String, EnvVarDeclaration>` instead of `EnvironmentSpec`.
- **McpEnvironmentValidator**: `extractRequiredVariables()` uses `!declaration.getOptional()` — proper proto semantics instead of empty-value heuristic.
- **MergeMcpServerEnvSpecsStep**: Source and target are both `EnvVarDeclaration` — clean same-type copy, no synthetic empty-value conversion.
- **Tests**: MergeMcpServerEnvSpecsStepTest, McpEnvironmentValidatorTest — all fixtures use `putAllEnv()`/`EnvVarDeclaration`.

### Python (stigmer repo — 3 files)

- **config_transformer.py**: `spec.env_spec.data` → `spec.env` for key sets and platform injection.
- **setup.py**: Fixed pre-existing bug where `_extract_runtime_env_for_server` referenced `env_spec.variables` (does not exist on proto — the field was `env_spec.data`). Was silently failing via `AttributeError` catch, meaning MCP connect backfill never received per-server env vars.

### TypeScript (stigmer repo — ~15 files)

- Renamed `diffEnvSpec.ts` → `diffEnv.ts` with `optional?: boolean` on input type.
- Updated hooks (`useMcpServerCredentials`, `useMcpServerSetup`, `useAgentSetup`), detail views, YAML parse/serialize, site fixtures.
- YAML parser retains backward compat for reading old `env_spec.data` format.

### Codegen

- `make codegen` (stigmer): 101 files changed, regenerated stubs for Go/Java/Python/TypeScript/Dart plus SDK docs.
- `make protos` (stigmer-cloud): 45 files changed, regenerated stubs for all languages.

## Benefits

- **Type correctness**: Blueprint declarations use `EnvVarDeclaration` (schema); stored values use `EnvironmentValue` (data). Clean DDD separation.
- **Explicit optionality**: `EnvVarDeclaration.optional` replaces the empty-value heuristic. The validator uses `!declaration.getOptional()` — no more guessing.
- **Simpler merge**: `MergeEnvironmentLayers` is now 2-layer instead of 3-layer. The dead template-defaults layer is gone.
- **Simpler YAML**: `spec.env.KEY` instead of `spec.env_spec.data.KEY` — one nesting level removed.
- **Same-type merge step**: `MergeMcpServerEnvSpecsStep` copies `EnvVarDeclaration` → `EnvVarDeclaration` instead of converting `EnvironmentValue` to `EnvironmentValue` with empty value.
- **Bug fix**: Python connect backfill now actually receives per-server env vars (was silently broken).

## Impact

- **All blueprint consumers** across Go, Java, Python, TypeScript — every runtime path that reads env declarations
- **Seedpack YAMLs** — already migrated in T04 (prior session)
- **SDK codegen** — all four language SDKs regenerated
- **No user-facing API change** — the YAML parser accepts both old and new formats

## Related Work

- T01: No-retry policy for MCP connect workflow (same project)
- T02: Initial EnvVarDeclaration proto design (same project)
- T04: Seedpack YAML migration from env_spec.data to env (same project)
- T06: Enforce required/optional semantics at runtime (next task)

---

**Status**: Production Ready  
**Timeline**: ~3 hours (planning + implementation across 4 languages)
