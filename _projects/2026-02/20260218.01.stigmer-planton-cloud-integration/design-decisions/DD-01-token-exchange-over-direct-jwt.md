# DD-01: Token Exchange Over Direct JWT Acceptance

**Date**: 2026-02-19
**Status**: Approved
**Supersedes**: Session 1 design (custom JWT minting + direct validation)

## Decision

Stigmer implements an RFC 8693-style token exchange endpoint. External JWTs are exchanged for Stigmer-native tokens. Stigmer API endpoints only accept Stigmer-issued tokens.

## Context

Session 1 proposed that Stigmer validate external JWTs directly on every API call. External research (10+ case studies, RFC 8693) showed that token exchange is the universal standard for cross-platform auth.

## Consequences

- Stigmer controls token TTL, audience, claims, and revocation
- Audience mismatch solved (external JWT `aud: api.planton.ai` → Stigmer token `aud: stigmer-api`)
- Identity resolution happens once at exchange, not on every API call
- External JWTs never reach Stigmer API endpoints
- Requires building a token exchange endpoint in `stigmer-cloud`

## Industry Precedent

AWS STS, GCP Workload Identity Federation, Azure AD token exchange, Auth0 Custom Token Exchange
