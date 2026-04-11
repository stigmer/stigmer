# 20260411.02.mcp-connect-retry-and-env-declaration

## Overview
Eliminate Temporal activity retries in MCP server connect workflow and introduce EnvVarDeclaration proto for required/optional env var semantics across all blueprint resources.

**Created**: 2026-04-11  
**Estimated Time**: 1-4 hours  
**Status**: 🚧 In Progress

## Goal
Fix the 401 retry loop so errors surface immediately to the user, and design the EnvVarDeclaration proto to properly distinguish required vs optional env vars in McpServer, Agent, and Workflow specs.

## Technology Stack
Python/Temporal, Proto/Buf, Go, Java, TypeScript/React

## Affected Components
agent-runner (Python), environment proto, mcpserver/agent/workflow protos, seedpack YAML, Go/Java/Python/TypeScript consumers

## Success Criteria
- Goal achieved
- Tests passing
- Changes validated

## Quick Links
- [Tasks](tasks.md) - Task breakdown and progress
- [Notes](notes.md) - Quick notes and learnings
- [Resume](next-task.md) - **Drag this into chat to resume!**

## Project Type
⚡ **Quick Project** - Designed to complete in 1-2 sessions with minimal overhead.

## Status Summary

Check [tasks.md](tasks.md) for detailed progress tracking.

Update this section as you make progress:
- Current phase: [Analysis/Implementation/Testing/Complete]
- Blockers: [None/List any blockers]
- Next up: [What's next after current task]

## Notes Summary

Key learnings and decisions are captured in [notes.md](notes.md).

---

*This project follows the Next Quick Project Framework for fast, focused development.*

