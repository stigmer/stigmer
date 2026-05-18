# Task T01: Research Spike — deepagents JS + LangGraph JS Feasibility

**Created**: 2026-05-18
**Status**: PENDING REVIEW
**Type**: Research / Proof of Concept
**Phase**: 0 (Hard Gate)

This is the gating task. We do NOT proceed to implementation until all three
sub-tasks are validated. If deepagents JS lacks critical capabilities, we
reassess the entire migration.

## Objective

Determine whether the `deepagents` npm package (v1.10.2) and `@langchain/langgraph`
JS provide sufficient middleware, checkpointer, and streaming capabilities to
replace the Python `graphton` library (37 modules) and `deepagents` Python (v0.4.0).

## Sub-tasks

### T01a: deepagents JS Middleware Audit

Install `deepagents` npm and catalog capabilities against graphton's module list.

For each graphton module, classify as one of:
- **Available** — exists in deepagents JS, use directly
- **Must build** — port from Python into the unified runner
- **Not needed** — Python-specific artifact, no TS equivalent required

Key questions to answer:
1. Does deepagents JS have `AgentMiddleware` with `abefore_agent` / `aafter_step` hooks?
2. Does `createDeepAgent` accept `checkpointer`, `subagents`, `middleware`, `backend`?
3. Does it ship loop detection, execution budget, tool truncation, graceful stop?
4. How does MCP tool loading work in JS vs Python (`McpToolsLoader` middleware)?
5. What is the streaming API? (`streamEvents` / `astream_events` equivalent?)
6. How do sub-agents work? (nested `task` tool delegation)
7. Is there an approval/interrupt mechanism? (HITL flow)

Modules to audit (from graphton `src/graphton/core/`):

| Module | Python Role | JS Status |
|--------|-------------|-----------|
| `agent.py` | `create_deep_agent` factory | ? |
| `config.py` | `AgentConfig` Pydantic validation | ? |
| `models.py` | `parse_model_string`, provider construction | ? |
| `model_registry.py` | Model metadata, pricing, context windows | ? |
| `middleware.py` | `McpToolsLoader` (persistent MCP connections) | ? |
| `mcp_manager.py` | MCP tool loading via `MultiServerMCPClient` | ? |
| `tool_wrappers.py` | Tool wrapping, approval-aware wrappers | ? |
| `resource_tools.py` | MCP resource list/read tools | ? |
| `loop_detection.py` | Repetitive tool-call detection + hard stop | ? |
| `execution_budget.py` | Wrap-up nudges vs recursion limit | ? |
| `tool_truncation.py` | Tool result size limiting | ? |
| `graceful_stop.py` | Platform STOP signal handling | ? |
| `cost_cap.py` | USD budget enforcement | ? |
| `summarization_middleware.py` | LangMem-based rolling summarization | ? |
| `summarization_config.py` | Summarization thresholds | ? |
| `summarization_callback.py` | Summarization event protocol | ? |
| `token_counter.py` | Token counting for summarization | ? |
| `think_tool.py` | Explicit reasoning tool | ? |
| `prompt_enhancement.py` | System prompt capability hints | ? |
| `subagent.py` | Sub-agent compilation + scoping | ? |
| `subagent_limiter.py` | Concurrency limiting for HITL | ? |
| `template.py` | `{{VAR}}` placeholder resolution | ? |
| `backends/filesystem.py` | File read/write/execute backend | ? |
| `backends/platform_mount.py` | Platform mount handler | ? |
| `backends/deepagents_adapter.py` | Backend protocol adapter | ? |
| `backends/gitignore_filter.py` | .gitignore-aware file filtering | ? |
| `git_tools.py` | Git operations for workspace | ? |
| `github_api.py` | GitHub API integration | ? |
| `workspace_index.py` | Workspace file indexing | ? |
| `sandbox_factory.py` | Sandbox backend dispatch | ? |
| `error_hints.py` | Error enrichment for LLM recovery | ? |
| `message_utils.py` | Summary serialization, message IDs | ? |
| `otel_callback.py` | OpenTelemetry spans on LLM/MCP | ? |

### T01b: LangGraph JS Checkpointer Validation

The Python agent-runner uses LangGraph checkpointers for HITL interrupt/resume.
Validate the JS equivalent:

1. Does `@langchain/langgraph` JS have `MemorySaver`?
2. Does it support `interrupt()` / `Command({ resume: ... })` for HITL?
3. Is there a MongoDB checkpointer (`@langchain/langgraph-checkpoint-mongodb`)?
4. Is there a SQLite checkpointer?
5. Can we build an HTTP checkpointer (proxy to platform API) on the JS side?
6. Does the checkpointer work with `createDeepAgent` from deepagents JS?

The cursor-runner currently does NOT use LangGraph checkpointers (it uses
Cursor SDK's native `Agent.create` / `Agent.resume`). The new
`ExecuteDeepAgent` activity WILL need checkpointers for HITL.

### T01c: Minimal PoC

Build a standalone script (NOT wired into Temporal) that validates the full chain:

1. Install `deepagents` npm + `@langchain/langgraph` + `@langchain/anthropic`
2. Create a deep agent with `createDeepAgent`
3. Attach an MCP server (stdio transport, simple tool like filesystem)
4. Use a memory checkpointer
5. Run `interrupt()` and resume (simulate HITL approval flow)
6. Stream events and capture tool calls + assistant messages
7. Verify the streaming event shape matches what we need for `StatusBuilder`

## Gate Decision

After completing T01a-c, we decide:

| Outcome | Action |
|---------|--------|
| deepagents JS has middleware hooks + checkpointers work | Proceed to Phase 1 |
| deepagents JS lacks middleware but LangGraph JS has raw hooks | Build middleware on raw LangGraph JS (more work, adjust timeline) |
| Both lack critical capabilities | Reassess: contribute upstream, wait, or abort migration |

## Success Criteria

- [ ] Middleware audit table completed with JS status for all 37 modules
- [ ] Checkpointer validation: MemorySaver + interrupt/resume confirmed working
- [ ] PoC script runs end-to-end: agent -> MCP tools -> interrupt -> resume -> stream
- [ ] Clear go/no-go recommendation documented
- [ ] If go: updated timeline based on "must build" middleware count

## Notes

- Do NOT start building the unified runner service until this task is approved
- Findings go into `design-decisions/` folder
- If surprises emerge, STOP and discuss before making architectural decisions
