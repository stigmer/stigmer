# Baseline Architectural Metrics

**Date**: 2026-04-23
**Measured by**: Workstream C (T01)
**Context**: Baseline measurements taken before Console domain reorganization (Workstream B)

---

## Metric 1: `next/*` Imports in SDK

**Value**: 0
**Target**: 0
**Status**: Clean

No Next.js imports exist in `sdk/react/src/`. The SDK has zero framework coupling.

```sh
rg "from ['\"]next[/'\"]" sdk/react/src/
```

**Enforcement**: `stigmer/sdk-import-boundaries` ESLint rule (error) — active via `sdk/react/eslint.config.mjs` and `make verify-web`.

---

## Metric 2: `@/` Path Imports in SDK

**Value**: 0
**Target**: 0
**Status**: Clean

No Console-relative path imports exist in `sdk/react/src/`.

```sh
rg "from ['\"]@/" sdk/react/src/
```

**Enforcement**: `stigmer/sdk-import-boundaries` ESLint rule (error) — catches `@/contexts/`, `@/components/`, `@/auth`, `@/app/` patterns.

---

## Metric 3: Console Imports of `@stigmer/react`

**Value**: 30 files, 34 import statements
**Target**: Track (no fixed target — this grows as the Console adopts more SDK components)

```sh
# File count
rg "@stigmer/react" client-apps/web/src/ --glob '*.{ts,tsx,css}' -l | wc -l

# Import line count
rg "@stigmer/react" client-apps/web/src/ --glob '*.{ts,tsx}' -c | awk -F: '{sum += $2} END {print sum}'
```

This count includes value imports, type imports, re-exports, and CSS `@import` statements. A healthy codebase should see this number grow as features move from Console to SDK.

---

## Metric 4: Hook-to-Component Export Ratio

**Value**: 101 hooks / 91 components = **1.11**
**Target**: >= 1.0
**Status**: Above target

Full barrel export breakdown (from `sdk/react/src/index.ts`):

| Category | Count |
|----------|-------|
| `use*` hooks | 101 |
| PascalCase components/contexts | 91 |
| SCREAMING_CASE constants | 9 |
| camelCase utilities | 43 |
| **Total value exports** | **244** |

A ratio above 1.0 confirms the headless-first architecture (DD-003): every styled component has at least one corresponding data or behavior hook.

```sh
# Reproducible via Node.js script (run from repo root)
cd sdk/react && node -e "
const fs = require('fs');
const src = fs.readFileSync('src/index.ts', 'utf8');
const clean = src.replace(/\/\/.*$/gm, '');
const valueExports = [];
const re = /export\s+(type\s+)?\{([^}]+)\}/g;
let m;
while ((m = re.exec(clean)) !== null) {
  if (m[1]) continue;
  m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim())
    .filter(s => s && !s.startsWith('type '))
    .forEach(s => valueExports.push(s));
}
const hooks = [...new Set(valueExports.filter(n => /^use[A-Z]/.test(n)))];
const components = [...new Set(valueExports.filter(n => /^[A-Z]/.test(n) && !/^use[A-Z]/.test(n) && !/^[A-Z_]+$/.test(n)))];
console.log('Hooks:', hooks.length, 'Components:', components.length, 'Ratio:', (hooks.length / components.length).toFixed(2));
"
```

---

## Metric 5: Hardcoded Color Values in Console

**Value**: 3 (all in `global-error.tsx`)
**Target**: 0 (excluding documented exceptions)
**Status**: Clean (with documented exception)

The only hardcoded hex values are in `client-apps/web/src/app/global-error.tsx`:

| Value | Usage |
|-------|-------|
| `#666` | Error description text color |
| `#111` | Retry button background |
| `#fff` | Retry button text color |

**Why this is an exception**: `global-error.tsx` is the Next.js root error boundary. It renders when the root layout itself fails, meaning no CSS imports, theme tokens, or providers are available. Inline styles with hardcoded values are the only reliable option.

```sh
rg '#[0-9a-fA-F]{3,8}\b' client-apps/web/src/ --glob '*.{ts,tsx}'
```

---

## Additional Finding: Token Opacity Modifier Warnings

**SDK (`sdk/react/src/`)**: 312 warnings
**Console (`client-apps/web/src/`)**: 0 warnings

The `stigmer/no-token-opacity-modifiers` rule (set to `warn`) surfaces 312 instances in SDK styled components where opacity modifiers like `/50`, `/60`, `/90` are applied to theme token classes (e.g., `hover:bg-accent/50`, `bg-muted/30`). Per DD-005 and Dont-Do 004, these should use dedicated token variants instead.

These are pre-existing and are not blocking (warnings, not errors). Remediating them requires proposing new theme tokens in `sdk/theme/src/tokens.css` — a separate initiative from Workstream C.

---

## Pre-Existing Issue: TypeScript Typecheck Failure

Both `npm run typecheck -w @stigmer/sdk` and `npm run typecheck -w @stigmer/react` fail with:

```
sdk/typescript/src/gen/runner.ts(9,42): error TS2300: Duplicate identifier 'RunnerStreamServerMessage'.
sdk/typescript/src/gen/runner.ts(9,42): error TS2305: Module '"@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb"' has no exported member 'RunnerStreamServerMessage'.
sdk/typescript/src/gen/runner.ts(11,289): error TS2300: Duplicate identifier 'RunnerStreamServerMessage'.
```

This is a codegen issue in `sdk/typescript/src/gen/runner.ts` (a file marked "DO NOT EDIT") where `RunnerStreamServerMessage` is imported from both `api_pb` (line 9) and `io_pb` (line 11). The fix is to regenerate proto stubs or fix the codegen template. This predates Workstream C and affects both `make lint` and `make verify-web`.

---

## Enforcement Summary

| Metric | Enforcement Mechanism | Gate |
|--------|----------------------|------|
| `next/*` / `@/` in SDK | `stigmer/sdk-import-boundaries` (error) | `make lint`, `make verify-web` |
| Token opacity modifiers | `stigmer/no-token-opacity-modifiers` (warn) | `make lint`, `make verify-web` |
| Sidebar token misuse | `stigmer/no-main-tokens-in-sidebar` (warn) | `make lint`, `make verify-web` |
| SDK typecheck | `tsc --noEmit` | `make lint`, `make verify-web` |
| Web lint (all rules) | ESLint 9 + Next + stigmer plugin | `make lint`, `make verify-web` |
