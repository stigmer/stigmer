# Scaffold `createStigmerRunner()` Factory — NPM Package Public API

**Date**: May 20, 2026

## Summary

Extracted the procedural boot sequence from `main.ts` into a `createStigmerRunner()` factory function, transforming `@stigmer/runner` from a CLI-only binary into an embeddable library with a typed options API. This is the foundational API surface that platform builders will use to integrate Stigmer's execution engine into their products.

## Problem Statement

The runner service (`backend/services/runner/`) had no library entry point. The entire boot sequence — config loading, fetch interceptor installation, activity factory imports, Temporal worker creation — was hardcoded in `main.ts` as a 124-line procedural script. Platform builders could not programmatically embed the runner; they could only run it as a CLI binary.

### Pain Points

- No public API — the package exported `main.ts` (a CLI script), not a factory function
- Fetch interceptor ordering constraint (Cursor SDK captures `global.fetch` at import time) was buried in `main.ts` implementation details
- Three activity types (`RunScript`, `RunShell`, `CallLlm`) were implemented but never registered in the Temporal worker — workflows using `run:` tasks or `call:llm` would fail at runtime
- `package.json` exports pointed only to the CLI binary, not a library entry point

## Solution

Created a three-layer structure: `runner.ts` (factory implementation) → `index.ts` (public API barrel) → `main.ts` (thin CLI entry that delegates to the factory).

## Implementation Details

**New files:**

- `src/runner.ts` — `createStigmerRunner()` factory, `StigmerRunnerOptions` interface, `StigmerRunner` handle type. Handles options validation, internal `Config` mapping, fetch interceptor installation, dynamic activity imports (all 16 activity types), Temporal worker creation.
- `src/index.ts` — Public API barrel re-exporting `createStigmerRunner`, `StigmerRunnerOptions`, `StigmerRunner`.
- `src/__tests__/runner.test.ts` — 9 unit tests covering options validation, type contracts, and public API exports.

**Modified files:**

- `src/main.ts` — Slimmed from 124 lines to 75 lines. Now a thin CLI entry: loads env config, initializes OTel, maps to `StigmerRunnerOptions`, delegates to factory, wires signal handlers.
- `package.json` — Dual exports: `.` for library API (`dist/index.js`), `./cli` for binary (`dist/main.js`). Updated `publishConfig` to match.

**Key design decisions:**

1. **Typed options, not env vars** — `StigmerRunnerOptions` interface with required `taskQueue`, `temporalAddress`, `stigmerEndpoint`. `mode` is derived from `proxyEndpoint` presence, not exposed.
2. **OTel excluded from factory** — global telemetry state is the consumer's responsibility. The Temporal OTel activity interceptor is still wired internally.
3. **Fetch interceptor handled internally** — consumers pass `proxyEndpoint`; the factory handles the import ordering constraint.
4. **All 16 activities registered** — fixed the `RunScript`/`RunShell`/`CallLlm` registration gap.

## Benefits

- Platform builders can `npm install @stigmer/runner` and embed the execution engine with 3 lines of code
- Typed options provide IDE autocomplete and compile-time safety
- Fetch interceptor ordering constraint is hidden from consumers
- All serverless workflow activities now work at runtime (bug fix)

## Impact

- `@stigmer/runner` is now a library-first package with a clear public API surface
- Existing CLI usage (`npx stigmer-runner`) is preserved via `./cli` export
- Zero regressions: `tsc --noEmit` clean, 1367/1368 tests pass (1 pre-existing failure unrelated to this change)
- Foundation for T04 (per-session task queue routing) and T05 (Java control plane refactor)

## Related Work

- Part of project `20260520.01.runner-architecture-simplification`
- Follows T02 (Runner API proto deletion) completed earlier in the same day
- Enables T04 (per-session task queue routing) — the factory's `taskQueue` option is the integration point
- Research: `_projects/2026-05/20260518.01.unified-runner-migration/research.control-plane-runner-architecture-review/04.report.gemini.md`

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~30 minutes)
