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

## Task 5: T05: Clean removal of env_spec — consumer migration to env (Go Java Python TypeScript)

**Status**: ✅ DONE
**Created**: 2026-04-11 17:40
**Completed**: 2026-04-11

### Subtasks
- [x] Remove `env_spec` from McpServerSpec (field 8→env), AgentSpec (field 7→env), WorkflowSpec (field 4→env) protos
- [x] Clean up McpServerAuth and StdioServerConfig comments referencing env_spec
- [x] Run `make codegen` (stigmer) + `make protos` (stigmer-cloud) to regenerate all stubs
- [x] Refactor `envmerge.MergeEnvironmentLayers`: remove templateData param (layer 1 was always no-op)
- [x] Rename `FilterByEnvSpec` → `FilterByDeclaredKeys` with `map[string]*EnvVarDeclaration` param
- [x] Update Go consumers: connect.go, merge_mcp_env_specs.go, both create_execution_context_step.go
- [x] Update CLI: discover.go, env_resolver.go, run_agent_exec.go
- [x] Update Go tests: envmerge tests, agent_controller_test.go, mcp-server convert tests, workflow loader test
- [x] Refactor Java `EnvironmentMergeService`: remove templateEnvSpec param, rename filterByEnvSpec → filterByDeclaredKeys
- [x] Update Java consumers: McpServerConnectHandler, McpEnvironmentValidator, MergeMcpServerEnvSpecsStep, both CreateExecutionContextStep
- [x] Update Java tests: MergeMcpServerEnvSpecsStepTest, McpEnvironmentValidatorTest
- [x] Update Python: config_transformer.py (spec.env), setup.py (fix pre-existing bug: env_spec.variables → spec.env)
- [x] Update TypeScript: rename diffEnvSpec→diffEnv, update hooks (credentials/setup/agentSetup), detail views, YAML parse/serialize
- [x] Update site fixtures: preview-configs, tour steps, demo scenarios

### Notes
- **Design decision**: Clean break — no backward compat, no deprecated flags, no dual-write
- **Proto field numbers**: env takes env_spec's former field number (AgentSpec=7, WorkflowSpec=4, McpServerSpec=8)
- **Template defaults eliminated**: `EnvVarDeclaration` has no `value` field by design (blueprints declare needs, not values). `MergeEnvironmentLayers` becomes 2-layer: environments + runtime. Layer 1 (template defaults) was always a no-op in practice.
- **Pre-existing bug fixed**: Python `_extract_runtime_env_for_server` referenced `env_spec.variables` which does not exist on proto (field is `data`). Was silently failing via AttributeError catch. Now correctly reads `spec.env`.
- **McpEnvironmentValidator**: required check changed from "empty value" heuristic to `!declaration.getOptional()` — uses proper proto semantics
- **YAML parser**: retains backward compat for reading old `env_spec.data` YAML (parse-resource-yaml.ts)

## Task 6: T06: Enforce required/optional semantics in Java and Go connect and execution handlers

**Status**: ✅ DONE
**Created**: 2026-04-11 17:40
**Completed**: 2026-04-11

### Subtasks
- [x] Fix Java `MergeMcpServerEnvSpecsStep` bug: add `.setOptional()` to builder when copying MCP env declarations to Agent spec
- [x] Add `optionalFlagPreserved` test to `MergeMcpServerEnvSpecsStepTest`
- [x] Go `connect.go`: update `resolveFromPersonalEnvironment` to skip optional vars when missing, only error on required
- [x] Go `envmerge`: add `ValidateRequiredKeys` function + 8 test cases
- [x] Go agent execution context step: add `ValidateRequiredKeys` call after all injections (step 6.9)
- [x] Go workflow execution context step: add `ValidateRequiredKeys` call after filtering (step 6.1)
- [x] Java `McpServerConnectHandler`: update `resolveFromPersonalEnvironment` to skip optional vars, only fail on required
- [x] Frontend `EnvVarFormVariable`: add `optional?: boolean` field
- [x] Frontend `diffEnv`: populate `optional` on returned entries
- [x] Frontend `useMcpServerCredentials`: filter to required-only for `isReady` and `missingVariables`
- [x] Frontend `useMcpServerSetup`: filter `diffEnv` result to required-only in `addServer` and pool re-evaluation
- [x] Frontend `EnvSection`: add `optional` badge in `McpServerDetailView`

### Notes
- **Design principle**: "Required vars gate; optional vars ride along." Missing required = hard blocker. Missing optional = silently skipped.
- **Bug fix discovered**: Java `MergeMcpServerEnvSpecsStep` was dropping the `optional` flag when copying MCP server env declarations into Agent spec. All MCP-sourced vars appeared required at the Agent level. Fixed by adding `.setOptional(entry.getValue().getOptional())` to the builder.
- **Go validation approach**: `ValidateRequiredKeys` logs warnings (not hard errors) in execution context steps, because the Go OSS server doesn't have the equivalent of Java's `injectMcpEnvFromPersonalEnvironment`. Hard validation is handled by the Java Cloud backend's `McpEnvironmentValidator` (already done in T05).
- **Frontend approach**: `EnvVarForm` itself unchanged — still requires all passed fields to be filled. Optional-skip is achieved by callers filtering before passing vars to the form. This avoids confusing UX with partially-filled forms.
- **Frontend UX**: Optional vars discoverable via read-only `EnvSection` (with new `optional` badge) but never shown in credential/setup forms. Servers with only optional missing vars auto-resolve to `ready`.


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

