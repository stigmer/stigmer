# CLI Org Context: Global Flag, Runtime Injection, and Skill Doc Cleanup

**Date**: March 3, 2026

## Summary

Promoted `--org` from a per-command flag to a single root persistent flag, injected `STIGMER_ORG_ID` into agent execution and SDK synthesis environments, and updated all seedpack skill docs to use the injected org instead of asking the user or hardcoding "local". Also removed the speculative `ContextConfig.Environment` field.

## Problem Statement

### Pain Points

- `--org` was duplicated across 11+ CLI commands and in `agentExecFlags`, violating DRY and creating maintenance burden
- Agents executing via `stigmer run` and `stigmer draft` had no way to know which organization they were operating in — generated resources couldn't automatically inherit the correct org
- Draft agents (agent-creator, mcp-server-creator) asked users "What org?" or hardcoded `org: local`, breaking the seamless context experience
- `ContextConfig.Environment` was speculative dead code with no domain semantics

## Solution

Four coordinated changes that together create a seamless org context flow from CLI through agent execution:

1. **Root persistent flag**: Single `--org` definition on root command, read via `GetOrgFlag(cmd)` helper
2. **Runtime injection**: Inject `STIGMER_ORG_ID` into agent `RuntimeEnv` (for `run`/`draft`) and SDK synthesis environment (for `apply`)
3. **Skill doc update**: Draft agents read `STIGMER_ORG_ID` from their environment instead of asking or hardcoding
4. **Dead code removal**: Removed `ContextConfig.Environment`

## Implementation Details

### Root Persistent Flag
- Added `rootCmd.PersistentFlags().String("org", ...)` in `root.go`
- Created `GetOrgFlag(cmd *cobra.Command) string` helper in `verb_helpers.go`
- Removed per-command `--org` flag from: apply, get, list, delete, push, search, discover
- Removed `--org` from `registerAgentExecFlags()`; run/draft handlers set `OrgOverride` from `GetOrgFlag(cmd)` in their closures

### STIGMER_ORG_ID Injection
- `prepareAgentExec()`: After `connectToBackend()` resolves orgID, injects `STIGMER_ORG_ID` into `runtimeEnv` (only if not already set by user via `--env`)
- `synthesize.go`: Added `OrgID` field to `SynthesizeOptions`, injected as env var alongside `STIGMER_OUT_DIR`
- Restructured `executeProjectApply()` to resolve org before synthesis, replacing `establishBackendConnection` with early config load + `connectAndEnsureDaemon`

### Seedpack Skill Doc Updates (10 files)
- Removed org questions from Phase 1 (agent-creator) and Step 1 (mcp-server-creator)
- Replaced all `org: local` in YAML examples with `<STIGMER_ORG_ID>` references
- Updated schema docs, validation checklists, and agent integration guides
- Eliminated the false "local mode vs cloud mode" distinction for org identity

## Benefits

- **Zero flag duplication**: Single `--org` definition point, following `kubectl --namespace` pattern
- **Seamless agent context**: Agents automatically know their operating org without user intervention
- **Consistent generated resources**: Draft agents produce YAML with correct org from context
- **Cleaner config surface**: Removed speculative Environment field
- **Net code reduction**: +125/-128 lines across 30 files

## Impact

- **CLI users**: `--org` works on any command, consistent behavior everywhere
- **Agent authors**: `STIGMER_ORG_ID` is always available in the agent runtime environment
- **Draft users**: `stigmer draft agent` and `stigmer draft mcp-server` auto-fill org without asking
- **SDK users**: SDK synthesis programs can read `STIGMER_ORG_ID` for default org in generated resources

## Related Work

- Builds on T01.7 (Unified Organization Context and CLI Defaults) which established the org resolution chain
- Builds on T01.6 (Seedpack Updates) which bootstrapped the default Organization resource
- Part of the org-tenancy-portable-resources project (T01.1–T01.9)

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
