# Wrong Assumption: Computed Spec Fields Are Preserved During Update

**Date**: 2026-04-17
**Context**: T02 — PlatformClient update handler implementation

## The Assumption

Assumed that the framework's update pipeline would preserve computed spec fields (marked with `computed = true` in proto) from the existing resource when building the new state.

## The Reality

`UpdateOperationBuildNewStateStepV2` calls `clearComputedFields` which strips ALL computed fields from the request, then sets `newState = clearedRequest`. The `preserveResourceIdentifiers` step only restores metadata fields (id, slug, org, visibility) — NOT computed spec fields like `client_id`, `client_secret_hash`, or `secret_fingerprint`.

This means any resource with computed spec fields would lose them on update if no mitigation is applied.

## Impact

For PlatformClient, an unmitigated update would wipe `client_id`, `client_secret_hash`, and `secret_fingerprint` from the database — effectively destroying the credential pair.

## Mitigation

Added a custom `PreserveCredentials` step in `PlatformClientUpdateHandler` that runs after `buildNewState` and copies the three credential fields from the existing resource to the new state.

## Potential Broader Issue

ApiKey has the same computed spec fields (`key_hash`, `fingerprint`). If ApiKey update is ever called, the same data loss could occur. This should be investigated as a framework-level fix — either `UpdateOperationBuildNewStateStepV2` should merge computed fields from the existing resource, or a generic `PreserveComputedFields` step should be added to the update pipeline.
