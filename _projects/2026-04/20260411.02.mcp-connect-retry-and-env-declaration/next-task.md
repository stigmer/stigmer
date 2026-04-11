# Next Task: 20260411.02.mcp-connect-retry-and-env-declaration

## Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260411.02.mcp-connect-retry-and-env-declaration  
**Description**: Eliminate Temporal activity retries in MCP server connect workflow and introduce EnvVarDeclaration proto for required/optional env var semantics across all blueprint resources.  
**Goal**: Fix the 401 retry loop so errors surface immediately to the user, and design the EnvVarDeclaration proto to properly distinguish required vs optional env vars in McpServer, Agent, and Workflow specs.  
**Tech Stack**: Python/Temporal, Proto/Buf, Go, Java, TypeScript/React  
**Components**: agent-runner (Python), environment proto, mcpserver/agent/workflow protos, seedpack YAML, Go/Java/Python/TypeScript consumers

**Created**: 2026-04-11  
**Type**: Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration
```

---

## Essential Files

### Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration/tasks.md
```

### Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration/README.md
```

### Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration/notes.md
```

---

## Current State

- **Status**: completed (T01-T06 all done)
- **Last Session**: 2026-04-11 — T06 completed (enforce required/optional semantics across all layers)
- **Active Task**: None — project complete

## Session Progress (2026-04-11, Session 4 — T06)

- **Design principle**: "Required vars gate; optional vars ride along"
- **Bug fix**: Java `MergeMcpServerEnvSpecsStep` was dropping `optional` flag — all MCP-sourced vars appeared required at Agent level
- **Go backend**: `connect.go` skips optional vars when missing; new `envmerge.ValidateRequiredKeys` function with 8 test cases; both execution context steps validate required keys post-merge
- **Java backend**: `McpServerConnectHandler` skips optional vars; `MergeMcpServerEnvSpecsStep` now preserves `optional` flag
- **Frontend**: `diffEnv` populates `optional`; `useMcpServerCredentials` and `useMcpServerSetup` only block on required vars; `EnvSection` shows `optional` badge; `EnvVarFormVariable` has `optional` field for future extensibility

## Session Progress (2026-04-11, Session 3 — T05)

- **Design change**: Replaced the original "env-first, fallback-to-env_spec" plan with a clean break — env_spec removed entirely from protos, no backward compat, no deprecated flags
- **Proto cleanup**: Removed env_spec from McpServerSpec, AgentSpec, WorkflowSpec. Renumbered env to take env_spec's field numbers (McpServerSpec=8, AgentSpec=7, WorkflowSpec=4)
- **Codegen**: Regenerated all stubs across both repos (stigmer: 101 files, stigmer-cloud: 45 files)
- **Go envmerge library**: Removed templateData param from `MergeEnvironmentLayers` (merge is now 2-layer: environments + runtime). Renamed `FilterByEnvSpec` → `FilterByDeclaredKeys` with `map[string]*EnvVarDeclaration` param
- **Go consumers**: Updated connect.go, merge_mcp_env_specs.go, both create_execution_context_step.go, CLI discover.go, env_resolver.go, run_agent_exec.go
- **Go tests**: Updated envmerge tests, agent_controller_test.go, 3 mcp-server convert tests, workflow loader test
- **Java consumers**: Updated EnvironmentMergeService (removed template param, renamed filter), McpServerConnectHandler, McpEnvironmentValidator (uses `!optional` for required check), MergeMcpServerEnvSpecsStep, both CreateExecutionContextStep
- **Java tests**: Updated MergeMcpServerEnvSpecsStepTest, McpEnvironmentValidatorTest
- **Python consumers**: Updated config_transformer.py (spec.env), fixed pre-existing bug in setup.py (_extract_runtime_env_for_server referenced nonexistent env_spec.variables)
- **TypeScript consumers**: Renamed diffEnvSpec→diffEnv, updated hooks (credentials/setup/agentSetup), detail views (McpServerDetailView, AgentDetailView), YAML parse/serialize, site fixtures

## Session Progress (2026-04-11, Session 5 — Post-completion bug fix)

### Three bugs discovered during end-to-end OAuth connect testing:

**Bug 1 (P0)**: `McpServerConnectHandler.resolveEnvironmentVariables()` hardcoded `identityAccountId = ""` — the OAuth grant lookup always returned empty because the grant is keyed by the real caller identity. Fixed by passing `invokerIdentityAccountId` from the pipeline context.

**Bug 2 (P1)**: 10 `DeleteOperationHandlerV2` pipelines were missing `commonSteps.extractResourceId` before `deleteSteps.loadExisting`. This broke all direct delete RPCs for those resource types. Fixed by adding the step to all 10 handlers.

**Bug 3 (P1)**: React SDK connect hooks (`useMcpServerConnect`, `useMcpServerOAuthConnect`) blanket-injected `STIGMER_SERVER_ADDRESS` and `STIGMER_API_KEY` into every connect call. This caused `hasRuntimeEnv=true` which set `tolerateMissing=true`, silently suppressing missing credential errors. Fixed by adding `resolveDeclaredSystemEnvVars()` that filters system vars by the target server's `spec.env` declarations.

### Verified against production MongoDB:
- OAuth grant exists with correct identity (`ida_01kmjcvg8w03h86dzj8tyfv8b4`)
- Managed environment has `SLACK_ACCESS_TOKEN` stored
- Orphaned execution context confirmed with only 2 platform vars (no `SLACK_ACCESS_TOKEN`)
- Cleaned up orphaned execution context and IAM policy documents

### Commits:
- stigmer: `fix(sdk): filter system env vars by server declarations in connect hooks`
- stigmer-cloud: `fix(backend): pass caller identity to OAuth grant lookup and add extractResourceId to 10 delete handlers`

## Project Complete

All 6 tasks (T01-T06) are done plus post-completion bug fixes. The `EnvVarDeclaration.optional` flag is now consistently enforced across:
- Go backend: connect handler, envmerge validation, agent/workflow execution context steps
- Java backend: connect handler, MCP→Agent env merge, McpEnvironmentValidator (T05)
- Frontend: diffEnv, useMcpServerCredentials, useMcpServerSetup, EnvSection badge
