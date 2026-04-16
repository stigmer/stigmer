# Fix `make check` Lint and Build Failures

**Date**: April 16, 2026

## Summary

Fixed three issues that caused `make check` to fail in the Stigmer OSS repository: an unused import triggering an ESLint error, a missing React Hook dependency causing a warning, and HTML-style comments in an MDX file that broke both the vale linter and the Next.js site build.

## Problem Statement

Running `make check` failed with exit code 2. The ESLint error in the site code was the first failure, which masked two additional issues (a vale spelling error and an MDX build failure) that only surfaced after the ESLint fix.

### Pain Points

- `make check` blocked on an unused `Building2` import in the multi-tenant JIT playback demo component
- The `Cursor` component's `useEffect` was missing `showRipple` in its dependency array, producing a React Hooks lint warning
- `docs/guides/federation/multi-tenant-setup.mdx` used `<!-- -->` HTML comments for vale directives, which MDX does not support — this broke the site build and, once converted to JSX comments, exposed a vale spelling error on the `external_org_id` identifier

## Solution

1. Removed the unused `Building2` import from the multi-tenant JIT playback component
2. Added `showRipple` to the `useEffect` dependency array in the Cursor component
3. Converted `<!-- vale off/on -->` to `{/* vale off/on */}` for MDX compatibility, and wrapped `external_org_id` in backticks so vale treats it as code

## Impact

- `make check` now passes cleanly (exit code 0) across all stages: Go mod tidy, ESLint, buf lint, TypeScript type-checking, vale prose linting, Prettier formatting, SDK builds, tests, web console build, and site build
- Stigmer Cloud `make check` was already passing with no issues

---

**Status**: ✅ Production Ready
