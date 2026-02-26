# Next Task: Agent Runner MCP Resources Support

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly says "go" or chooses an option

---

**Project**: `_projects/2026-02/20260226.02.agent-runner-mcp-resources/`
**Current Status**: T01-T04 COMPLETE — Implementation done, tests passing

## Quick Context

Add MCP resources and resource templates support to the Stigmer agent runner:
- Currently the agent runner only uses MCP tools (via `langchain_mcp_adapters`)
- No code exists for listing or reading MCP resources
- Needed for mcp-server-planton's cloud resource schema discovery via resource templates
- Agents should auto-discover and use resources during execution

## Current State

- **Status**: Implementation complete, pending commit
- **Last Session**: 2026-02-26
- **Active Task**: None — all tasks done

## Session Progress (2026-02-26)

### Investigation (T01)
- Confirmed `langchain-mcp-adapters` v0.1.14 has `get_resources()` but NO resource template support
- Confirmed MCP Python SDK has full `list_resource_templates()` / `read_resource()` / `complete()` API
- Confirmed `MultiServerMCPClient.session()` yields raw `ClientSession` — can call SDK methods directly
- Resolved design decision: Option C (pure tool-based) — two LangChain tools for list + read

### Implementation (T02-T03)
- Added `list_mcp_resources()` and `read_mcp_resource()` to `mcp_manager.py` (core functions)
- Created `resource_tools.py` with `create_resource_tools()` factory (LangChain tools)
- Wired resource tools into `create_deep_agent()` in `agent.py`

### Testing (T04)
- 11 new tests in `test_mcp_manager.py` (list + read, error handling, partial failures)
- 10 new tests in `test_resource_tools.py` (tool creation, JSON output, text content, errors)
- All 30 tests pass (21 new + 9 existing). No pre-existing tests broken.

### Key Decisions Made
- **Design**: Option C — pure tool-based (list + read), no context injection
- **Auth**: Same pattern as tools — pre-resolved in connection config
- **Resource filtering**: Deferred — all resources accessible (read-only data)
- **Session pooling**: Per-call sessions for now, optimize later if needed
- **Resource templates**: `list_resource_templates()` returns 1 template definition, not 150 expanded entries

## Files Modified

- `backend/libs/python/graphton/src/graphton/core/mcp_manager.py` — Added `list_mcp_resources()` and `read_mcp_resource()`
- `backend/libs/python/graphton/src/graphton/core/resource_tools.py` — NEW: `create_resource_tools()` factory
- `backend/libs/python/graphton/src/graphton/core/agent.py` — Wired resource tools into `create_deep_agent()`
- `backend/libs/python/graphton/tests/core/test_mcp_manager.py` — Added 11 resource tests
- `backend/libs/python/graphton/tests/core/test_resource_tools.py` — NEW: 10 tool tests

## Next Steps

1. **Commit** — Stage and commit the MCP resources implementation
2. **End-to-end test** — Test with a real MCP server that exposes resources (when available)
3. **mcp-server-planton Phase 3** — Once resource templates are implemented there, do integration testing
4. **Prompt enhancement** — Consider updating `prompt_enhancement.py` to mention resource tools to agents

## Blockers

None — implementation is complete and tests pass.

---

## Why This Project Exists

The mcp-server-planton refactoring (Decision #10-11) chose to expose per-kind
cloud resource schemas as MCP resource templates instead of cramming 150+ typed
provider fields into one tool's input schema. This requires the agent runner to
support MCP resources so agents can auto-discover schemas before calling
`apply_cloud_resource`.

## Key Files (Agent Runner MCP Integration)

- `backend/services/agent-runner/worker/activities/execute_graphton.py` — MCP client init
- `backend/services/agent-runner/worker/mcp/config_transformer.py` — Server config transform
- `backend/libs/python/graphton/src/graphton/core/mcp_manager.py` — MCP lifecycle + resources
- `backend/libs/python/graphton/src/graphton/core/resource_tools.py` — Agent resource tools
- `backend/libs/python/graphton/src/graphton/core/authenticated_tool_node.py` — Tool execution

## Related Projects

- **mcp-server-planton refactoring**: `mcp-server-planton/_projects/2026-02/20260226.01.refactor-mcp-server-stigmer-patterns/`
  Decisions #10-11 depend on this project.

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-02/20260226.02.agent-runner-mcp-resources/next-task.md`
