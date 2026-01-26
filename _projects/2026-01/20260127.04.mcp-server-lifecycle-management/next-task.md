# Next Task: 20260127.04.mcp-server-lifecycle-management

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260127.04.mcp-server-lifecycle-management

**Description**: Integrate MCP servers with agent runner using LangGraph's built-in lifecycle management
**Goal**: Transform Stigmer MCP server configuration to LangGraph format and leverage MultiServerMCPClient for stdio/HTTP transport
**Tech Stack**: Python (agent runner), langchain-mcp-adapters, Node.js (for npm-based MCP servers)
**Components**: stigmer/backend agent runner, config transformation layer

## Key Design Decisions

1. **Use LangGraph's lifecycle management** - No custom subprocess/HTTP managers (saves 15-20 days)
2. **Docker transport not supported initially** - Users can run containers manually + use HTTP transport
3. **Add Node.js to agent-runner Dockerfile** - Required for npm-based MCP servers (npx)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.04.mcp-server-lifecycle-management/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-27 01:49
**Updated**: 2026-01-27 (Simplified after research)
**Last Session**: 2026-01-27 - Research and planning phase complete
**Current Task**: T01 (MCP Server Integration)
**Status**: Ready for Implementation
**Estimated Duration**: 2.5-4.5 days (reduced from 18-25 days)

## Last Session Progress (2026-01-27)

### Accomplishments
- ✅ Deep research into MCP protocol and transport types
- ✅ Discovered LangGraph already handles lifecycle management (15-20 days saved!)
- ✅ Simplified implementation plan from custom managers to config transformation
- ✅ Removed Docker transport from proto spec (YAGNI - can add later)
- ✅ Created 2 design decision documents (DD01, DD02)
- ✅ Updated all project documentation

### Key Decisions
1. **Use LangGraph's built-in lifecycle** - No custom subprocess/HTTP managers needed
2. **Docker transport removed** - Keep proto simple, users can run containers + use HTTP
3. **Add Node.js to agent-runner** - Required for npm-based MCP servers (npx)

### Files Modified
- `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` - Removed Docker config (-102 lines)
- `tasks/T01_0_plan.md` - Completely rewritten with simplified approach
- `README.md` - Updated to reflect simplified scope
- Added design decisions: DD01 (LangGraph), DD02 (Docker removed)

### Research Findings
- MCP stdio: Client spawns subprocess (LangGraph does this)
- MCP HTTP: Just HTTP calls to already-running server
- LangGraph's `MultiServerMCPClient` handles all lifecycle automatically
- Agent-runner Docker image needs Node.js added (currently missing)

## Next Steps (When You Resume)

### Immediate Actions
1. **Review the simplified plan** - Read `tasks/T01_0_plan.md`
2. **Start implementation** - Phase 1: Config Transformer
   - Create `agent_runner/mcp/config_transformer.py`
   - Implement `transform_mcp_config()` function
   - Handle placeholder resolution for HTTP headers

### Implementation Order
```
Phase 1: Config Transformer (1-2 days)
  → Phase 2: LangGraph Integration (1-2 days)
  → Phase 3: Dockerfile Update (0.5 days)
```

### Context to Remember
- Environment variable resolution is handled elsewhere (not part of this project)
- LangGraph handles ALL lifecycle - we just transform config
- No custom subprocess/HTTP/Docker managers needed

## Blockers

None - ready to implement!

## Quick Commands

After loading context:
- "Continue with T01" - Resume implementation
- "Show project status" - Get overview of progress
- "Review design decisions" - Check DD01 and DD02

---

*This file provides direct paths to all project resources for quick context loading.*
