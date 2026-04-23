# DD-007: Generated Types Are the Source of Truth

**Status**: Accepted
**Date**: 2026-04-23
**Source**: `_roles/004_web_ux_ui.md` — "Schema-Driven Development" section; `_roles/001_architect.md` — Mandate #1 (Ubiquitous Language Is the API)

## Context

Stigmer's API surface is defined in protobuf service definitions. These definitions generate typed clients, request/response types, and resource models that are published as `@stigmer/protos` and consumed by `@stigmer/sdk`. The generated types represent the canonical data model — every field name, every enum value, every nested message structure reflects the domain model as defined by the platform architects.

When frontend code hand-writes TypeScript types to represent API data — even if those types are "correct" at the time of writing — they create a parallel source of truth that drifts from the generated types as the API evolves. A renamed field in proto gets picked up by code generation but not by the hand-written type. A new enum value appears in the generated types but not in the manual copy. Type drift creates runtime bugs that TypeScript should have prevented.

The same applies to API calls. Hand-written `fetch` wrappers bypass the typed resource clients in `@stigmer/sdk`, losing type safety on request parameters, response shapes, and error handling. They also bypass any transport-level concerns (interceptors, retry logic, authentication) that the SDK client manages.

## Decision

The type chain is strictly linear and unidirectional:

```
protobuf definitions → @stigmer/protos (generated) → @stigmer/sdk (typed clients) → @stigmer/react (hooks and components)
```

### Rules

1. **Never hand-write types that duplicate generated types.** If `@stigmer/protos` exports `Agent`, `Session`, `AgentExecution`, those types are imported directly — never redefined as local interfaces.
2. **Never use raw `fetch` or hand-rolled API wrappers.** All API interaction goes through `@stigmer/sdk` resource clients (`AgentClient`, `SessionClient`, `AgentExecutionClient`). These clients are generated from protobuf service definitions and carry the correct request/response types.
3. **Derived types are acceptable.** Frontend-specific type narrowing (`Pick<Agent, 'slug' | 'displayName'>`) or UI-specific types (`AgentListItem` that adds a `selected` boolean to the generated type) are fine — they derive from the generated types rather than replacing them.
4. **Type re-exports for convenience are acceptable.** `@stigmer/react` may re-export commonly used types from `@stigmer/protos` or `@stigmer/sdk` so platform builders don't need to add those packages as direct dependencies.

## Consequences

- **Type safety is end-to-end.** A field renamed in the protobuf definition triggers compile-time errors in every SDK hook and every Console page that uses it. No runtime surprises.
- **API changes are automatically surfaced.** When the API evolves, regenerating `@stigmer/protos` and `@stigmer/sdk` produces TypeScript errors at every callsite that needs updating. This is the desired behavior — silent compatibility is worse than loud incompatibility.
- **SDK hooks have trustworthy return types.** When `useAgent()` returns an `Agent`, the consumer knows that type matches the API exactly — not a stale copy that was last updated three months ago.
- **No `any` as an escape hatch.** Generated types make `any` unnecessary for API data. If a hook or component uses `any` for an API value, it's a sign that the generated type chain is being bypassed.

## Enforcement

- Code review: new types that duplicate fields from `@stigmer/protos` or `@stigmer/sdk` must be flagged as redundant
- Code review: raw `fetch` calls or `XMLHttpRequest` in `sdk/react/src/` or `client-apps/web/src/` must be rejected
- TypeScript strict mode (`noImplicitAny`, `strictNullChecks`) enforced across all packages
- Cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc` (DD-007)
