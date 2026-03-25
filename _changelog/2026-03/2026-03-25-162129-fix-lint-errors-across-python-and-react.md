# Fix Lint Errors Across Python and React

**Date**: March 25, 2026

## Summary

Resolved four lint and type-check errors caught by `make check` spanning the Python agent-runner backend and the React web console. The fixes address import ordering (ruff), a missing mypy type annotation, synchronous `setState` inside `useEffect` (React compiler), and conditional hook calls violating the Rules of Hooks.

## Problem Statement

Running `make check` on the Stigmer OSS repo failed with four separate lint/type-check errors across three language ecosystems:

### Pain Points

- **ruff I001** in `worker/workspace/__init__.py` — `from collections.abc import Callable` was out of alphabetical order relative to `from dataclasses`.
- **mypy var-annotated** in `worker/worker.py` — `MongoClient(...)` assignment lacked a type annotation, triggering `[var-annotated]`.
- **react-hooks/set-state-in-effect** in `OrgGate.tsx` — two `useEffect` hooks called `setIsProvisioning` synchronously in their bodies, which the React compiler flags as a source of cascading renders.
- **react-hooks/rules-of-hooks** in `OrgSwitcher.tsx` — two `useMemo` calls appeared after early `return` statements, violating the rule that hooks must be called in the same order every render.

## Solution

Each issue was fixed at its root rather than suppressed:

1. **Import reorder** — moved `from collections.abc import Callable` above `from dataclasses import dataclass` to satisfy isort ordering.
2. **Type annotation** — annotated `client` as `MongoClient[dict[str, object]]`.
3. **OrgGate provisioning rewrite** — replaced the `useRef` + dual-`useEffect` pattern with React's sanctioned "adjust state during render" pattern: a `provisioningStarted` state guarded by `if (!provisioningStarted && ...)` and a derived `isProvisioning` boolean. The timeout callback (`setTimeout`) sets `provisioningTimedOut` asynchronously, which is permitted.
4. **OrgSwitcher hook order** — moved `useMemo` calls above the early `return` branches so hooks execute unconditionally.

## Implementation Details

| File | Change |
|------|--------|
| `backend/services/agent-runner/worker/workspace/__init__.py` | Reordered stdlib imports alphabetically |
| `backend/services/agent-runner/worker/worker.py` | Added `MongoClient[dict[str, object]]` annotation |
| `client-apps/web/src/components/auth/OrgGate.tsx` | Replaced ref+effect provisioning with render-time state adjustment; removed `useRef` import |
| `client-apps/web/src/components/layout/OrgSwitcher.tsx` | Moved `useMemo` calls before early returns |

## Benefits

- `make check` passes cleanly end-to-end (all linters, type checkers, and 1271 Python tests).
- OrgGate provisioning logic is simpler — two state variables and one effect instead of one ref, one state, and three effects.
- Aligns with React 19 compiler strict-mode rules, unblocking future React compiler adoption.

## Impact

- **agent-runner**: No behavioral change — import order and type annotation are cosmetic.
- **web console**: OrgGate provisioning flow is functionally identical; OrgSwitcher hook execution order is now deterministic across all render paths.

---

**Status**: ✅ Production Ready
