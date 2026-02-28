# Auto-Resolve MCP Server Credentials for `stigmer run`

**Date**: February 28, 2026

## Summary

Extended the well-known credential resolution (GITHUB_TOKEN, PLANTON_API_KEY, STIGMER_SERVER_ADDRESS, STIGMER_API_KEY) to the `stigmer run` command. MCP servers used during agent and workflow executions can now authenticate automatically using locally available credentials without requiring manual `--env` flags.

## Problem Statement

After the initial credential resolution work (post-apply discovery, daemon bootstrap), there was a gap: MCP servers could be discovered automatically using local credentials, but the same credentials were not available when an agent actually executed. Users had to manually pass `--env GITHUB_TOKEN=$(gh auth token)` to every `stigmer run` invocation, even though the CLI already knew how to resolve these tokens.

### Pain Points

- Users with `gh` CLI authenticated still had to manually pass `GITHUB_TOKEN` to agent runs
- Users with Planton CLI authenticated still had to manually pass `PLANTON_API_KEY`
- The credential resolution logic existed but was only wired to the discovery path

## Solution

Reused the existing `resolveKnownVar()` infrastructure to auto-resolve well-known credentials before creating an agent or workflow execution. Auto-resolved values are merged as the lowest priority source — user-provided `--env`, `--secret`, `--env-file`, and `--secret-file` flags always take precedence.

## Implementation Details

### New Function: `ResolveWellKnownEnv` (`env_resolver.go`)

- Iterates all well-known variable names unconditionally (not scoped to a specific MCP server's `env_spec`)
- Skips variables already present in `os.Environ()` (shell environment takes priority)
- Returns `envfile.EnvMap` with proper `IsSecret` flags on each value
- Reuses the existing `resolveKnownVar()` switch for actual resolution

### Secret Classification

- `GITHUB_TOKEN` — secret (credential)
- `PLANTON_API_KEY` — secret (credential)
- `STIGMER_API_KEY` — secret (credential)
- `STIGMER_SERVER_ADDRESS` — not secret (server address)

Defined via `wellKnownVars` slice and `secretVars` map at package level, serving as the single source of truth.

### Merge Priority

```
Auto-resolved credentials (lowest)
  ← --env-file values override
    ← --secret-file values override
      ← --env flags override
        ← --secret flags override (highest)
```

Implemented using the existing `envfile.MergeEnvSources(autoEnv, userEnv)`.

### Integration in `executeRun()` (`run.go`)

Added Step 5.5 between environment loading (Step 5) and backend connection (Step 6). Loads CLI config via `config.Load()`, calls `ResolveWellKnownEnv`, and merges the result. Both the agent and workflow execution paths benefit since the merge happens before routing.

### Files Changed

- `client-apps/cli/internal/cli/mcpserver/env_resolver.go` — `ResolveWellKnownEnv()`, `isSecretVar()`, `wellKnownVars`, `secretVars`
- `client-apps/cli/cmd/stigmer/root/run.go` — `resolveAndMergeAutoEnv()` helper, Step 5.5 in `executeRun()`
- `client-apps/cli/internal/cli/mcpserver/BUILD.bazel` — Added `executioncontext/v1` and `envfile` deps
- `client-apps/cli/internal/cli/mcpserver/env_resolver_test.go` — 7 new tests

## Design Decisions

### Why `runtime_env` and not a new `ambient_env` field

`runtime_env` is the highest merge priority in the backend (`Agent defaults < Environment refs < runtime_env`). Auto-resolved credentials placed here can override org-configured Environment resource values. This is architecturally imprecise but practically correct for the primary use case (local development). In CI/CD, auto-resolution returns empty (no `gh` CLI, no local credential files), so Environment refs naturally win. The correct long-term architecture is a new `ambient_env` field on `AgentExecutionSpec` with its own merge tier, but that requires proto and backend changes — deferred until the priority inversion actually causes problems.

### Why config is loaded separately

`connectToBackend()` already loads config internally but doesn't return it. Rather than changing its signature (which would require updating 4 call sites), we load config separately via `config.Load()`. This is a cheap YAML file read with negligible performance impact.

## Benefits

- **Zero-friction agent runs** — `stigmer run agent my-agent` works with GitHub/Planton MCP servers out of the box if the user has the respective CLIs authenticated
- **Consistent with discovery** — Same credential sources used for discovery are now used for execution
- **User always wins** — Explicit `--env`/`--secret` flags override auto-resolved values
- **Proper secret handling** — Auto-resolved credentials are marked as secrets (encrypted at rest, redacted in logs)

## Impact

- **End users**: MCP servers used by agents "just work" without manual credential passing
- **CLI maintainers**: Adding new credential sources requires only a new case in `resolveKnownVar()`, an entry in `wellKnownVars`, and a secret classification in `secretVars`
- **Platform**: Extends the credential bridging pattern from discovery to execution

## Related Work

- MCP Server Credential Resolution and Post-Apply Discovery (2026-02-28)
- Environment resource merge logic (`EnvironmentMergeService`)

---

**Status**: Production Ready
**Timeline**: Single session
