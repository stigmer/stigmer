# T19 Agent Execution Test Coverage Gaps Closed

**Date**: May 16, 2026

## Summary

Implemented 9 new agent execution integration tests closing all remaining T19 coverage gaps identified during the E2E testing infrastructure build (Sessions 16-22). The test suite grew from 37 to 46 agent execution test functions, covering lifecycle resolution, recovery, MCP env var plumbing, session-level skills, skill deduplication, sub-agent MCP access scoping, and cost cap configuration.

## Problem Statement

The T19 handoff document (created in Session 16) identified 10 missing agent execution test cases across 8 test families. While many were implemented in Sessions 17-22, a systematic cross-reference revealed that 10 tests remained unimplemented, leaving coverage gaps in:

### Pain Points

- Agent creation without explicit session (auto-session via agent_id or default agent resolution) was untested
- The `recover` RPC (implemented in Session 21) had no corresponding integration test
- MCP server `${VAR_NAME}` env var resolution from `runtime_env` was unexercised
- Session-level `skill_refs` merge and deduplication were only documented in proto comments, never tested
- Sub-agent MCP access scoping (`mcp_access` grants) had no integration coverage
- `max_cost_usd` cost cap enforcement was undocumented in tests

## Solution

Tiered implementation approach: Tier 1 (high confidence, clear proto contracts) first, Tier 2 (after targeted investigation of runtime plumbing), Tier 3 (after confirming server-side feature completeness). Investigation agents traced runtime_env through the full pipeline and confirmed all three Tier 3 features are implemented in the Python agent-runner.

## Implementation Details

**9 new test functions across 6 test files:**

| Test | File | Coverage |
|------|------|----------|
| `CreateWithAgentId` | `01_lifecycle` | Auto-session from agent_id |
| `CreateDefaultAgent_NoDefault` | `01_lifecycle` | Error when no default agent |
| `CreateDefaultAgent` | `01_lifecycle` | Default agent label resolution |
| `Recover` | `06_lifecycle_control` | FAILED -> recover -> terminal |
| `MCP_EnvVarResolution` | `03_mcp` | `${VAR}` in StdioServerConfig.args |
| `Skill_SessionLevel` | `04_skills` | Session skill_refs union with agent |
| `Skill_Deduplication` | `04_skills` | Same skill on agent+session, injected once |
| `SubAgent_McpAccess` | `05_subagent` | Restricted MCP tools via mcp_access |
| `Config_MaxCostCap` | `02_config` | $0.001 cost cap enforcement |

**Harness extensions:**
- `AgentCreateOption` type for agent-level options (labels, visibility)
- `WithDefaultAgentLabel()` sets `stigmer.ai/default-agent` label + public visibility
- `WithRuntimeEnv()` sets execution-scoped environment variables
- `CreateAgentFull()` accepts both spec and metadata options

**Test MCP server:**
- New `crash` tool (`os.Exit(1)`) for deterministic execution failure

## Benefits

- Agent execution test coverage increased from 37 to 46 functions (24% growth)
- All T19 identified gaps are now closed except `Attachment_WorkspaceFileRef` (deferred due to workspace entry complexity)
- Harness primitives (`WithRuntimeEnv`, `WithDefaultAgentLabel`, `CreateAgentFull`) are reusable for future tests
- Investigation confirmed runtime_env, skill merge, sub-agent MCP scoping, cost cap, and workspace file refs are all implemented in the runner

## Impact

- Integration test suite: 46 agent execution tests + 50 workflow tests = 96+ total test functions
- Coverage now spans: lifecycle, HITL, MCP (stdio/HTTP/env/failure), skills (agent/session/dedup), sub-agents (delegation/cancel/MCP), config (model/rounds/cost), billing, usage, attachments
- Remaining gap: `Attachment_WorkspaceFileRef` requires workspace entry harness work

## Related Work

- T19 handoff document: `_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/tasks/T19_agent_execution_test_fixes_and_gaps.md`
- Session 21: Recover RPC handler implementation
- Session 22: T12 task kind coverage expansion

---

**Status**: Production Ready
**Timeline**: 1 session (~30 minutes)
