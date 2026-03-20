# Stigmer Resource Detection for Execution Artifacts

**Date**: March 20, 2026

## Summary

Added a pure detection function and React hook to `@stigmer/react` that identifies Stigmer platform resources (Agent, McpServer, Skill) in YAML artifact content. This enables the execution artifacts widget to display resource type badges and offer "Apply to org" CTAs when an agent produces a Stigmer resource as output.

## Problem Statement

When an agent execution produces artifacts (e.g., `agent-creator` outputs a YAML agent definition), the platform needs to determine whether the artifact is a Stigmer resource that can be applied to the user's organization. Without detection, all artifacts are treated as generic files with only download capability.

### Pain Points

- No way to distinguish Stigmer resource YAML from generic text artifacts
- Platform builders embedding the artifacts widget have no detection primitive to build custom UX
- The "Apply to org" flow (T02.3–T02.8) requires knowing the resource kind before it can route to the correct SDK apply method

## Solution

A two-layer approach following the SDK's headless-first architecture:

1. **Pure function** (`detectStigmerResource`) — synchronous YAML parsing + structural validation against the Stigmer resource convention (`apiVersion`, `kind`, `metadata.name`). Independently testable, usable outside React.
2. **React hook** (`useDetectStigmerResource`) — thin `useMemo` wrapper that accepts `string | null` and returns memoized detection results.

## Implementation Details

- `detect-stigmer-resource.ts`: Pure function with discriminated union return type (`StigmerResourceDetection`). Validates `apiVersion` against `*.stigmer.ai/*` regex, checks `kind` against `{Agent, McpServer, Skill}` set, verifies `metadata.name` exists. Includes `displayName` mapping (e.g., `McpServer` → `"MCP Server"`) so UI consumers don't need their own label map.
- `useDetectStigmerResource.ts`: ~20 lines. Accepts `null` for safe unconditional calling while content is loading.
- `yaml` ^2.8.2 added as dependency to `@stigmer/react` for YAML 1.2 parsing.
- All types and functions exported from both `library/index.ts` and the top-level `sdk/react/src/index.ts` barrel.

## Benefits

- **SDK-first**: Both pure function and hook are exported — platform builders choose their integration level
- **Resilient**: Never throws; any parse failure returns `{ detected: false }`
- **Lean API**: Return type includes only what consumers need (kind, displayName, resourceName, resourceOrg) — no untyped parsed YAML object
- **Extensible**: Adding new resource kinds is a one-line change to the kind map

## Impact

- Unblocks T02.3 (`useApplyResource`) and T02.4–T02.8 (artifact UI components)
- Platform builders can now detect Stigmer resources in any YAML string
- 6 files changed, 210 insertions

## Related Work

- T02.1: Execution artifact data hooks (`useExecutionArtifacts`, `useArtifactContent`)
- T02.3 (next): `useApplyResource` behavior hook
- T02.4–T02.8: Artifact widget UI components

---

**Status**: Production Ready
**Commit**: `1aa998b8 feat(sdk/react): add Stigmer resource detection for execution artifacts`
