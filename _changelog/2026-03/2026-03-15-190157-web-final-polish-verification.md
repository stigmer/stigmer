# Web Architecture Alignment: Final Polish & Verification

**Date**: March 15, 2026

## Summary

Completed a systematic verification and polish pass across the entire Stigmer web codebase, eliminating unnecessary type assertions, standardizing error handling, fixing build configuration inconsistencies, and establishing a fully clean baseline across all four quality checks (TypeScript, Next.js build, ESLint, Prettier).

## Problem Statement

After 10 sessions of architectural refactoring (three-tier services, domain library decomposition, error handling framework, layout system, dashboard, session views, detail pages), the codebase had accumulated several categories of technical debt:

### Pain Points

- 6 service factories contained `any` type assertions and `eslint-disable` suppressions on Connect-RPC `createClient()` calls, based on an incorrect belief about "generic inference loss" in protobuf-es codegenv1
- Error handling was inconsistent: some components used the standardized `ErrorMessage` component with retry, others displayed raw error strings in custom divs
- Hooks returned `error: string | null` in some places and `Error | null` in others, breaking the contract with `ErrorMessage`
- `next.config.ts` was missing 4 `@stigmer/*` packages in `transpilePackages`, risking build failures
- 3 older packages had vestigial `tsconfig.build.json` files from a pre-source-only setup
- 15 files had Prettier formatting drift
- ESLint flagged `<img>` tags in domain library components that intentionally avoid `next/image` for framework portability

## Solution

Executed a methodical inside-out verification and fix pass: baseline audit, then fixes from the deepest layer (service factories) outward through hooks and components to build config, followed by a final clean verification pass.

## Implementation Details

### Connect-RPC Type Elimination (6 service factories)

Investigated the `any` casts on `createClient()` by examining the `@connectrpc/connect` and `@bufbuild/protobuf` type definitions. Found that `GenService` (extending `DescService`) provides complete method-to-type mapping through `Client<T>`, which uses `MessageInitShape<I>` for inputs and `MessageShape<O>` for outputs. The `any` casts and `as Promise<T>` assertions were entirely unnecessary.

**Affected files**: `agent-query-service.ts`, `mcp-server-query-service.ts`, `skill-query-service.ts`, `session-query-service.ts`, `execution-service.ts`, `org-context.tsx`

**Removed**: 12 `any` casts, 12 `eslint-disable` comments, 6+ `as Promise<T>` return assertions, misleading comments about "generic inference loss"

### Error Handling Standardization (3 components, 4 hooks)

Migrated `SessionDetailPage`, `ResourceList`, and `AgentSessionHistory` from raw error `<div>` elements to the `<ErrorMessage>` component, which provides error classification (transport/server/unknown), user-friendly messages, and optional retry.

Updated `useAgentList`, `useSkillList`, `useMcpServerList`, and `useAgentSessionList` hooks to return `error: Error | null` (matching `ErrorMessage`'s API) and expose `refetch` as `retry`.

Updated `ResourceListData` interface: `error: string | null` became `error: Error | null`, added `retry?: () => void`.

### Build Configuration Fixes

- Added `@stigmer/agent-ui`, `@stigmer/mcp-server-ui`, `@stigmer/session-ui`, `@stigmer/skill-ui` to `next.config.ts` `transpilePackages`
- Deleted vestigial `tsconfig.build.json` from `agent-execution-ui`, `rpc-client`, `theme` — all packages are source-only
- Added `@next/next/no-img-element: "off"` to ESLint config for `_libs/` files (domain libs use `<img>` for portability)
- Fixed 15 files of Prettier formatting drift

## Benefits

- **Zero `eslint-disable` suppressions** in service layer — all types flow naturally through Connect-RPC generics
- **Consistent error UX** — every error surface uses `ErrorMessage` with classification and retry
- **Clean baseline** — tsc, next build, eslint (--max-warnings 0), and prettier all pass with zero errors/warnings
- **Build reliability** — all workspace packages correctly listed in `transpilePackages`
- **Reduced confusion** — misleading comments about type system limitations removed

## Impact

- **Developer experience**: Service factories are simpler and more trustworthy — no casts to maintain, no suppression comments to question
- **User experience**: Error states are now consistent across all list views, detail pages, and session history — users always see classified errors with retry options
- **Maintainability**: Source-only package consumption is now consistent across all 7 `@stigmer/*` packages, with no vestigial build artifacts

## Related Work

- Phase 5 (Session 7): Three-tier error handling framework — `ErrorMessage` component, transport interceptors, error classification
- Phase 6 (Session 8-9): Domain library decomposition — `@stigmer/*` packages established as source-only
- Phase 7 (Session 10): Detail page views — established resource detail patterns

---

**Status**: Production Ready
**Timeline**: 1 session (Session 11 of Web Architecture Alignment project)
