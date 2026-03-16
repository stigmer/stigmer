# Stigmer Web Libraries (`_libs`)

Workspace packages that remain co-located with the web console.

## Current contents

| Directory   | Package          | Purpose                                                    |
| ----------- | ---------------- | ---------------------------------------------------------- |
| `ui/theme/` | `@stigmer/theme` | `cn()` utility, CSS design tokens, shared theme types      |

`@stigmer/theme` is published to npm so platform builders can use the
same design tokens and utility functions that the Stigmer Console uses.

## Where did domain and infra go?

The domain packages (`@stigmer/agent`, `@stigmer/session`,
`@stigmer/agent-execution`, `@stigmer/skill`, `@stigmer/mcp-server`) and
the infrastructure package (`@stigmer/rpc-client`) were replaced by two
SDK packages that live under `sdk/`:

| Package          | Location          | Purpose                                           |
| ---------------- | ----------------- | ------------------------------------------------- |
| `@stigmer/sdk`   | `sdk/typescript/` | Framework-agnostic TypeScript API client (codegen) |
| `@stigmer/react` | `sdk/react/`      | React hooks, provider, and embeddable components   |

## How it works

`@stigmer/theme` is a **source-only** package during development. There
is no build step for local use. Next.js compiles it through SWC via the
`transpilePackages` setting in `next.config.ts`.

The package's `main`, `types`, and `exports` point directly at TypeScript
source files (`./src/index.ts`). The web console resolves them as
workspace symlinks.

For npm publishing, a build step produces compiled JavaScript and type
declarations. See `scripts/publish-libs.mjs`.
