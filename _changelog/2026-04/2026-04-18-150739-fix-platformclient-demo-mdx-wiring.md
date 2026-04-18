# Fix PlatformClient Demo Components Missing from MDX Component Map

**Date**: April 18, 2026

## Summary

Fixed a runtime error on the PlatformClient documentation page where `<DemoPlatformClientSetupTour />` and `<DemoPlatformClientTokenFlow />` threw "Expected component to be defined." The components were implemented and barrel-exported but never registered in the MDX component map.

## Problem Statement

After the PlatformClient demo scenarios were added (session 11 of the PlatformClient project), the documentation page at `/docs/guides/authentication/platform-client/overview` crashed with:

```
Error: Expected component 'DemoPlatformClientSetupTour' to be defined:
you likely forgot to import, pass, or provide it.
```

### Pain Points

- The PlatformClient overview page was completely broken — readers saw a runtime error instead of documentation
- The error was not caught during development because the MDX rendering pipeline only surfaces missing components at runtime

## Solution

Added `DemoPlatformClientSetupTour` and `DemoPlatformClientTokenFlow` to the MDX component map in `site/src/components/mdx.tsx`. This was a missed wiring step — the components completed steps 1 and 2 of the 3-step registration process but skipped step 3.

## Implementation Details

The registration pipeline for making a React component available in MDX files requires three steps:

1. **Component implementation** — already done in `site/src/components/docs/demos/scenarios/platform-client-setup-tour/` and `platform-client-token-flow/`
2. **Barrel export** — already done in `site/src/components/docs/index.ts` (aliased as `DemoPlatformClientSetupTour` and `DemoPlatformClientTokenFlow`)
3. **MDX component map** — **was missing**. Added both components to the import and the `getMDXComponents` return object in `site/src/components/mdx.tsx`

### File changed

- `site/src/components/mdx.tsx` — added both components to the named import from `@/components/docs` and to the component map object

## Benefits

- PlatformClient documentation page renders correctly with both interactive demos
- Completes the wiring that was missed during the demo scenario implementation session

## Impact

- **Documentation readers**: PlatformClient overview page is no longer broken
- **Existing demos**: No impact — all other demo components remain unchanged

## Related Work

- PlatformClient demo scenarios (session 11): `_changelog/2026-04/2026-04-18-145923-platformclient-demo-scenarios.md`

---

**Status**: Production Ready
**Timeline**: Immediate fix
