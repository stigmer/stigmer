# Design Decision: apply RPC Removed from PlatformClient

**Date**: 2026-04-17
**Status**: Accepted
**Context**: T02 implementation

## Decision

The `apply` (create-or-update) RPC was removed from `PlatformClientCommandController` in `command.proto`.

## Rationale

The `apply` pattern delegates to either `create` or `update` handlers via `ApplyOperationHandlerV2<T>`, which is typed as `OperationHandlerV2<T, T>` — same input and output type. However:

- `create(PlatformClient)` returns `PlatformClientCreateResponse` (resource + one-time secret)
- `apply(PlatformClient)` returns `PlatformClient` (no secret wrapper)

If `apply` delegated to `create` when the resource doesn't exist, the `StreamObserver<PlatformClient>` would receive a `PlatformClientCreateResponse`, causing a type mismatch. Even if we worked around the type system, the one-time secret would be generated but never returned to the caller — the credential pair would be irrecoverably lost.

## Alternatives Considered

1. **apply returns PlatformClientCreateResponse**: Makes the update-via-apply path awkward (returns a wrapper with an empty `client_secret` field).
2. **apply only allows updates, rejects creates**: Adds confusing conditional behavior that contradicts apply's create-or-update semantics.
3. **apply creates without generating credentials**: Breaks the invariant that every PlatformClient has credentials from creation.

## Impact

- PlatformClient requires explicit `create` and `update` calls (no apply shortcut)
- CLI/SDK must use separate `create()` and `update()` methods
- This is consistent with the security-sensitive nature of credential generation — credential creation should be intentional, not implicit via apply
