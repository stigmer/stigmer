# Fix Build Errors from env_spec-to-env Rename and Codegen Type References

**Date**: April 11, 2026

## Summary

Fixed three categories of build errors surfaced by `make check` after the `env_spec` to `env` field rename and the introduction of `EnvVarDeclaration` in the environment proto package. The fixes span CLI tests, MCP server codegen, and Go SDK codegen.

## Problem Statement

After the proto refactoring that renamed `env_spec` (typed `EnvironmentSpec`) to `env` (typed `map<string, EnvVarDeclaration>`) and relocated `EnvVarDeclaration` into the shared environment package, several downstream Go files still referenced the old field name or assumed the type lived in the wrong package.

### Pain Points

- `make check` failed in the stigmer OSS repo with three distinct compilation errors
- CLI test referenced the removed `EnvSpec` field on `McpServerSpec`
- MCP server codegen used a non-existent type-cast `ApiResourceKind_ApiResourceKind(22)` instead of the named enum constant
- Go SDK codegen files (`agent.go`, `mcpserver.go`, `workflow.go`) referenced `EnvVarDeclaration` from agent/mcpserver/workflow packages instead of the environment package where it actually lives

## Solution

Applied targeted fixes to each file without altering generated proto stubs or public APIs.

## Implementation Details

**1. CLI test fix** (`client-apps/cli/internal/cli/mcpserver/env_resolver_test.go`):
- Changed map type from `map[string]*envv1.EnvironmentValue` to `map[string]*envv1.EnvVarDeclaration`
- Changed struct field from `EnvSpec: &envv1.EnvironmentSpec{Data: data}` to `Env: data`

**2. MCP server codegen fix** (`mcp-server/gen/agentic/mcpserver/mcp_server_gen.go`):
- Replaced `apiresourcekind.ApiResourceKind_ApiResourceKind(22)` with `apiresourcekind.ApiResourceKind_oauth_app`

**3. Go SDK codegen fix** (`sdk/go/internal/gen/agent.go`, `mcpserver.go`, `workflow.go`):
- Added `environmentv1` import to all three files
- Changed `*agentv1.EnvVarDeclaration`, `*mcpserverv1.EnvVarDeclaration`, and `*workflowv1.EnvVarDeclaration` to `*environmentv1.EnvVarDeclaration`

## Benefits

- `make check` passes cleanly in both stigmer and stigmer-cloud repositories
- All 1499 Python tests, 102 TypeScript SDK tests, 128 React SDK tests, and Go tests pass
- Build, lint, typecheck, and site generation all succeed end-to-end

## Impact

- **Developers**: Unblocks the `feat/mcp-oauth-managed-credentials` branch from merge-blocking CI failures
- **Codegen**: Highlights that the code generator templates need updating to use the shared environment package for `EnvVarDeclaration` references

## Related Work

- [Clean env_spec removal and EnvVarDeclaration migration](2026-04-11-190513-clean-env-spec-removal-and-envvardeclaration-migration.md)
- [Migrate seedpack env_spec to env](2026-04-11-182114-migrate-seedpack-env-spec-to-env.md)
- [No-retry connect workflow and EnvVarDeclaration proto](2026-04-11-180042-no-retry-connect-workflow-and-envvardeclaration-proto.md)

---

**Status**: ✅ Production Ready
