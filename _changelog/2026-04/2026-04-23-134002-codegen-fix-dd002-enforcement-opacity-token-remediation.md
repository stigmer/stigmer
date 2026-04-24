# Codegen Fix, DD-002 Route Thinning, and Opacity Token Remediation

**Date**: April 23, 2026

## Summary

Completed all three follow-up tasks from the web-sdk-architecture-standards project: fixed the runner.ts codegen duplicate import bug, extracted domain logic from three thick route files to enforce DD-002 (Console as thin shell), and eliminated all 312 opacity modifier ESLint warnings by introducing 8 new semantic theme tokens and wiring 5 previously disconnected tokens into the SDK Tailwind bridge.

## Problem Statement

Three issues remained after the architecture standards workstreams were completed:

### Pain Points

- **Broken typecheck**: `sdk/typescript/src/gen/runner.ts` had a duplicate `RunnerStreamServerMessage` import (from both `api_pb` and `io_pb`) introduced by the bidi streaming codegen in `ce26866a`, breaking typecheck for `@stigmer/sdk` and `@stigmer/react`
- **Thick route files**: Three `app/` files violated DD-002 (Console is a thin shell) — `login/page.tsx` (177 lines of auth orchestration), `auth/github/callback/page.tsx` (142 lines of OAuth pipeline), and `library/layout.tsx` (61 lines of list/detail switching)
- **Theme system gap**: 312 `no-token-opacity-modifiers` ESLint warnings across 65 SDK files — components used raw Tailwind opacity modifiers (`bg-muted/40`, `hover:bg-accent/50`, `border-border/60`) instead of named semantic tokens, making them untunable per preset
- **SDK bridge gap**: `sdk/react/src/styles.css` was missing 16 `@theme` bridge lines that `globals.css` already had (`primary-hover`, `*-subtle`, sidebar tokens, backdrop) — platform builders using `@stigmer/react` standalone couldn't access these tokens

## Solution

### Phase 1: Codegen Fix

Added `!m.ClientStreaming` guard to `generateTSStreamingMethod` in `sdk_client_ts.go` — prevents the bidi path from importing the output type from `api_pb` when `io_pb` already provides it. Regenerated the TS SDK; only `runner.ts` changed.

### Phase 2: DD-002 Route File Thinning

Extracted domain logic from three route files into co-located modules:

| Route File | Lines Before → After | Extracted To |
|---|---:|---|
| `app/library/layout.tsx` | 61 → 1 | `domain/library/LibraryLayout.tsx` |
| `app/login/page.tsx` | 177 → 12 | `auth/login/LoginPageView.tsx` |
| `app/auth/github/callback/page.tsx` | 142 → 21 | `auth/github/GitHubCallbackPageView.tsx` |

### Phase 3: Opacity Token Remediation

Designed and implemented 8 new `--stgm-*` tokens (`accent-hover`, `destructive-hover`, `foreground-hover`, `border-muted`, `muted-faint`, `primary-muted`, `destructive-muted`, `muted-foreground-faint`) with values for every preset (default, corporate, startup, friendly, fintech) in both light and dark modes. Wired all new + previously missing tokens into the SDK `@theme` bridge. Replaced 328 class usages across 68 SDK files.

## Implementation Details

**Codegen** (`tools/codegen/generator/sdk_client_ts.go`):
- One-line guard change: `if outputType != cfg.protoResType && !m.ClientStreaming`
- Only affects resources with `clientStreaming: true` in schemas (runner only, today)

**Route thinning**:
- Library layout was a pure file move (all imports already in `domain/library/`)
- Login page extracted SSO + email auth orchestration to `auth/login/` — the existing `auth/` directory already contained OIDC infrastructure
- GitHub callback extracted the effect pipeline + popup window helpers to `auth/github/` — preserved the `exchangedRef` one-shot guarantee

**Token design** (38 unique class patterns → 13 semantic token roles):
- 5 existing tokens wired for the first time in SDK bridge: `primary-hover`, `primary-subtle`, `destructive-subtle`, `muted-subtle`, `muted-foreground-subtle`
- 8 new tokens covering: interaction states (hover fills), subtle surfaces, softer borders, muted text variants, and placeholder text
- Token values derived from each preset's color system — e.g., `accent-hover` uses the preset's hue + chroma at an appropriate midpoint between accent and background
- Edge cases: `bg-primary/40` (1 use) → `bg-primary-subtle`, `bg-card/95` (1 use) → `bg-card`

## Benefits

- **TS SDK typecheck passes** — `make -C sdk/typescript typecheck` is clean, unblocking `make verify-web`
- **All `app/` route files are thin shells** — DD-002 is now fully enforced, no remaining violations
- **Zero opacity modifier warnings** — down from 312, every color in SDK components is now preset-tunable
- **SDK `@theme` bridge is complete** — platform builders using `@stigmer/react` standalone get all tokens, including sidebar, backdrop, and interaction variants
- **80 new CSS custom property values** across all presets — each preset can independently control every visual weight

## Impact

- **SDK consumers**: `@stigmer/react` components now theme correctly in any preset without the Console's `globals.css` — the bridge gap that made standalone SDK usage subtly broken is fixed
- **Theme designers**: 8 new tokens provide fine-grained control over hover states, border weights, surface tints, and text softness per preset
- **Console maintainers**: route files are now trivially readable; domain logic lives in predictable locations (`auth/`, `domain/`)
- **CI**: TS SDK typecheck gate works again; opacity lint is now a hard quality bar (0 warnings baseline)

## Related Work

- **Predecessor**: web-sdk-architecture-standards project (Sessions 1-4) — DD-001 through DD-008, domain reorganization, ESLint rules, baseline metrics
- **Codegen fix builds on**: `ce26866a` (bidi streaming support for TS/Python/Java SDKs)
- **Theme system**: `theme-token-guidelines.mdc` cursor rule, `eslint-plugin-stigmer` custom rules

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
