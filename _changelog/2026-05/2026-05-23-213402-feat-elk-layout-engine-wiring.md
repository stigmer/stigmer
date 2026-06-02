# Wire ELK Layout Engine into Workflow Canvas

**Date**: May 23, 2026

## Summary

Wired the existing ELK layout engine (built in T03) into the workflow visual canvas, enabling ELK-powered "Auto Layout" with Web Worker offloading in both client apps. The SDK now exposes a `layoutEngine` prop on the editor component chain and a `useElkLayoutEngine` convenience hook for async engine creation and lifecycle management.

## Problem Statement

The ELK layout module was fully implemented in `sdk/react/src/workflow/layout/` during T03, but no consumer activated it. `useWorkflowCanvas` hardcoded dagre as the only engine, and the component chain had no way to accept an external engine. The T03 deferred wiring checkpoint documented this gap.

### Pain Points

- Auto-layout used dagre only — no port awareness, no compound node support, no model-order preservation
- The ~1.5MB ELK WASM module existed as dead code in the SDK (optional peer dep)
- No prop path existed from client-app pages through the SDK component chain to the layout hook
- Client apps had no `elkjs` dependency and no Web Worker configuration

## Solution

Threaded a `layoutEngine` optional prop through the SDK component chain (`WorkflowEditorView` → `WorkflowCanvasEditor` → `useWorkflowCanvas` → `useWorkflowLayout`), created a `useElkLayoutEngine` convenience hook for async engine lifecycle, and wired both client apps with Web Worker–backed ELK.

## Implementation Details

### SDK: Prop threading (4 files)

- `useWorkflowCanvas` gained an optional third parameter `options?: UseWorkflowCanvasOptions` with `layoutEngine?: LayoutEngine`
- `WorkflowCanvasEditor` and `WorkflowEditorView` gained matching `layoutEngine` props
- All threaded via `useWorkflowLayout({ engine: options.layoutEngine, getNodeDimensions: registryNodeDimensions })`
- Backward-compatible: omitting `layoutEngine` defaults to dagre (no behavioral change)

### SDK: `useElkLayoutEngine` hook (new file)

- Behavior hook (DD-003 layer 2) at `sdk/react/src/workflow/layout/useElkLayoutEngine.ts`
- Async creation via `createElkLayoutEngine()` on mount
- Returns `LayoutEngine | null` — null while loading or if `elkjs` is not installed
- Terminates engine (and its Web Worker) on unmount via ref-based cleanup
- `enabled` flag for conditional activation (feature flags)
- Options captured via ref — engine created once, not on every render

### Client apps: ELK activation (4 pages)

- Added `elkjs: ^0.9.3` to both `client-apps/web` and `client-apps/desktop`
- Module-level `workerFactory` using the universal `new URL("elkjs/lib/elk-worker.min.js", import.meta.url)` pattern (works in Vite, webpack, Turbopack)
- Wired `useElkLayoutEngine({ workerFactory })` in all 4 workflow pages per DD-016 (client app parity)

### Architecture decisions

- **Initial YAML parse stays dagre (sync)**: `applyDagreLayout` runs synchronously in `useMemo` during parse. ELK is async and cannot replace this without a loading state. Dagre gives instant first render; ELK improves layout on "Auto Layout" click.
- **Three-layer fallback**: Web Worker fails → bundled WASM, ELK fails → dagre fallback, both fail → null result + error state.
- **Double-terminate is safe**: Both `useElkLayoutEngine` and `useWorkflowLayout` clean up the engine. `ElkLayoutEngineImpl.terminate()` is idempotent.

### Tests

- 7 new unit tests for `useElkLayoutEngine`: creation, cleanup, race condition (unmount during async creation), disabled flag, missing elkjs graceful handling, option forwarding
- All 55 layout tests pass (48 existing + 7 new), zero regressions

## Benefits

- **Better layout quality**: ELK produces fewer edge crossings, better port ordering, and model-order preservation for complex workflows
- **Off-main-thread**: Web Worker mode keeps the ~1.5MB WASM computation off the main thread (~5KB API stub on main thread)
- **SDK-first**: `useElkLayoutEngine` is a public SDK export — platform builders embedding `WorkflowCanvasEditor` can opt into ELK by installing `elkjs` and passing the hook result
- **Zero breaking changes**: All changes are additive; omitting `layoutEngine` preserves existing dagre behavior

## Impact

- **SDK consumers**: New `layoutEngine` prop on `WorkflowEditorView` and `WorkflowCanvasEditor`, new `useElkLayoutEngine` hook export
- **Client apps**: Both web and desktop now use ELK for "Auto Layout" with Web Worker offloading
- **Bundle**: ~5KB main thread increase (elk-api.js); WASM runs in worker

## Related Work

- T03: ELK Layout Pipeline — built the engine (`_changelog/2026-05/2026-05-23-151356-t03-elk-layout-pipeline.md`)
- T03-wire-1: Visual registry dimensions — wired `registryNodeDimensions` (`_changelog/2026-05/2026-05-23-190046-feat-wire-visual-registry-dimensions-into-layout-pipeline.md`)
- T03 deferred wiring checkpoint: `_projects/2026-05/20260523.02.workflow-ux-implementation/checkpoints/t03-deferred-wiring.md`

---

**Status**: ✅ Production Ready
