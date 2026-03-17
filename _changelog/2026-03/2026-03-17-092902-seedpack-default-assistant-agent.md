# Seedpack: Default Assistant Agent

**Date**: March 17, 2026

## Summary

Added a default general-purpose assistant agent to the seedpack. This agent is bootstrapped with every Stigmer server and serves as the default when no agent is specified — the foundation for the session-first UX where users can immediately start working without selecting an agent.

## Problem Statement

The session-first UX (project 20260317.01) requires a default agent that the backend can auto-resolve when a user starts a session without explicitly choosing an agent. No such agent existed in the seedpack.

### Pain Points

- Users had to select an agent before starting a session — friction in the onboarding flow
- No default agent in the seedpack meant the backend had nothing to resolve to
- The session-first launcher pattern (type a message, start working) required an implicit agent

## Solution

Created `seedpack/agents/assistant.yaml` — a minimal, general-purpose agent labeled `stigmer.ai/default-agent: "true"` for backend resolution.

## Implementation Details

**New file**: `seedpack/agents/assistant.yaml`

- **apiVersion**: `agentic.stigmer.ai/v1`, **kind**: `Agent`
- **Labels**: `stigmer.ai/system: "true"` (seedpack convention), `stigmer.ai/default-agent: "true"` (resolution marker)
- **Instructions**: 5 lines — identity, mission, tone, action bias, honesty. No tool enumeration, no platform-specific guidance.
- **No MCP server usages**: Agent is purely general-purpose. Tools come from the runtime, not from declared MCP servers.
- **No skill_refs, sub_agents, or env_spec**: Clean slate by design.

No changes to `embed.go` or `BUILD.bazel` — the existing `//go:embed agents` and `glob(["agents/**"])` patterns automatically pick up new files in the `agents/` directory.

## Benefits

- Enables the session-first UX: users can start a session without selecting an agent
- The `stigmer.ai/default-agent: "true"` label provides a clean contract between the seedpack and backend resolution logic
- Minimal instructions avoid biasing the LLM toward any specific behavior — it adapts to whatever tools the runtime provides

## Impact

- **Seedpack**: New agent bootstrapped with every server
- **Backend** (next step — T01.2): Will query by label to resolve this agent as the default
- **Web console** (future — T01.5): Session launcher will create sessions without specifying an agent

## Related Work

- Part of project `20260317.01.session-first-web-ux`
- T01.2 (backend default agent resolution) depends on the label added here
- T01.5 (web session launcher) will consume this through the backend

---

**Status**: Production Ready
**Timeline**: T01.1 of the session-first web UX project
