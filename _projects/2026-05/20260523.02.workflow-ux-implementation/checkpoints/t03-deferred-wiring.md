# Checkpoint: T03 Deferred Wiring Tasks

**Created:** 2026-05-23
**Context:** T03 (ELK Layout Pipeline) is marked COMPLETED in `next-task.md` and the changelog, but two wiring tasks remain that connect T01 (Visual Registry) and T03 (ELK) to the live editor. Without these, auto-layout uses dagre-only with hardcoded node dimensions.

---

## Task 1: Wire `getNodeDimensions` from T01 Registry into Layout Pipeline

**What:** The `useWorkflowLayout` hook and layout engines accept an optional `getNodeDimensions` callback, but `useWorkflowCanvas` calls `useWorkflowLayout()` with no dimensions — so auto-layout sizes all nodes as generic 280×80 cards, ignoring diamonds (140×140), parallel bars (260×32), etc.

**Where the gap is:**
- `sdk/react/src/workflow/useWorkflowCanvas.ts` — calls `useWorkflowLayout()` with no `getNodeDimensions`
- `sdk/react/src/workflow/layout/use-workflow-layout.ts` line 28 — accepts optional `getNodeDimensions`, documents "After T01, wire this to the TaskTypeRegistry"
- `sdk/react/src/workflow/layout/types.ts` line 42 — same comment on `LayoutInput.getNodeDimensions`

**What exists already:**
- `sdk/react/src/workflow/task-type-visual-registry.ts` exports `getVisualSpec(kind)` which returns `{ defaultWidth, defaultHeight, ... }` per task kind
- `sdk/react/src/workflow/layout/apply-dagre-layout.ts` — the sync layout path already uses registry-aware dimensions (wired in T04)

**Fix (5-10 lines):**
Create a `getNodeDimensions` adapter that maps `WorkflowGraphNode` → `{ width, height }` using `getVisualSpec`, and pass it to `useWorkflowLayout()` from `useWorkflowCanvas`.

---

## Task 2: Enable ELK in Client Apps via `workerFactory`

**What:** `createElkLayoutEngine` is fully implemented in the SDK with an optional `workerFactory` parameter for Web Worker offloading. But no client app instantiates ELK — `useWorkflowCanvas` calls `useWorkflowLayout()` with no `engine`, defaulting to dagre.

**Where the gap is:**
- `sdk/react/src/workflow/useWorkflowCanvas.ts` — calls `useWorkflowLayout()` with no `engine`
- `sdk/react/src/workflow/layout/elk-layout-engine.ts` — `createElkLayoutEngine({ workerFactory? })` ready to use
- `client-apps/web/package.json` — `elkjs` not in dependencies
- `client-apps/desktop/package.json` — `elkjs` not in dependencies

**What exists already:**
- Full ELK layout module: `sdk/react/src/workflow/layout/elk-layout-engine.ts`
- Web Worker example in JSDoc: `() => new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url))`
- Dagre fallback engine: `sdk/react/src/workflow/layout/dagre-layout-engine.ts`
- 30 unit tests + 4 E2E test specs for the layout module

**Fix:**
1. Add `elkjs` as a dependency in web/desktop `package.json`
2. Create a bundler-specific `workerFactory` in each client app (or in the SDK if it can be made bundler-agnostic)
3. Bootstrap ELK asynchronously and pass to `useWorkflowLayout({ engine, getNodeDimensions })`
4. Decide whether the engine lives in `useWorkflowCanvas` (SDK) or a client-app wrapper

---

## Why These Were Deferred

Both tasks are mechanical wiring (not design or architecture), but they require:
- Testing with actual ELK layout on real workflows to verify positioning quality
- Bundler configuration (Web Worker paths differ between Next.js, Vite, and Tauri)
- A decision about whether ELK activation should be SDK-internal or client-app-configured

They were deferred to keep T03's scope focused on the layout engine infrastructure itself.
