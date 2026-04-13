# SDK Public Clients Now Inherit from Generated Aggregate

**Date**: April 13, 2026

## Summary

Refactored the TypeScript, Python, and Java SDK public client classes to extend (inherit from) their code-generated `GeneratedClient` aggregate, following the pattern the Go SDK already uses. This eliminates the manual resource-client wiring that caused `OAuthAppClient` to be missing from the public API surface despite being present in the generated layer.

## Problem Statement

Each SDK has two layers: a **code-generated** `GeneratedClient` that automatically includes every resource client, and a **hand-written** public wrapper (`Stigmer` in TS, `StigmerClient` in Python/Java) that adds config, transport, search, and GitHub clients. The hand-written wrappers manually listed every resource sub-client — import, declare, assign — creating a maintenance gap.

### Pain Points

- When codegen added `OAuthAppClient`, it appeared on `GeneratedClient` automatically but was never wired through the hand-written wrappers
- The TypeScript `Stigmer` class had 18 imports, 18 field declarations, and 18 constructor assignments that duplicated the generated aggregate
- The same duplication existed in Python (`StigmerClient`) and Java (`StigmerClient`)
- Every new resource type required touching 3 hand-written files across 3 SDKs — easy to forget, impossible to enforce
- The Go SDK already solved this via struct embedding (`*gen.Client`) and never had the problem

## Solution

Applied Go's embedding pattern to TypeScript, Python, and Java: the public client class now **extends** (inherits from) the generated aggregate instead of manually listing fields.

## Implementation Details

### TypeScript (`sdk/typescript/src/stigmer.ts`)

Before: `Stigmer` imported `GeneratedClient`, created it internally, and manually copied 18 fields.

After: `Stigmer extends GeneratedClient`. The constructor calls `super(transport)` after creating the transport from config. Only `baseUrl`, `search`, `github`, and `_tokenProvider` remain as own properties.

Lines changed: 128 → 78 (40% reduction).

### Python (`sdk/python/src/stigmer/_client.py`)

Before: `StigmerClient` imported 17 individual client classes, declared 17 type annotations, and assigned 17 fields from `GeneratedClient`.

After: `StigmerClient(GeneratedClient)`. The constructor calls `super().__init__(channel)` after creating the channel. Only `search`, `github`, and `_channel` remain as own properties. Individual client imports removed entirely.

Lines changed: 125 → 76 (39% reduction).

### Java (`sdk/java/src/main/java/ai/stigmer/sdk/StigmerClient.java`)

Before: `StigmerClient` held a `GeneratedClient` field and exposed 17 accessor methods (`agents()`, `mcpServers()`, etc.) that delegated to it.

After: `StigmerClient extends GeneratedClient`. Resource clients are accessed as inherited public fields (`client.agent`, `client.mcpServer`) instead of wrapper methods. Only `search()`, `github()`, and lifecycle remain.

Supporting changes:
- `GeneratedClient.java`: Removed `final` modifier so extension is possible
- `sdk_client_java.go` (codegen): Updated to emit `public class` instead of `public final class`
- `StigmerClientTest.java`: Updated to use field access (`client.agent`) instead of method access (`client.agents()`)

### Go (no changes)

Already uses struct embedding (`*gen.Client`) — the pattern all other SDKs now follow.

## Benefits

- **Zero manual wiring for new resources**: When codegen adds a resource client, it appears on the public API automatically in all 4 SDKs
- **Simpler code**: ~130 lines of manual delegation removed across 3 SDKs
- **Consistent pattern**: All SDKs now follow the same architecture (generated aggregate + thin public wrapper that extends it)
- **Prevents the OAuthApp-class of bugs**: The exact scenario that caused the `Cannot read properties of undefined (reading 'listByOrg')` runtime error is now structurally impossible

## Impact

- **SDK consumers**: TypeScript and Python access patterns unchanged (`stigmer.agent`, `stigmer.oauthapp`). Java consumers must migrate from method accessors (`client.agents()`) to field access (`client.agent`) — this is a breaking change for the Java SDK.
- **Codegen maintainers**: No need to touch hand-written wrappers when adding new resource types.
- **Files changed**: 6 (3 SDK wrappers + 1 Java generated + 1 Java test + 1 codegen template)

## Related Work

- OAuth Apps Settings Page (`_changelog/2026-04/2026-04-13-184626-oauth-apps-settings-page.md`) — the feature that exposed this gap
- OAuth BYOA Integration (`_projects/2026-04/20260413.01.oauth-byoa-integration/`) — the project that added `OAuthAppClient` to codegen

---

**Status**: ✅ Production Ready
