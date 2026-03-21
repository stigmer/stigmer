# ArtifactCard Component for Execution Artifacts

**Date**: March 20, 2026

## Summary

Added the `ArtifactCard` styled component to `@stigmer/react` — a self-contained card that renders a single execution artifact with automatic Stigmer resource detection, download action, and an "Apply to [org]" CTA for detected resources. This is the first UI building block for the Execution Artifacts Widget (T02.6) that will appear in the session right sidebar.

## Problem Statement

Execution artifacts are produced by agents (YAML files, skill packages, reports) but there was no reusable UI component for rendering them. The detection and apply hooks (`useArtifactContent`, `useDetectStigmerResource`, `useDetectSkillPackage`, `useApplyResource`) were all built, but the styled "drop-in" component that orchestrates them was missing — forcing platform builders to wire up 4+ hooks manually for each artifact.

### Pain Points

- Platform builders had to compose multiple hooks manually per artifact
- No visual indication of Stigmer resource detection in the UI
- No Apply/Push CTA for detected resources
- The ArtifactsWidget (T02.6) had no card primitive to render

## Solution

Built `ArtifactCard` as a layer 3 styled component following the headless-first SDK architecture. The card orchestrates 4 existing hooks internally while keeping them independently importable for platform builders who want full control.

## Implementation Details

**New file**: `sdk/react/src/execution/ArtifactCard.tsx` (507 lines)

Architecture:
- Self-contained component managing its own hook state — required because React hooks cannot be called in loops, and the parent widget renders N cards
- Same pattern as `ApprovalCard` (receives data props, manages interaction state internally)

Internal hook orchestration:
- FILE artifacts: `useArtifactContent` → `useDetectStigmerResource` (for Agent/McpServer YAML)
- DIRECTORY artifacts: `useDetectSkillPackage` (checks SKILL.md in ZIP entries)
- All artifacts: `useApplyResource` (apply or push mutation)
- Size guard: 256 KB threshold skips content fetch for large files

Detection badges: "Agent detected", "MCP Server detected", "Skill · N files" — with loading skeleton during content fetch.

Apply CTA state machine: idle → applying (spinner) → applied (success) / error (retry). Button disabled during streaming, enabled when execution reaches terminal phase.

Accessibility: `role="article"`, `aria-label`, `aria-busy`, focus-visible rings, `role="alert"` on error state.

6 inline SVG icons (per codebase convention): FileIcon, FolderIcon, DownloadIcon, CheckIcon, SpinnerIcon, AlertIcon.

## Benefits

- **Drop-in experience**: `<ArtifactCard artifact={a} executionId={id} org={org} isTerminal={done} />` just works
- **Platform builder friendly**: All hooks remain independently importable for custom rendering
- **Consistent patterns**: Follows `ApprovalCard` conventions (own chrome, inline icons, cn() + tokens)
- **Zero Console dependencies**: Works identically embedded in a third-party dashboard

## Impact

- Unblocks T02.5 (ArtifactPreviewModal) and T02.6 (ArtifactsWidget)
- Platform builders can now render individual artifact cards in any context
- Completes the "data hooks → behavior hooks → styled component" progression for the artifact feature

## Related Work

- [Execution Artifact Data Hooks](2026-03-20-144924-execution-artifact-data-hooks-and-rpc.md)
- [Stigmer Resource Detection Hook](2026-03-20-152459-stigmer-resource-detection-hook.md)
- [useApplyResource Behavior Hook](2026-03-20-162746-useapplyresource-behavior-hook.md)
- [Directory Artifact Support](2026-03-20-160206-directory-artifact-support.md)

---

**Status**: ✅ Production Ready
