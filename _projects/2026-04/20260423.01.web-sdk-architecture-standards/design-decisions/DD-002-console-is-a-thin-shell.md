# DD-002: Console Is a Thin Shell

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — Mandate #1 (SDK-First Development), "Where Code Lives" section

## Context

The Stigmer Console (`client-apps/web`) is a Next.js application that serves as the browser-based counterpart to the `stigmer` CLI. It provides execution monitoring, resource management, workflow visualization, organization and IAM administration, and session history.

Because the Console is the most visible surface of the platform, there is a persistent gravitational pull to build domain logic inside it — data transformations, business rules, complex state management, API orchestration. When domain logic accumulates in the Console, it becomes the de facto product instead of the SDK packages. Platform builders cannot access that logic without importing from `client-apps/web`, which is not a published package and carries Next.js and Console-specific dependencies.

The boundary rule is simple: **"Would a platform builder embedding Stigmer into their product need this?"** If yes, it belongs in an SDK package. If no, it belongs in the Console.

## Decision

The `app/` directory in `client-apps/web/src/` contains routes and page layout only. Zero domain logic lives in the Console.

The Console's responsibilities are strictly limited to:

- **Routing** — Next.js App Router pages that map URLs to SDK components
- **Page layout** — Assembling SDK components into full-page compositions with navigation, breadcrumbs, and page chrome
- **App shell** — Sidebar, top bar, org switcher, and other Console-specific navigation
- **Provider composition** — The root provider stack (`StigmerProvider`, auth providers, transport bridges) that wires the SDK to Console infrastructure
- **Authentication flows** — OIDC client configuration, login/logout redirects, auth guards — these are inherently Console-specific

Everything else — data fetching, state management, business logic, UI components with domain semantics — lives in `@stigmer/react` or `@stigmer/sdk`.

## Consequences

- **Console pages are short.** A typical page file imports an SDK component, passes route params as props, and wraps it in page layout. If a page file exceeds ~50 lines of logic (beyond layout and imports), that logic likely belongs in the SDK.
- **The Console cannot drift into a monolith.** Without domain logic, the Console has no reason to grow complex internal module structures. It is a composition layer.
- **Refactoring the Console is low-risk.** Because domain logic lives in the SDK, restructuring Console directories (Workstream B) affects only import paths and page wiring — not business behavior.
- **New Console pages are fast to build.** When domain logic already exists as SDK hooks and components, adding a new Console page is primarily a routing and layout task.

## Enforcement

- Code review: domain logic (data transformations, API calls, complex state) in `client-apps/web/src/app/` or `client-apps/web/src/components/` should be flagged for SDK extraction
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-002)
- Workstream C will measure Console complexity to track thin-shell compliance
