# Next Task: 20260318.01.session-context-composition

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260318.01.session-context-composition

**Description**: Add session-level MCP server usages and skill references to SessionSpec, enabling users to augment the default assistant's capabilities per-session without modifying agent blueprints.
**Goal**: Users can attach MCP servers and skills at session creation time. The runtime merges session-level context with agent blueprint capabilities at execution time. The session launcher becomes the single-screen product pitch: message + workspace + skills + MCP servers + model.
**Tech Stack**: Proto (APIs), Go (OSS backend), Java (cloud backend), TypeScript (SDK + React SDK), Next.js (web console)
**Components**: apis/ (session proto), Go backend (session + execution pipelines), Java backend (session + execution handlers), TypeScript SDK (codegen), React SDK (session hooks + launcher components), client-apps/web (session launcher UI)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260318.01.session-context-composition/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-18 12:40
**Current Task**: T01.2 (Stub Regeneration)
**Status**: In Progress

## Session Progress (2026-03-18)

- Completed T01.1: Added `mcp_server_usages` (field 7) and `skill_refs` (field 8) to `SessionSpec` proto
- Reused `McpServerUsage` from agent spec for consistent ubiquitous language
- Added CEL validation matching `AgentSpec` patterns (session-prefixed rule IDs)
- `buf lint` passes cleanly
- File modified: `apis/ai/stigmer/agentic/session/v1/spec.proto`

## Next Steps

1. **T01.2: Stub Regeneration** — Regenerate Go, Java, TypeScript proto stubs from the updated proto
2. **T01.3/T01.4/T01.5 (parallel)** — TypeScript SDK codegen, Go backend verification, Java backend verification
3. **T01.6** — React SDK `useCreateSession` hook update
4. **T01.7/T01.8 (parallel)** — MCP Server Picker and Skill Picker components
5. **T01.9** — Web Console SessionLauncher integration

## Context for Resume

- Branch: `feat/session-first-web-ux`
- The plan proposed `mcp_server_usages` without CEL validation, but we added it to match `AgentSpec` consistency — session-level fields mirror agent-level validation exactly
- CEL rule IDs use `session_` prefix to avoid collision with agent-level rule IDs
- No circular import issue: session imports agent spec (leaf types only)

## Quick Commands

After loading context:
- "Continue with T01.2" - Start stub regeneration
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
