# Artifact Preview Dialog Consistency

**Date**: April 14, 2026

## Summary

Extracted `ArtifactPreviewContent` from `ArtifactPreviewModal` in `@stigmer/react`, following the `OAuthAppForm` headless-first precedent. Updated the three creation tour demos to show artifact previews in a BYOA-style dialog overlay instead of replacing the message thread inline, matching the production Console's behavior.

## Problem Statement

The production Console shows artifact previews in a native `<dialog>` popup overlaid on the session view — the message thread remains visible behind a backdrop, and the user clicks "Apply" or "Push Skill" inside the modal. The three creation tour demos (skill, MCP server, agent) instead used `ComposerView`'s `artifactContent` prop, which replaced the `MessageThread` entirely with a custom inline `ArtifactPanel`. This broke visual consistency with the actual product.

### Pain Points

- The inline `ArtifactPanel` in `ComposerView` was a ~70-line custom component duplicating the SDK's `ArtifactPreviewModal` layout but rendering inline
- The custom `ArtifactMeta` type and `SKILL_ARTIFACT_META` constant were demo-only constructs with no SDK counterpart
- The message thread disappeared when the artifact preview was shown — not how the web app works
- `ArtifactPreviewModal` was monolithic: content, detection pipeline, apply logic, and `<dialog>` lifecycle were fused together, making reuse outside a native dialog impossible

## Solution

Two-layer refactoring following the `OAuthAppForm` precedent:

1. **SDK extraction**: Split `ArtifactPreviewModal` into `ArtifactPreviewContent` (standalone content component) and `ArtifactPreviewModal` (thin `<dialog>` shell). The content component owns all orchestration: `useArtifactContent`, `useDetectStigmerResource`, `useDetectSkillPackage`, `useApplyResource`, and clipboard state.

2. **Demo overlay pattern**: Updated the three creation tours to render `ArtifactPreviewContent` inside a BYOA-style contained overlay (absolute positioning within the demo frame, dimmed background), with the `MessageThread` visible behind it.

## Implementation Details

### SDK: `ArtifactPreviewContent` extraction

- `ArtifactPreviewContent` receives the same props as `ArtifactPreviewModal` minus `open` (dialog-specific). Content fetching begins on mount; unmounting resets all state.
- `ArtifactPreviewModal` conditionally mounts the content when `open` is true — unmount-on-close replaces the previous `useEffect`-based state reset.
- Renamed `ModalHeader` to `ContentHeader` (no longer modal-specific).
- Added `data-cursor-target="apply-resource-button"` to the Apply/Push button wrapper for demo cursor targeting.
- Exported from `execution/index.ts` and root `index.ts`.
- Zero changes to `ArtifactPreviewModal`'s public API — `ArtifactsWidget` and the web app `SessionPage` are unaffected.

### Demo: `ComposerView` cleanup

Removed `artifactContent`, `artifactMeta`, `pushState` props, the `ArtifactPanel` component, the `ArtifactMeta` type, and `SKILL_ARTIFACT_META`. `ComposerView` now handles only three states: empty composer, typing simulation, and conversation.

### Demo: Creation tour overlay pattern

All three tours (`skill-creation-tour`, `mcp-server-creation-tour`, `agent-creation-tour`) now render artifact-preview and apply/push steps as:

```
<div className="relative h-full">
  <ComposerView execution={...} />           {/* visible behind overlay */}
  <div className="absolute inset-0 z-10 ... bg-background/60">
    <ArtifactPreviewContent artifact={...} /> {/* real SDK component */}
  </div>
</div>
```

This is the same pattern the BYOA demo uses for its dialog overlay.

Step data types simplified: `artifactContent: string` removed from the union types. The demo client's `fixtures.agentExecution.getArtifactContent(...)` supplies content through the same hook pipeline as production. Custom `ArtifactMeta` objects eliminated — detection is handled natively by SDK hooks.

## Benefits

- **Visual consistency**: Demos now match the production Console's artifact preview flow
- **Single source of truth**: Demo artifact rendering uses the real SDK component — detection badges, content rendering, and action bar are pixel-identical to the web app
- **SDK composability**: `ArtifactPreviewContent` can be rendered in any context (dialog, sheet, overlay, inline) — following the same pattern as `OAuthAppForm`
- **Less custom code**: Removed ~70 lines of custom `ArtifactPanel` plus the `ArtifactMeta` type system

## Impact

- **SDK consumers**: New `ArtifactPreviewContent` export available for custom modal/sheet contexts
- **Demo framework**: Three creation tours updated, BYOA overlay pattern now established for all dialog-based demos
- **Web app**: Zero impact — `ArtifactPreviewModal` API unchanged

## Related Work

- BYOA demo (`byoa-setup`) — established the overlay pattern these tours now follow
- `OAuthAppForm` — the SDK precedent for headless-first dialog content components
- `McpServerConnectDialog` — has a similar internal `ConnectDialogContent` function that could benefit from the same extraction in the future

---

**Status**: ✅ Production Ready
