# Next Task: 20260411.02.mcp-connect-retry-and-env-declaration

## 🎯 Quick Resume Instructions

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
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260411.02.mcp-connect-retry-and-env-declaration/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Root Cause Analysis (from investigation)

### The Error

`DiscoverMcpServerCapabilities` activity retries 5+ times with `401 Unauthorized` from `https://mcp.slack.com/mcp`. Logs show:

```
Resolved 2 env var(s) from ExecutionContext 'connect-mcp_01knvntehb9prm2bb2gx9q3q6h-e43ce4f2'
Unresolved placeholder ${SLACK_ACCESS_TOKEN} - ensure this variable is provided in the environment (header 'Authorization')
```

### Why SLACK_ACCESS_TOKEN is missing

1. SDK sends `runtime_env` with system vars (e.g., `STIGMER_SERVER_ADDRESS`) alongside the connect request
2. Java handler `McpServerConnectHandler.resolveFromPersonalEnvironment()` runs with `tolerateMissing=true` (because `hasRuntimeEnv=true`)
3. `SLACK_ACCESS_TOKEN` is missing from personal env (OAuth flow not completed for this user)
4. Missing key is **silently skipped** (debug log only)
5. `PlaceholderResolver` in **lenient mode** (`strict=False`) converts `Bearer ${SLACK_ACCESS_TOKEN}` into the literal string `Bearer ${SLACK_ACCESS_TOKEN}`
6. Literal is sent as the Authorization header -> 401 Unauthorized

### Why it retries 5+ times

`workflow.execute_activity()` calls in `ConnectMcpServerWorkflow` have **no `retry_policy`**, so Temporal uses its default: unlimited retries with exponential backoff (1s, 2s, 4s, 8s...).

---

## Design Decisions

### Phase 1: No-retry policy

Set `RetryPolicy(maximum_attempts=1)` on all activity calls. Connect is user-triggered and synchronous. 401 is deterministic.

### Phase 2: EnvVarDeclaration proto

**Decision:** Option B2 -- shared `EnvVarDeclaration` in environment package. All blueprint resources (McpServer, Agent, Workflow) benefit.

**Why not just add `optional` to `EnvironmentValue`?** `EnvironmentValue` is shared between storage (Environment resource) and declaration (blueprint env_spec). The `optional` concept only applies to declarations. A dedicated declaration message provides clean DDD separation.

### Proto changes

New message in `environment/v1/spec.proto`:
```proto
message EnvVarDeclaration {
  bool is_secret = 1;
  string description = 2;
  bool optional = 3;  // false (default) = required
}
```

New `env` field (deprecating `env_spec`) on each blueprint spec:
- `McpServerSpec`: `map<string, EnvVarDeclaration> env = 15`
- `AgentSpec`: `map<string, EnvVarDeclaration> env = 8`
- `WorkflowSpec`: `map<string, EnvVarDeclaration> env = 5`

YAML improves from `spec.env_spec.data.KEY` to `spec.env.KEY` (one nesting level removed).

All consumers use fallback: read `env` first, fall back to `env_spec.data` during transition.

---

## Key Files

### Phase 1 (retry fix)
- `stigmer/backend/services/agent-runner/worker/activities/discover_mcp_server.py` -- workflow + activity definitions

### Phase 2 (proto + migration)
- `stigmer/apis/ai/stigmer/agentic/environment/v1/spec.proto` -- add EnvVarDeclaration
- `stigmer/apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` -- new env field
- `stigmer/apis/ai/stigmer/agentic/agent/v1/spec.proto` -- new env field
- `stigmer/apis/ai/stigmer/agentic/workflow/v1/spec.proto` -- new env field
- `stigmer/seedpack/mcp-servers/*.yaml` -- ~20 files to migrate
- Go consumers: `connect.go`, `merge_mcp_env_specs.go`, `create_execution_context_step.go`
- Java consumers: `McpServerConnectHandler.java`, `McpEnvironmentValidator.java`, `EnvironmentMergeService.java`, `MergeMcpServerEnvSpecsStep.java`
- Python consumers: `config_transformer.py`, `graphton/setup.py`
- TypeScript consumers: `useMcpServerCredentials.ts`, `useMcpServerSetup.ts`, `EnvVarForm.tsx`, `diffEnvSpec.ts`

---

## Current State

- **Status**: in-progress
- **Last Session**: 2026-04-11 — T01, T02, T03, T04 completed
- **Active Task**: T05 (next to start)

## Session Progress (2026-04-11)

- T01: Added `RetryPolicy(maximum_attempts=1)` to all 3 `workflow.execute_activity` calls in `discover_mcp_server.py`
- T02: Added `EnvVarDeclaration` proto to `environment/v1/spec.proto`; added `map<string, EnvVarDeclaration> env` field on McpServerSpec (15), AgentSpec (8), WorkflowSpec (5); deprecated `env_spec` on all three
- T03: Ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) — all stubs regenerated
- Architectural review: confirmed `McpServerAuth` should remain on McpServerSpec (not merged into `EnvVarDeclaration`) — aggregate boundary, separation of declaration vs acquisition
- T04: Migrated all 32 seedpack MCP server YAMLs from `env_spec.data` to `env`; classified 4 vars as `optional: true`; updated CONTRIBUTING.md, mcp-server-creator agent instructions, mcp-server-creator skill (SKILL.md + 3 reference files), agent-creator skill (SKILL.md + 2 reference files); zero `env_spec` references remain in seedpack YAML/MD

## Next Steps

1. T05: Update consumer code (Go, Java, Python, TypeScript) with env-first fallback-to-env_spec pattern
2. T06: Enforce required/optional semantics in Java and Go connect/execution handlers

## Context for Resume

- The new `env` field exists in proto, all stubs, and all seedpack YAML files
- All seedpack docs and skills reference `env` (not `env_spec`)
- No consumer code reads `env` yet — all runtime paths still use `env_spec.data`
- Consumer files needing updates are listed in the Key Files section above
- The `env_spec` field is deprecated but still works for user-created resources during transition

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review the design decisions above
3. [ ] Continue with T05 (consumer code updates)

