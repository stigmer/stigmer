# Console Domain Organization

This directory organizes Console-specific code by product area rather than
technical function. Each subdirectory groups the components, contexts, hooks,
and utilities that belong to a single area of the Stigmer Console.

## Where does new code go?

Ask one question: **"Would a platform builder embedding Stigmer need this?"**

- **Yes** → It belongs in `@stigmer/react` (SDK), not here.
- **No** → It belongs in `domain/` under the appropriate product area.

### Directory map

| Directory | Purpose |
|-----------|---------|
| `_shared/layout/` | App shell, sidebars, org switcher, user menu — the chrome that wraps every page |
| `_shared/org/` | Organization context and org gate — multi-tenancy infrastructure used across all areas |
| `_shared/hooks/` | Cross-cutting Console hooks (deployment mode, static route params) |
| `_shared/ui/` | Console UI primitives (button, card, dialog, etc.) — thin wrappers over `@stigmer/theme` |
| `session/` | Session page, session launcher, session navigation context, draft session utilities |
| `settings/` | Settings section panels (members, API keys, environments, etc.) |
| `library/` | Library landing, resource list/detail pages, library navigation, breadcrumb |
| `library/agents/` | Agent list and detail pages |
| `library/skills/` | Skill list and detail pages |
| `library/mcp-servers/` | MCP Server list and detail pages |

### Sibling directories (outside `domain/`)

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js routes only — page.tsx, layout.tsx, error.tsx. No domain logic. |
| `auth/` | OIDC client, auth providers, guards. Self-contained module with its own barrel export. |
| `providers/` | Root provider composition (Providers.tsx, StigmerTransportBridge). |
| `config/` | Runtime configuration and environment detection. |

### Rules

1. **`app/` is routes only.** Page files import from `domain/` and render.
   They do not contain domain logic, state management, or complex orchestration.
2. **No cross-domain imports.** `domain/settings/` should not import from
   `domain/session/`. Shared concerns live in `domain/_shared/`.
3. **SDK first (DD-001).** If a component could be useful to platform builders,
   build it in `@stigmer/react` and consume it from here.
4. **Console components stay Console-specific.** This directory is for code that
   depends on Next.js routing, Console auth, or app shell context — things that
   don't belong in the framework-agnostic SDK.
