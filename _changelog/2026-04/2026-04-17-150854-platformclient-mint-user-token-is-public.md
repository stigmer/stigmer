# PlatformClient `mintUserToken` — Public RPC Contract (T03 OSS)

**Date**: April 17, 2026

## Summary

Aligned the PlatformClient token RPC with how the Java control plane treats public endpoints: `mintUserToken` now declares `is_public = true` on the method (replacing `is_skip_authorization`). Stubs and codegen artifacts were regenerated so clients and metadata registries see the same contract. Identity resolution inside the JWT remains explicitly deferred to T04 (design decision 003).

## Problem Statement

The token RPC was annotated with `is_skip_authorization`, which describes “authenticated caller, skip FGA” — not “no Bearer token.” The global gRPC auth interceptor only skips Bearer validation for `is_public`. Without alignment, `mintUserToken` would still require a Stigmer JWT even though the design calls for client credentials in the request body.

### Pain Points

- Mismatch between proto option semantics and interceptor behavior
- Risk of confusing future readers (`is_skip_authorization` vs “public” token endpoint)
- Downstream stubs and JSON schema needed to match the canonical proto

## Solution

Switched the method option to `is_public = true` and clarified comments: the RPC is public; the handler performs credential validation. Regenerated all affected stubs and synced the platformclient service schema used by codegen.

## Implementation Details

- **Proto**: `apis/ai/stigmer/iam/platformclient/v1/token.proto` — `option (ai.stigmer.commons.rpc.is_public) = true` on `mintUserToken`; documentation updated.
- **Stubs**: Go, Java, TypeScript, Python under `apis/stubs/`; Go copies in `mcp-server/proto/` and `sdk/go/proto/`.
- **Tooling**: `tools/codegen/schemas/services/platformclient.json` updated from proto/codegen pipeline.
- **Project**: `_projects/2026-04/20260417.01.platform-client/design-decisions/003-identity-resolution-deferred-to-t04.md` records JWT `sub` semantics until T04.
- **Operational note**: Full token minting and signing run in **stigmer-cloud** (separate repo/changelog as appropriate).

## Benefits

- Interceptor, method metadata registry, and custom handler context factories agree on “public” semantics.
- Clearer contract for SDK and documentation: no Bearer required for this RPC.
- Single source of truth in proto; regenerated artifacts stay in lockstep.

## Impact

- **API contract**: Behavioral expectation for auth middleware (OSS mirrors cloud descriptors from same protos).
- **Clients**: Regenerated Connect/gRPC stubs pick up descriptor options used at runtime in cloud.
- **Follow-up**: T04 must implement auth provider + identity resolution; JWT `sub` is external user id until then.

## Related Work

- Changelog: `2026-04-17-110512-platformclient-proto-definition.md` (T01 proto foundation).
- Changelog: `2026-04-17-114806-platform-client-backend-crud.md` (T02 cloud CRUD).
- Design: `_projects/2026-04/20260417.01.platform-client/design-decisions/003-identity-resolution-deferred-to-t04.md`.
- Checkpoint: `_projects/2026-04/20260417.01.platform-client/checkpoints/2026-04-17-session-3.md`.

---

**Status**: Production Ready (OSS proto + generated artifacts for this change)  
**Timeline**: Part of T03; cloud runtime in stigmer-cloud completes the feature for deployment.
