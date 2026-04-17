# Design Decision: Account Linking Deferred

**Date**: 2026-04-17
**Status**: Accepted
**Context**: T01 planning discussion

## Decision

Account linking (unifying identity accounts across auth paths) is a future project, not a blocker for PlatformClient launch.

## Rationale

When the same human accesses Stigmer through multiple auth paths (e.g., Auth0 direct login AND PlatformClient token minting), they get separate IdentityAccount records. This could cause confusion if a user sees different sessions/permissions depending on how they authenticated.

However:
1. This is **not a PlatformClient-specific problem** — IdentityProvider federation has the same issue today
2. The primary PlatformClient use case (embedded components) means users typically **never visit the Console** — they only interact through the platform builder's app
3. Account linking is a well-understood pattern (email-based matching with consent) that can be added later without breaking changes

## Impact

- PlatformClient can launch without account linking
- Users accessing Stigmer through multiple auth paths will have separate identity accounts
- This is documented as a known limitation
- A future project should address email-based account linking across all auth paths when the first real platform builder reports the issue

## Alternatives Considered

- **Eager email-based linking at mint time**: Rejected — requires email verification flow, adds complexity to the MVP
- **Blocking PlatformClient until account linking is built**: Rejected — over-engineering for an edge case
