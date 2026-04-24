# Task T01: Web/SDK Architecture Standards

**Created**: 2026-04-23
**Status**: PENDING REVIEW
**Type**: Refactoring
**Origin**: Gap analysis comparing planton web console refactoring (78-session, 2-project initiative) with stigmer SDK architecture

## Context

Stigmer's SDK architecture (`@stigmer/protos` -> `@stigmer/sdk` -> `@stigmer/theme` -> `@stigmer/react` -> `@stigmer/ink`) is fundamentally stronger than planton's 172-package internal monorepo for its mission as a **platform for platforms**. The single `@stigmer/react` package with clean barrel exports is the correct design for external SDK DX. The `StigmerProvider` + `useStigmer()` pattern is already the IoC bridge. The headless-first architecture and `--stgm-*` theme system are ahead of planton.

However, three practices from planton's refactoring project would strengthen stigmer's existing advantages:

1. **Codified design decisions** -- The SDK-first principles exist in role files but not as traceable, numbered architectural decisions
2. **Console domain organization** -- `client-apps/web/src/` uses feature folders, not domain boundaries that mirror the SDK
3. **Architectural metrics** -- No quantitative tracking of SDK/console boundary health

## Workstream A: Codify Design Decisions and Dont-Dos

### Goal
Document the existing (already-implemented) architectural decisions as formal, numbered design decision files and cursor rules, making them discoverable by AI agents and new contributors.

### Design Decisions to Document

These are not new decisions -- they are decisions that have already been made and are embedded in role files and code conventions. The task is to extract them into standalone, referenceable documents.

| DD# | Title | Source |
|-----|-------|--------|
| DD-001 | SDK-first development: build in `@stigmer/react` first, consume from Console second | `004_web_ux_ui.md` mandate #1 |
| DD-002 | Console is a thin shell: `app/` is routes + page layout, zero domain logic in Console | `004_web_ux_ui.md` mandate #1 |
| DD-003 | Headless-first: data hooks -> behavior hooks -> styled components, all exportable independently | `004_web_ux_ui.md` mandate #2 |
| DD-004 | Zero framework deps in SDK: `@stigmer/react` has no Next.js imports, no Console routing, no app-shell auth | `004_web_ux_ui.md` mandate #1 |
| DD-005 | Theme token compliance: all visual properties via `--stgm-*`, scoped to `.stgm` + `@layer stgm` | `004_web_ux_ui.md` mandate #10 |
| DD-006 | Error messages as UX: hooks outside provider throw descriptive messages with corrective action | `006_ux_designer.md` mandate #6 |
| DD-007 | Generated types are the source of truth: `@stigmer/protos` -> `@stigmer/sdk` typed clients, never raw fetch or hand-rolled types | `004_web_ux_ui.md` SDK architecture |
| DD-008 | Single provider model: `StigmerProvider` + `useStigmer()` is the only IoC point for platform builders | `004_web_ux_ui.md` SDK architecture |

### Dont-Dos to Document

| # | Title | Rationale |
|---|-------|-----------|
| 001 | No Console-specific imports in SDK | `@stigmer/react` must never import from `client-apps/web` or use `@/` paths |
| 002 | No framework dependencies in SDK | No `next/*`, no `next-themes`, no app-router assumptions in `@stigmer/react` |
| 003 | No hardcoded colors or sizes | Every visual property must flow through `--stgm-*` tokens |
| 004 | No opacity modifiers on tokens | Use dedicated token variants (e.g., `text-sidebar-muted-foreground`) not `text-sidebar-foreground/60` |
| 005 | No technical-function grouping in Console | Don't create `services/`, `hooks/`, `lib/` directories that mix domain concerns |

### Deliverables
- 8 design decision files in `_projects/.../design-decisions/DD-001.md` through `DD-008.md`
- 5 dont-do files in `_projects/.../dont-dos/001-*.md` through `005-*.md`
- 1 cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (consolidates the rules for AI agent enforcement)

## Workstream B: Console Domain Organization

### Goal
Restructure `client-apps/web/src/` so the file tree itself answers "does this belong in the SDK or the Console?"

