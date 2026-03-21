# DD-004: Frontend Resource Detection in Artifacts

**Date**: 2026-03-20
**Status**: Decided
**Participants**: Developer + Architect

## Context

When an execution produces artifacts, we want to detect if any artifact is a Stigmer resource (Agent YAML, MCP Server YAML, Skill package) and offer an "Apply" action. This detection could happen on the backend (new API) or the frontend (parse artifact content).

## Decision

**Frontend detection**. The `ArtifactCard` component fetches artifact content and parses YAML to detect Stigmer resources.

## Rationale

- No backend changes required — faster to ship
- The detection logic is simple: parse YAML, check for `apiVersion` + `kind` fields
- The frontend already has the artifact `downloadUrl` from the execution status
- Keeps the artifact system general-purpose (backend doesn't need to know about "applyable" vs "generic" artifacts)
- The `useDetectStigmerResource` hook encapsulates the logic and can be reused

## Detection Logic

1. Fetch artifact content via `downloadUrl` (with size guard: skip if > 256KB)
2. Attempt YAML parse
3. Check for `apiVersion` matching `ai.stigmer.agentic/*` and `kind` in known set
4. For directory artifacts: check for SKILL.md presence
5. Fallback: generic artifact (download only)

## Apply Logic

- Parse YAML → extract resource fields → call appropriate SDK method
- `kind: Agent` → `stigmer.agent.apply(input)`
- `kind: McpServer` → `stigmer.mcpServer.apply(input)`
- Skill packages → `stigmer.skill.push(input)`

## Risks

- YAML parsing in the browser could fail on edge cases — mitigated by graceful fallback
- Large artifacts could impact performance — mitigated by size guard
- Network request to fetch content adds latency — acceptable for the review workflow
