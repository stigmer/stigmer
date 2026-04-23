# Dont-Do 005: No Technical-Function Grouping in Console

**Related**: DD-002 (Console Is a Thin Shell)

## The Rule

Do not create top-level directories in `client-apps/web/src/` that group files by technical function — `services/`, `hooks/`, `lib/`, `helpers/`, `utils/` (as a dumping ground), `api/`, `store/`. Group by domain instead.

## Why

Technical-function directories (grouping all hooks together, all services together, all utilities together) mix concerns from unrelated domains into the same directory. A `hooks/` directory might contain `useSession`, `useOrgContext`, `useDeploymentMode`, and `useLibraryNav` — four hooks with no relationship to each other beyond being hooks.

This structure makes it impossible to answer basic architectural questions from the file tree alone:

- "What files are involved in the session domain?" — Scattered across `hooks/`, `components/`, `services/`, `utils/`, `contexts/`.
- "Can I delete the settings feature?" — You'd need to trace through every technical-function directory to find all settings-related files.
- "Does this belong in the SDK or the Console?" — Technical-function directories obscure domain boundaries, making it harder to see when Console code contains SDK-extractable logic.

Domain-organized directories (Workstream B's target: `src/domain/session/`, `src/domain/settings/`, `src/domain/auth/`) make each domain self-contained. All hooks, components, contexts, and utilities for a domain live together. The domain directory is the unit of reasoning.

## Detection

This is a structural review concern, not an automated lint check. During code review, flag PRs that:

- Add new files to a flat `hooks/`, `services/`, `lib/`, or `utils/` directory at `client-apps/web/src/`
- Create new top-level technical-function directories
- Place domain-specific code outside its domain directory

## What To Do Instead

| Instead Of | Do This |
|---|---|
| `src/hooks/useSession.ts` | `src/domain/session/use-session.ts` |
| `src/utils/draft-session.ts` | `src/domain/session/draft-session.ts` |
| `src/contexts/session-nav.tsx` | `src/domain/session/session-nav-context.tsx` |
| `src/services/settings-api.ts` | `src/domain/settings/settings-api.ts` |
| `src/hooks/useDeploymentMode.ts` | `src/domain/auth/use-deployment-mode.ts` |

**Cross-domain utilities** that genuinely serve multiple domains go in `src/domain/_shared/`. But scrutinize this — most "shared" utilities turn out to belong to a single domain once you trace their actual usage.

**Note**: This dont-do describes the target state. The current Console structure uses technical-function directories. Workstream B will perform the actual restructuring. This dont-do establishes the rule that prevents regression after the restructuring is complete.
