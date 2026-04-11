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

- **Status**: in-progress (T01-T05 done, T06 remaining)
- **Last Session**: 2026-04-11 — T05 completed (clean removal of env_spec, full consumer migration)
- **Active Task**: T06 (next to start)

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

## Next Steps

1. T06: Enforce required/optional semantics in Java and Go connect/execution handlers
   - Go connect.go: skip optional vars in `resolveFromPersonalEnvironment` when missing
   - Java McpServerConnectHandler: same
   - Java McpEnvironmentValidator: already uses `!declaration.getOptional()` (done in T05)
   - Go/Java execution context steps: validate required vars are present before creating ExecutionContext

## Context for Resume

- **env_spec is completely gone** from all protos, consumer code, tests, seedpack, and docs
- All consumers read `env` (type `map<string, EnvVarDeclaration>`) directly — no fallback logic
- `EnvironmentSpec` and `EnvironmentValue` still exist for the `Environment` resource (stored values), which is correct
- `MergeEnvironmentLayers` is now 2-layer (environments + runtime); template defaults removed since `EnvVarDeclaration` has no `value` field (by design: blueprints declare needs, not values)
- `McpEnvironmentValidator.extractRequiredVariables()` already uses `!declaration.getOptional()` from T05
- YAML parser (`parse-resource-yaml.ts`) retains backward compat for reading old `env_spec.data` YAML

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] T06 is the only remaining task
3. [ ] Focus: enforce `optional` flag semantics in connect and execution handlers