### Current Structure (feature-folder based)
```
client-apps/web/src/
├── app/               # Next.js routes (already route-centric)
├── components/
│   ├── auth/          # Auth providers, guards
│   ├── layout/        # App shell, sidebar, menus
│   ├── providers/     # StigmerTransportBridge
│   ├── session/       # SessionLauncher (Console-specific)
│   ├── settings/      # Settings panels
│   └── ui/            # Error message re-export
├── contexts/          # Org, session-nav, library-nav
├── hooks/             # useDeploymentMode, useStaticRouteParam
├── config/            # Runtime config
├── auth/              # OIDC client
└── utils/             # Draft session helpers
```

### Target Structure (domain-organized)
```
client-apps/web/src/
├── app/               # Next.js routes ONLY (thin wiring to domain/)
├── domain/
│   ├── _shared/       # Cross-domain: app shell, sidebar, error-message re-export
│   ├── session/       # SessionLauncher, draft-session utils, session-nav context
│   ├── settings/      # Settings panels (org-profile, api-keys, members, etc.)
│   ├── library/       # Library navigation context, library page orchestration
│   └── auth/          # OIDC client, auth providers, guards, deployment mode
├── providers/         # Top-level provider composition root (permanent, like planton)
└── config/            # Runtime config
```

### Approach
1. **Audit** current `components/`, `contexts/`, `hooks/`, `utils/` -- classify each file as domain-specific or cross-domain
2. **Create** `src/domain/` with subdirectories mirroring the Console's product areas (not the SDK's 24 modules -- the Console has fewer concerns)
3. **Move** files incrementally, updating imports after each move
4. **Verify** with `make lint` + `make check` after each batch
5. **Document** the `domain/` structure in a `domain/README.md` (like planton's `console/src/domain/README.md`)

### Key Constraint
This restructuring is Console-only. Zero changes to `sdk/react/`, `sdk/theme/`, or `sdk/typescript/`. The SDK packages remain untouched.

## Workstream C: Architectural Metrics

### Goal
Establish quantitative metrics that track SDK/console boundary health, so drift is caught before it compounds.

### Metrics to Track

| Metric | Target | How to Measure |
|--------|--------|----------------|
| `next/*` imports in `sdk/react/src/` | 0 | `rg "from 'next/" sdk/react/src/` |
| `@/` imports in `sdk/react/src/` | 0 | `rg "from '@/" sdk/react/src/` |
| Console imports of `@stigmer/react` | Track count | `rg "@stigmer/react" client-apps/web/src/ --count` |
| Hook-to-component export ratio | >= 1.0 | Count `use*` exports vs component exports in `sdk/react/src/index.ts` |
| Hardcoded color values in Console | 0 | ESLint rule `no-token-opacity-modifiers` |

### Deliverables
- ESLint rule (or extend existing `eslint-plugin-stigmer`): `sdk-import-boundaries` -- forbid `next/*` and `@/` imports inside `sdk/react/src/`
- `make verify-web` target (like planton's `make verify-console`) -- runs lint + typecheck on `client-apps/web` + `sdk/react` in ~30s
- Baseline metrics document in `_projects/.../checkpoints/baseline-metrics.md`

## Execution Order

1. **Workstream A first** (design decisions) -- no code changes, pure documentation, establishes the rules before restructuring
2. **Workstream C second** (metrics) -- establish baseline measurements before restructuring so we can verify the restructuring doesn't degrade anything
3. **Workstream B last** (console domain org) -- the restructuring, verified against the metrics from C

## Risk Mitigation

- **Import breakage**: Move files incrementally (one domain at a time), `make lint && make check` after each batch
- **In-flight work**: Check for open PRs touching `client-apps/web/src/` before restructuring; coordinate or rebase
- **Scope creep**: This project does NOT touch SDK internals. No changes to `@stigmer/react` domain module organization. No new packages.

## Success Criteria

- [ ] 8 design decisions documented as numbered files
- [ ] 5 dont-dos documented
- [ ] 1 cursor rule for web architecture
- [ ] `client-apps/web/src/domain/` exists with domain subdirectories
- [ ] `app/` contains only route wiring (no domain logic)
- [ ] `make verify-web` target exists and passes
- [ ] Baseline architectural metrics documented
- [ ] Zero `next/*` or `@/` imports in `sdk/react/src/` (confirmed by CI)

## Review Process

**What happens next**:
1. **You review this plan** -- consider whether the scope, execution order, and target structure are right
2. **Provide feedback** -- any concerns, changes, or scope adjustments
3. **I'll revise the plan** -- create T01_2_revised_plan.md incorporating feedback
4. **You approve** -- explicit approval to proceed
5. **Execution begins** -- tracked in T01_3_execution.md
