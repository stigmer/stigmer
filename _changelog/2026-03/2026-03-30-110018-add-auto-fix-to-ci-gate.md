# Add Auto-Fix Step to `make check` CI Gate

**Date**: March 30, 2026

## Summary

Added a `make fix` target that auto-fixes lint and formatting issues across all
language stacks (Go, Python, TypeScript) and wired it into `make check` so
auto-fixable problems are resolved before validation runs. Also fixed all
existing lint, type-checking, and ESLint errors that were blocking the gate.

## Problem Statement

Running `make check` would fail on auto-fixable issues — unsorted imports,
unused variables, formatting drift — forcing developers to manually run
separate fix commands for each language before re-running the full gate.

### Pain Points

- Ruff import-sorting (I001) and unused-import (F401) errors required a
  separate `ruff check --fix` invocation per Python project.
- ESLint errors (e.g. `<a>` vs `<Link>`, ref mutations during render) needed
  manual intervention or a separate `--fix` pass.
- `gofmt` was already auto-fixing in the `lint` target but the Python and
  TypeScript stacks had no equivalent auto-fix step.
- Mypy type errors (`LoggerAdapter` vs `Logger`, missing annotations) were
  mixed in with auto-fixable lint, making triage harder.

## Solution

Introduced a dedicated `make fix` target and inserted it into the `check`
pipeline between `tidy` and `lint`:

```
check: tidy fix lint lint-docs format-docs-check libs-build web-build build test
```

## Implementation Details

### New `fix` Makefile target

- `gofmt -s -w .` — format and simplify Go code
- `ruff check --fix` on both `backend/libs/python/graphton` and
  `backend/services/agent-runner`
- `npm run lint -w client-apps/web -- --fix` (prefixed with `-` so
  non-auto-fixable errors don't abort before the lint stage reports them)

### Lint fixes (auto-fixed by ruff)

- **test_tool_call_id_on_events.py** — sorted import block
- **test_tool_wrappers_async.py** — removed unused `time` and `MagicMock`
- **execute_graphton.py** — sorted imports, removed unused `Any` and
  `ResumeResult`, replaced deprecated `IOError` with `OSError`
- **hitl.py** — sorted imports, removed unused `_slim_status_for_temporal`

### Mypy fixes (manual)

- **hitl.py** — added type annotation `graph_input: Command`
- **execute_graphton.py** — cast `activity.logger` (a `LoggerAdapter`) to
  `logging.Logger` at the assignment site, keeping downstream signatures
  unchanged

### ESLint fixes (manual)

- **Sidebar.tsx** — replaced `<a href="/">` with Next.js `<Link href="/">`
- **session-navigation.tsx** — replaced `useEffect`-based state sync with
  React's "adjust state during render" pattern to avoid cascading renders;
  moved ref update into a `useEffect` guarded by `[activeSessionId]`

## Benefits

- `make check` is now self-healing for the most common lint failures.
- Developers no longer need to remember per-language fix commands.
- CI gate failures are reduced to genuinely non-auto-fixable issues (type
  errors, logic bugs, ESLint rules without auto-fix).

## Impact

- All contributors running `make check` locally benefit immediately.
- CI pipelines that call `make check` will auto-fix before validating, reducing
  spurious failures.

## Related Work

- Follows the existing pattern where `gofmt -s -w .` was already in the `lint`
  target.

---

**Status**: ✅ Production Ready
