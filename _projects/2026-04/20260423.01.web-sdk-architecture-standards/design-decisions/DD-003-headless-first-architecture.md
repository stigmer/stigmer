# DD-003: Headless-First Architecture

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — "The Headless-First Pattern" section, Mandate #2 (Platform-for-Platforms Mindset)

## Context

Platform builders integrating Stigmer have vastly different UI requirements. Some want a drop-in execution viewer that matches their design system. Others want raw data access to build fully custom interfaces. Others want something in between — Stigmer's interaction logic with their own visual components.

A traditional component library forces a single adoption level: take the styled component or build everything from scratch. This creates an all-or-nothing choice that pushes away platform builders whose needs don't align with the library's rendering decisions.

Stigmer's SDK must support three levels of adoption without requiring different packages or import paths.

## Decision

`@stigmer/react` follows a three-layer headless-first architecture. Every feature is built in this order, and each layer is independently importable:

### Layer 1: Data Hooks

Hooks that fetch, cache, and manage API data. They use `@stigmer/sdk` resource clients internally and return typed data, loading states, and error states.

Examples: `useAgent`, `useSession`, `useAgentExecutionList`

These are the primary integration point for platform builders who want full rendering control. A data hook has zero opinions about how its data is displayed.

### Layer 2: Behavior Hooks

Hooks that encapsulate complex interaction logic without rendering. They manage subscriptions, buffering, state machines, reconnection — the hard parts that platform builders should not reimplement.

Examples: `useExecutionStream` (streaming subscription lifecycle), `useApprovalGate` (HITL approve/deny flow)

Behavior hooks may compose data hooks. They return state and callbacks, never JSX.

### Layer 3: Styled Components

Pre-built, themed UI components that compose data hooks and behavior hooks with `@stigmer/theme` tokens. These are the drop-in experience: `<ExecutionViewer executionId="..." />` renders a complete, themed UI.

Styled components are optional. Platform builders who use only hooks never load component code.

## Consequences

- **Three adoption levels from one package.** Full control (hooks only), partial control (hooks + custom rendering with theme tokens), zero-effort (styled components). No separate `@stigmer/react-headless` package needed.
- **Hooks are always exported alongside components.** A platform builder who wants `useSession()` without `<SessionViewer />` imports just the hook. The barrel export from `@stigmer/react` must expose both.
- **Styled components are thin.** A styled component is a composition of hooks + JSX + theme tokens. If a styled component has complex logic that isn't in a hook, that logic must be extracted into a behavior hook — it's likely needed by headless integrators too.
- **Testing is layered.** Data hooks are tested against API mocks. Behavior hooks are tested for state machine correctness. Styled components are tested for rendering and accessibility. Each layer has its own test strategy.
- **Build order enforces the pattern.** Per DD-001, features are built data hook first, behavior hook second, styled component third. This sequence naturally produces the headless-first architecture — you cannot build a styled component before the hooks that power it.

## Enforcement

- Code review: new features in `@stigmer/react` must ship hooks alongside any styled component
- Code review: styled components must not contain logic that belongs in a behavior hook
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-003)
- Workstream C will track the hook-to-component export ratio as a health metric
