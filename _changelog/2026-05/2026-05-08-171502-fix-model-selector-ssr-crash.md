# Fix ModelSelector SSR Crash After Model Registry API Migration

**Date**: May 8, 2026

## Summary

Fixed a `TypeError: Cannot read properties of undefined (reading 'displayName')` that crashed static page generation for any docs page rendering a `SessionComposer` with a `ModelSelector`. The root cause was the model registry migration (72ee4891d) switching from a synchronous static JSON import to an asynchronous API fetch, leaving the model list empty during SSR where `useEffect` does not run.

## Problem Statement

After migrating the model registry from a static JSON file to an authenticated API endpoint, the CI build (`ci.docs` and `release.website`) began failing during Next.js static page generation. Two pages crashed: `/docs/concepts/approval-flows` and `/docs/concepts/tools`.

### Pain Points

- CI blocked on both `ci.docs` (Lint & Build) and `release.website` (pages-build) workflows
- Website deployments to GitHub Pages completely halted
- The initial fix attempt (efcdb5240) updated `yarn.lock` hashes but did not address the actual runtime crash — the error persisted

## Solution

Added null-safety to `ModelSelector` so it gracefully handles an empty model registry during server-side rendering, and updated the `UseModelRegistryReturn` type to accurately reflect that `defaultModel` can be `undefined` while the registry is loading.

## Implementation Details

**Root cause chain:**

1. `StigmerProvider` fetches the model registry in a `useEffect` (client-only)
2. During SSR/static generation, `useEffect` does not execute → model list stays `[]`
3. `useModelRegistry()` returns `defaultModel: enabledModels[0]` which is `undefined` for an empty array
4. `ModelSelector` unconditionally accesses `selectedModel.displayName` → crash

**Changes (3 files, 8 lines changed):**

- `sdk/react/src/models/ModelSelector.tsx` — Added optional chaining (`selectedModel?.displayName`, `selectedModel?.modelId`) with a `"Select model"` fallback for the trigger label
- `sdk/react/src/models/useModelRegistry.ts` — Changed `defaultModel` type from `ModelInfo` to `ModelInfo | undefined` to surface the loading state to consumers at the type level
- `site/yarn.lock` — Updated content hashes for `@stigmer/react` after the source change

## Benefits

- CI pipelines (`ci.docs`, `release.website`) unblocked — all 141 static pages generate successfully
- Type-safe: consumers of `useModelRegistry().defaultModel` are now forced to handle the `undefined` case, preventing similar crashes in future components
- No visual regression: the `"Select model"` fallback is only visible during the brief SSR render and is immediately replaced once the client hydrates and the API fetch completes

## Impact

- **CI**: Both failing workflows restored to green
- **Website**: GitHub Pages deployments resume
- **SDK consumers**: Minor type-level breaking change — `defaultModel` is now `ModelInfo | undefined`. Consumers that destructure `defaultModel` without a null check will see a TypeScript error, guiding them to handle the loading state.

## Related Work

- [Model Registry API Migration](_changelog/2026-05/2026-05-08-155716-model-registry-api-migration.md) — the migration that introduced the async fetch
- [Model Selector UX Redesign](_changelog/2026-05/2026-05-07-175217-model-selector-ux-redesign.md) — the component affected by this fix

---

**Status**: ✅ Production Ready
