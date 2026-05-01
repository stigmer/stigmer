# Cursor Harness: Full Agent Blueprint Propagation

**Date**: May 1, 2026

## Summary

Implemented complete agent blueprint propagation for the Cursor Harness execution path. The cursor-runner now resolves the full agent chain (execution → session → agentInstance → agent), merges MCP server and skill configurations from both agent and session levels, fetches skills and attachments into a platform-managed directory, and assembles a comprehensive prompt carrying agent persona, instructions, sub-agent guidance, and workspace context — bringing it to parity with the Python agent-runner's initialization pipeline.

## Problem Statement

The cursor-runner was sending bare user messages to the Cursor agent with no agent blueprint context. Unlike the Python agent-runner, which performs elaborate initialization (persona injection, MCP resolution, skill materialization, sub-agent guidance, multi-workspace setup), the Cursor path was effectively running as a context-less assistant.

### Pain Points

- Agent persona and instructions were not carried forward — the Cursor agent had no identity or behavioral constraints
- MCP server configurations from both agent-level and session-level definitions were ignored
- Skills were not fetched, materialized, or referenced in the prompt
- Sub-agent definitions were not translated into guidance for Cursor's Task tool
- Multi-workspace support was incomplete — only a single workspace was used
- Attachments and referenced files were not made available to the Cursor agent

## Solution

A multi-module resolution pipeline that mirrors the Python agent-runner's initialization, adapted for the Cursor SDK's capabilities and constraints:

1. **Blueprint resolution** — gRPC chain resolution (execution → session → agentInstance → agent) with merge logic for MCP usages and skill refs
2. **Message-based instruction injection** — prepend instructions, skills, sub-agents, and context to the first user message (no workspace pollution via rules files)
3. **Platform mount pattern for skills** — physical files at `~/.stigmer/sessions/{id}/platform/`, symlinked from workspace `.stigmer/`
4. **Full MCP resolution** — fetch McpServer resources via gRPC, transform to Cursor SDK config format
5. **Multi-workspace** — resolve from `session.spec.workspaceEntries`, pass as `string[]` to Cursor SDK

## Implementation Details

### New Modules

- **`blueprint-resolver.ts`** — `resolveBlueprint()` orchestrates the full agent chain resolution. `mergeMcpServerUsages()` implements session-over-agent override by slug. `mergeSkillRefs()` unions and deduplicates by slug. `resolveWorkspaceDirs()` extracts local paths from workspace entries.

- **`prompt-builder.ts`** — `buildEnhancedPrompt()` assembles structured Markdown sections: instructions, skills metadata, sub-agent definitions (mapped to Cursor Task tool guidance), workspace directories, input attachments, referenced files, and response rules. `buildReinvocationPrompt()` handles post-HITL approval context.

- **`skill-resolver.ts`** — `resolveSkills()` fetches skills by reference via gRPC, writes SKILL.md content to the platform directory, and creates a `.stigmer` symlink in the workspace. This replicates the Python runner's virtual platform mount without polluting the user's repository.

- **`attachment-resolver.ts`** — `resolveAttachments()` copies attachments from their local paths to the platform-managed `.stigmer/inputs/` directory and returns relative paths for prompt injection.

### Modified Modules

- **`stigmer-client.ts`** — Added 7 gRPC query methods for Agent, AgentInstance, McpServer, and Skill resources (including reference-based lookups and skill artifact fetching).

- **`mcp-resolver.ts`** — Added `resolveMcpServers()` that fetches full McpServer resources and transforms stdio/http connection details into Cursor SDK config. Previously only had stub logic.

- **`session-lifecycle.ts`** — Changed `workspaceCwd: string` to `workspaceDirs: string[]` and updated `Agent.create()` to pass single string or array based on entry count.

- **`execute-cursor.ts`** — Full rewrite of the orchestration pipeline. Now runs 12 phases: load execution → load session + resolve blueprint → validate → resolve MCP servers → resolve skills → resolve attachments → create/resume agent → write HITL hooks → build enhanced prompt → submit conversation → stream + track → finalize.

## Benefits

- **Feature parity with Python runner**: The Cursor harness now receives the same rich context as the native harness — agents behave consistently regardless of which harness processes the execution.
- **No workspace pollution**: Instructions and skills are delivered via message injection and platform-managed directories, not by writing files into the user's repository.
- **Proper merge semantics**: MCP servers and skills from both agent and session levels are correctly merged, with session-level taking precedence on conflicts.
- **Multi-workspace ready**: Sessions with multiple workspace entries are properly supported.

## Impact

- **Cursor Harness users** now get fully-configured agent executions with proper persona, instructions, MCP tools, skills, and multi-workspace support
- **Agent authors** can define blueprints knowing they'll be consistently applied across both native and Cursor harnesses
- **Platform operators** get consistent behavior and billing regardless of execution path

## Related Work

- [Cursor Harness: Embedded Runner and Service Scaffolding](../2026-04/2026-04-30-180338-embedded-cursor-runner.md) — initial cursor-runner implementation
- [Cursor Harness: Automated Test Suite and Gap Fixes](../2026-04/) — test coverage for message translation, usage tracking, HITL approval
- [Cursor Harness: Unified Model Selector](../2026-04/) — Cursor-style flat model picker in SDK/React

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~3 hours)
