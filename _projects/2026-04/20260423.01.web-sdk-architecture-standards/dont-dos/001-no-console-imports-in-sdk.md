# Dont-Do 001: No Console-Specific Imports in SDK

**Related**: DD-004 (Zero Framework Dependencies in SDK)

## The Rule

`@stigmer/react` must never import from `client-apps/web` or use `@/` path aliases that resolve to Console internals.

## Why

`@stigmer/react` is a published npm package consumed by platform builders in their own applications. `client-apps/web` is an unpublished Next.js application. An import from the SDK to the Console creates a dependency that:

1. **Cannot be resolved** by platform builders — `client-apps/web` is not in their `node_modules`
2. **Couples the SDK to the Console's build system** — `@/` path aliases are configured in the Console's `tsconfig.json` and do not exist in the SDK's module resolution
3. **Reverses the dependency direction** — The Console depends on the SDK, never the reverse. A bidirectional dependency makes both packages unreleasable independently.

## Detection

```bash
# Must return zero results
rg "from '@/" sdk/react/src/
rg "from '\\.\\./" sdk/react/src/ --glob '!*.test.*'  # relative imports reaching outside sdk/react/
rg "client-apps" sdk/react/src/
```

ESLint rule `sdk-import-boundaries` (Workstream C) will automate this check.

## What To Do Instead

- If SDK code needs functionality that currently lives in the Console, **move that functionality to the SDK** (into `@stigmer/react` or `@stigmer/sdk`), then import it from there in both the SDK and the Console.
- If the functionality is genuinely Console-specific (auth flow, routing, app shell), **it does not belong in the SDK**. The SDK component should accept the needed data as a prop or callback, letting the Console pass it in.
- If the functionality is shared infrastructure (e.g., a utility function), move it to `@stigmer/sdk` or a shared utilities package.
