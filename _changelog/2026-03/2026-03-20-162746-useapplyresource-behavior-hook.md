# Add `useApplyResource` Behavior Hook and YAML-to-SDK Converter

**Date**: March 20, 2026

## Summary

Added the `useApplyResource` behavior hook and `parseResourceYaml` pure function to `@stigmer/react`, completing the "Apply to [org]" action flow for execution artifacts. Platform builders can now detect a Stigmer resource in an artifact, parse it into an SDK input type, and apply it to an organization — all through the SDK, with zero Console dependencies.

## Problem Statement

The detection layer (T02.1–T02.2) identifies Agent/McpServer YAML and skill packages in execution artifacts, but there was no SDK-level mechanism to act on those detections. The "Apply to [org]" CTA needed a hook that bridges detection to the actual `apply()` / `pushFromExecutionArtifact()` SDK calls.

### Pain Points

- YAML artifacts use proto-style snake_case (`mcp_server_usages`, `icon_url`, `working_dir`) but SDK `apply()` methods expect camelCase TypeScript input types (`AgentInput`, `McpServerInput`)
- Nested structures (mcp server usages, sub-agents, env specs) require careful per-field conversion
- Map-type fields (labels, env vars, HTTP headers) must preserve their keys during conversion
- The proto field `env_spec.data` maps to the SDK's `envSpec.variables` — a naming mismatch
- Two parallel apply paths (YAML resources vs. skill packages) needed a unified hook surface

## Solution

Two new files in `sdk/react/src/library/`:

1. **`parse-resource-yaml.ts`** — Pure function that parses Stigmer YAML and converts it to the appropriate SDK input type. Explicit per-field converters (not generic snake-to-camel recursion) for type safety and correct map field handling.

2. **`useApplyResource.ts`** — Behavior hook with two action methods: `applyYamlResource(content, org)` for Agent/McpServer YAML, and `pushSkillPackage(params)` for skill packages. Follows the established mutation hook pattern.

## Implementation Details

### YAML-to-SDK-Input Converter (`parseResourceYaml`)

- Validates YAML structure: `apiVersion`, `kind`, `metadata`, `spec`
- Routes by kind: `Agent` or `McpServer` (throws for unsupported kinds)
- `org` parameter always overrides `metadata.org` — matches the "Apply to [my-org]" UX intent
- Agent conversion: handles `mcp_server_usages[]` with nested `mcp_server_ref`, `tool_approval_overrides[]`, `sub_agents[]` with `mcp_access[]`, `skill_refs[]`, `env_spec.data`
- McpServer conversion: handles `stdio` (with `working_dir`), `http` (with `query_params`, `timeout_seconds`), `default_tool_approvals[]`, `default_enabled_tools`
- Accepts both snake_case and camelCase field names for resilience
- Descriptive, user-facing error messages for all validation failures

### Behavior Hook (`useApplyResource`)

- `applyYamlResource(content, org)`: parses YAML → routes by kind → calls `stigmer.agent.apply()` or `stigmer.mcpServer.apply()` → returns `ApplyResourceResult`
- `pushSkillPackage(params)`: creates `PushSkillFromExecutionArtifactRequest` proto → calls `stigmer.skill.pushFromExecutionArtifact()` → returns `ApplyResourceResult`
- Returns `{ kind, name, org, slug }` from response metadata for Library linking
- State: `isApplying`, `error`, `clearError` — exact same pattern as `useCreateOrganization`

### Barrel Exports

- All new symbols exported from `library/index.ts` and `sdk/react/src/index.ts`
- Skill detection functions elevated to top-level barrel (previously library-only)

## Benefits

- **Platform builders** can now build complete "detect → preview → apply" flows using only `@stigmer/react` hooks
- **Headless-first**: `parseResourceYaml` is a pure function usable without React — platform builders on other frameworks can use it directly
- **Unified hook**: Single `useApplyResource` handles both YAML resources and skill packages — components don't need conditional hook logic
- **Type-safe conversion**: Explicit converters catch field mismatches at compile time rather than runtime

## Impact

- **SDK surface**: 1 new pure function, 1 new hook, 3 new types added to `@stigmer/react` public API
- **Files**: 2 new, 2 modified (all in `sdk/react/src/library/`)
- **Breaking changes**: None — all existing exports unchanged
- **Consumers**: `ArtifactCard` (T02.4) and `ArtifactPreviewModal` (T02.5) will compose this hook for the "Apply to [org]" CTA

## Related Work

- T02.1 — Execution artifact data hooks (`useExecutionArtifacts`, `useArtifactContent`)
- T02.2 — Detection hooks (`useDetectStigmerResource`, `useDetectSkillPackage`)
- D1–D8 — Directory artifact support (proto, agent runner, backend, SDK)
- T02.4–T02.8 — Artifact UI components (next)

---

**Status**: Production Ready
**Timeline**: 1 session
