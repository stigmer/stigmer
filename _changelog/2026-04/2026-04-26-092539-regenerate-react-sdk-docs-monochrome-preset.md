# Regenerate React SDK Reference Docs for Monochrome Preset

**Date**: April 26, 2026

## Summary

Regenerated the React SDK reference documentation to include the new `"monochrome"` theme preset option in the `StigmerProvider` component's `preset` prop. The previous commit added the monochrome preset to `@stigmer/theme` and the desktop app, but the generated SDK docs were not updated to reflect the new option, causing `make check` to fail.

## Problem Statement

After the monochrome theme preset was added (`feat(sdk/theme,desktop): add monochrome theme preset`), the auto-generated React SDK documentation in `docs/sdk/react/core.mdx` was stale. The `preset` prop on `StigmerProvider` still listed `"default" | "corporate" | "startup" | "friendly" | "fintech"` without the newly added `"monochrome"` variant.

### Pain Points

- `make check` failed at the `gen-react-sdk-docs-check` gate
- SDK documentation did not reflect the actual available preset options

## Solution

Ran `make gen-react-sdk-docs` to regenerate the React SDK reference from the current TypeDoc output, bringing the docs in sync with the source types.

## Implementation Details

- **`docs/sdk/react/core.mdx`**: The `StigmerProvider` `preset` prop type updated from `"default" | "corporate" | "startup" | "friendly" | "fintech"` to `"default" | "corporate" | "startup" | "friendly" | "fintech" | "monochrome"`
- **`site/yarn.lock`**: Minor hash updates for local SDK workspace packages

## Benefits

- `make check` passes cleanly on both Stigmer and Stigmer Cloud repositories
- SDK documentation accurately reflects the full set of available theme presets

## Impact

Documentation-only change. No runtime behavior affected.

---

**Status**: ✅ Production Ready
