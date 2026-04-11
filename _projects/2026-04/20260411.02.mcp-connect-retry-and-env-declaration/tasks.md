# Tasks: 20260411.02.mcp-connect-retry-and-env-declaration

**Created**: 2026-04-11

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: T01: Eliminate retries in connect workflow (set RetryPolicy maximum_attempts=1 in discover_mcp_server.py)

**Status**: ✅ DONE
**Created**: 2026-04-11 17:40
**Completed**: 2026-04-11 18:00

### Subtasks
- [x] Import `RetryPolicy` from `temporalio.common`
- [x] Add `retry_policy=RetryPolicy(maximum_attempts=1)` to `discover_mcp_server` activity in `ConnectMcpServerWorkflow`
- [x] Add `retry_policy=RetryPolicy(maximum_attempts=1)` to `classify_tool_approvals` activity in `ConnectMcpServerWorkflow`
- [x] Add `retry_policy=RetryPolicy(maximum_attempts=1)` to `discover_mcp_server` activity in legacy `DiscoverMcpServerWorkflow`

### Notes
- All 3 `workflow.execute_activity` calls now have `maximum_attempts=1`
- Classify activity (LLM call) also gets no-retry: connect is synchronous and user-triggered, so fail-fast is better than silent retries

## Task 2: T02: Add EnvVarDeclaration proto message to environment/v1/spec.proto and add new env field deprecating env_spec on McpServerSpec AgentSpec WorkflowSpec

**Status**: ✅ DONE
**Created**: 2026-04-11 17:40
**Completed**: 2026-04-11 18:00

### Subtasks
- [x] Add `EnvVarDeclaration` message to `environment/v1/spec.proto` (is_secret, description, optional)
- [x] Add `map<string, EnvVarDeclaration> env = 15` to McpServerSpec
- [x] Add `map<string, EnvVarDeclaration> env = 8` to AgentSpec
- [x] Add `map<string, EnvVarDeclaration> env = 5` to WorkflowSpec
- [x] Mark `env_spec` as `[deprecated = true]` on all three specs
- [x] Update McpServerAuth comments to reference `env` alongside legacy `env_spec.data`

### Notes
- Design decision: `EnvVarDeclaration` in environment package (shared), not MCP-server-specific
- Architectural review confirmed `McpServerAuth` should NOT be merged into `EnvVarDeclaration` (aggregate boundary, separation of declaration vs acquisition)

## Task 3: T03: Regenerate proto stubs across all languages (Go Java Python TypeScript Dart)

**Status**: ✅ DONE
**Created**: 2026-04-11 17:40
**Completed**: 2026-04-11 18:00

### Subtasks
- [x] Run `make codegen` in stigmer repo (protos + SDK docs + narration)
- [x] Run `make protos` in stigmer-cloud repo (Go, Java, Python, TypeScript, Dart stubs)

### Notes
- 67 files changed in stigmer, 44 files changed in stigmer-cloud
- New `EnvVarDeclaration` Java stubs generated as new files in both repos

## Task 4: T04: Migrate seedpack YAML files from env_spec.data to env

**Status**: ✅ DONE
**Created**: 2026-04-11 17:40
**Completed**: 2026-04-11

### Subtasks
- [x] Migrate 32 MCP server YAML files: lift `env_spec.data` to `env`, remove `env_spec` wrapper
- [x] Classify and apply `optional: true` on 4 vars: `FASTMCP_LOG_LEVEL` (aws-cdk, aws-documentation), `AWS_PROFILE` (aws-lambda), `MYSQL_PORT` and `MYSQL_DB` (mysql)
- [x] Update `seedpack/mcp-servers/CONTRIBUTING.md` templates and field table
- [x] Update `mcp-server-creator.yaml` agent instructions (3 `env_spec` references)
- [x] Update `mcp-server-creator` skill: SKILL.md + references/schema.md, validation.md, examples.md
- [x] Update `agent-creator` skill: SKILL.md + references/schema.md, examples.md

### Notes
- Zero `env_spec` references remain in any seedpack YAML or Markdown file (verified via grep)
- 6 MCP servers without env vars unchanged (fetch, git, kubernetes, memory, playwright, sequential-thinking)
- Tool scripts (`03_draft-mcp-server-creator-skill.sh`, `04_generate-approval-policy.sh`) excluded — `env_spec` only in comments, one-off generators
- Optionality classification: 4 vars marked `optional: true` (have defaults or are non-critical), ~36 vars remain required by default (safe default — execution fails if missing)

## Task 5: T05: Update consumer code (Go Java Python TypeScript) with env-first fallback-to-env_spec pattern

**Status**: ⏸️ TODO
**Created**: 2026-04-11 17:40

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 6: T06: Enforce required/optional semantics in Java and Go connect and execution handlers

**Status**: ⏸️ TODO
**Created**: 2026-04-11 17:40

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

