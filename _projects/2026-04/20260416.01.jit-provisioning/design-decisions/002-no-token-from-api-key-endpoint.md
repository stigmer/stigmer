# DD-002: No "Token from API Key" Endpoint

**Date**: 2026-04-16
**Status**: Approved
**Context**: User requested an endpoint to generate short-lived tokens from API keys

## Decision

Do not build an API key to token exchange endpoint. The user's request is a symptom of the provisioning friction, not a real architectural need.

## Rationale

The user's flow:
1. Users authenticate on their platform → get a platform JWT
2. Platform JWT is passed to Stigmer React components via `getAccessToken`
3. Stigmer validates the JWT against the registered IdP

The platform JWT **is** the Stigmer token. The SDK's `getAccessToken` callback returns it, and it's sent as `Authorization: Bearer` on every request. No second token is needed.

The user asked for the API key endpoint because step 3 fails today when no federated account exists. Once JIT provisioning is enabled, the JWT works end-to-end.

## Future Consideration

If a legitimate need arises for API key to short-lived token exchange (CI/CD pipelines, server-side rendering without user context), that would be a separate feature unrelated to federation.
