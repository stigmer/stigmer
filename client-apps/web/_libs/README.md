# Stigmer Web Libraries (`_libs`)

Workspace packages under `@stigmer/*` that provide reusable, publishable
React components, hooks, and infrastructure for the Stigmer platform.

The Stigmer web console (`client-apps/web`) is the first consumer. External
platform owners install these packages from npm to embed Stigmer UI in their
own applications.

## Architecture

Three layers with a strict one-way dependency flow:

```
Stigmer Web Console (thin shell — routes, layouts, pages)
    ↓ depends on
Domain layer (_libs/domain/) — @stigmer/react-ui
    ↓ depends on
UI layer (_libs/ui/) — @stigmer/theme
    ↓ depends on
Infrastructure layer (_libs/infra/) — @stigmer/rpc-client
```

**Domain** packages contain business-logic-aware components (execution
streaming, session management). They depend on UI and infra packages.

**UI** packages contain shared visual primitives (theme tokens, utility
functions, reusable UI components). They depend only on infra packages.

**Infrastructure** packages contain transport, auth, and configuration
plumbing. They have no internal dependencies.

### Dependency rules

1. Dependencies flow **downward only**: domain → ui → infra.
2. Libraries **never** import from the console. The `@/` path alias is
   forbidden in `_libs/` (enforced by ESLint).
3. When a library needs something the console owns (auth tokens, navigation,
   notifications), use the **IoC bridge pattern**: the library defines a React
   Context interface, the console provides the implementation via a bridge
   component.
4. Inter-package dependencies use `"*"` version specifiers. npm resolves them
   to the local workspace automatically.

## Packages

| Layer | Directory | Package | Purpose |
|-------|-----------|---------|---------|
| Infra | `infra/rpc-client/` | `@stigmer/rpc-client` | Connect-RPC transport, auth interceptor, service client factory |
| UI | `ui/theme/` | `@stigmer/theme` | `cn()` utility, CSS design tokens, shared theme types |
| Domain | `domain/react-ui/` | `@stigmer/react-ui` | Execution streaming components, hooks, top-level `ExecutionChat` |

## How it works

These are **source-only** packages during development. There is no build step.
Next.js compiles them through SWC via the `transpilePackages` setting in
`next.config.ts`.

Each package's `main`, `types`, and `exports` point directly at TypeScript
source files (`./src/index.ts`). The web console resolves them as workspace
symlinks.

For npm publishing (external consumers), a build step produces compiled
JavaScript and type declarations. See T06 in the project plan.

## Adding a new package

1. Create a directory under the correct layer (`infra/`, `ui/`, or `domain/`).
2. Add `package.json` with `name`, `version`, `private: true`, and
   `main`/`types`/`exports` pointing at `./src/index.ts`.
3. Add `tsconfig.json` extending `../../tsconfig.base.json`.
4. Create `src/index.ts` with your public API exports.
5. Add the package name to `transpilePackages` in `next.config.ts`.
6. Run `npm install` from the repo root to create the workspace symlink.

The root `package.json` uses glob patterns (`_libs/infra/*`, `_libs/ui/*`,
`_libs/domain/*`) so new packages within existing layers are discovered
automatically — no root config edit needed.
