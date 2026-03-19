# Backend env_spec Whitelist Filter (Go + Java)

**Date**: March 19, 2026

## Summary

Added env_spec-based whitelist filtering to the environment merge pipeline in both Go (stigmer OSS) and Java (stigmer-cloud) backends. Agents and workflows now only receive environment variables they explicitly declare in their `env_spec`, enforcing a least-privilege security boundary at the execution context creation layer.

## Problem Statement

The environment merge pipeline (`MergeEnvironmentLayers` / `EnvironmentMergeService.merge`) combines variables from three layers: template env_spec defaults, linked environment resources, and runtime overrides. The merged result was passed directly into the `ExecutionContext` without filtering — every variable from every layer reached the agent/workflow runtime.

### Pain Points

- **Least-privilege violation**: An agent declaring `GITHUB_TOKEN` in its env_spec would also receive `AWS_SECRET_KEY`, `DATABASE_URL`, and every other variable present in linked environments or runtime overrides.
- **Secret leakage surface**: As personal environments accumulate secrets across multiple agent interactions, the unfiltered merge creates an expanding attack surface.
- **No enforcement point**: The env_spec was used for default value injection and UI form generation, but never as a security boundary.

## Solution

A post-merge filter function that retains only variables whose keys appear in the agent/workflow's `env_spec.data` map. The filter is a separate, pure function (not merged into the existing merge logic) to maintain single responsibility and enable explicit composition with logging.

The filter applies to both agent and workflow execution contexts across both Go and Java services, with a backward-compatibility guard: if `env_spec` is nil or empty, all variables pass through unchanged.

## Implementation Details

### Go (stigmer OSS)

**New function** in `backend/libs/go/envmerge/merge.go`:

```go
func FilterByEnvSpec(
    merged map[string]*executioncontextv1.ExecutionValue,
    envSpecData map[string]*environmentv1.EnvironmentValue,
) (filtered map[string]*executioncontextv1.ExecutionValue, excludedKeys []string)
```

- Returns filtered map + sorted excluded keys for deterministic logging
- Applied in `agentexecution/controller/create_execution_context_step.go`
- Applied in `workflowexecution/controller/create_execution_context_step.go`
- Warn-level log emitted when keys are excluded

**Tests** in `backend/libs/go/envmerge/merge_test.go` (new file):
- 12 retroactive tests for `MergeEnvironmentLayers` (previously zero coverage)
- 8 tests for `FilterByEnvSpec` (backward compat, whitelist, empty env_spec values, sorted excluded keys)
- `BUILD.bazel` updated with `go_test` rule

### Java (stigmer-cloud)

**New method** in `EnvironmentMergeService.java`:

```java
public record EnvSpecFilterResult(
    Map<String, ExecutionValue> filtered,
    List<String> excludedKeys
) {}

public static EnvSpecFilterResult filterByEnvSpec(
    Map<String, ExecutionValue> merged,
    @Nullable EnvironmentSpec envSpec)
```

- Applied in agent `CreateExecutionContextStep.java` — placed **between** merge and `McpEnvironmentValidator`
- Applied in workflow `CreateExecutionContextStep.java` — same pattern
- Warn-level log emitted when keys are excluded

**Tests** in `EnvironmentMergeServiceTest.java`:
- 7 new tests in `FilterByEnvSpecTests` nested class

### Key Design Decision: Filter Before MCP Validation (Java)

The Java service has `McpEnvironmentValidator` that checks whether all required MCP server variables are present. The env_spec filter is applied **before** MCP validation. This means if an agent references an MCP server but forgets to declare the server's required variables in its env_spec, the filter removes them and MCP validation fails fast with a clear error — rather than silently passing the wrong variables to the agent runtime.

## Benefits

- **Security**: Enforces least-privilege at the merge layer — agents only see what they declare
- **Backward compatible**: nil/empty env_spec = no filtering (all existing agents/workflows unaffected)
- **Observable**: Excluded keys are logged at warn level for debugging misconfigured agents
- **Consistent**: Identical behavior across Go and Java, agent and workflow execution paths
- **Testable**: Pure function with no side effects, comprehensive test coverage in both languages

## Impact

- **Agent/workflow execution**: All execution context creation paths now filter by env_spec
- **Personal environments**: Secrets added to personal environments via `addVariables` are only exposed to agents that declare those variable names in their env_spec
- **Platform builders**: No API changes — filtering is internal to execution context creation
- **Existing agents**: Zero behavior change for agents with empty env_spec (backward compat guard)

## Related Work

- [Agent Env Form and Session Composer Integration](2026-03-19-182911-agent-env-form-and-session-composer-integration.md) — Phase 2 frontend that collects env vars based on env_spec
- [Sentinel Defense and React Variable Hooks](2026-03-19-175628-sentinel-defense-and-react-variable-hooks.md) — Backend sentinel defense for variable management
- [Env Variable Management RPCs](2026-03-19-174018-env-variable-management-rpcs.md) — updateVariables/removeVariables RPCs

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
