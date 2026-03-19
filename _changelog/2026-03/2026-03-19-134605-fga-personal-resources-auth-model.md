# FGA Personal Resources Authorization Model

**Date**: March 19, 2026

## Summary

Environments and agent instances are now personal resources in the FGA authorization model. Org admins are excluded from ownership, any org member can create environments, and a new `creator` relation with `can_read_secrets` permission enables creator-only unredacted secret retrieval.

## Problem Statement

Environments and agent instances were treated as org-managed resources where admins had implicit ownership through `admin from organization` in the FGA model. This was a security concern for the personal environment flow.

### Pain Points

- Org admins could see personal secrets (GitHub tokens, AWS keys) stored in a member's environment
- Only admins could create environments, blocking the personal environment creation flow for regular members
- No mechanism to distinguish "who can manage this resource" from "who stored these secrets"
- No FGA permission for unredacted secret retrieval — the concept didn't exist in the model

## Solution

Introduced a "Personal Resource" authorization pattern — a third pattern alongside the existing "Open" (templates) and "Restricted" (sensitive data) patterns. Personal resources exclude org admins from ownership entirely, leaving only the creator and platform operators with access.

## Implementation Details

### stigmer-cloud: 5 files changed

**organization.fga** — `can_create_environment` changed from `admin` to `member`. Any org member can now create personal environments under their organization context.

**environment.fga** — Three structural changes:
1. Removed `admin from organization` from the `owner` relation
2. Added `creator` relation (`[identity_account]`) — immutable attribution written once at creation
3. Added `can_read_secrets: creator` — only the person who stored the secrets can read them unredacted

**agent_instance.fga** — Removed `admin from organization` from the `owner` relation. Same rationale: personal preferences and configuration that admins have no need to access.

**README.md** — Documented the new "Personal" access pattern in the authorization patterns table, added example tuples, and added Design Principle #7 (Personal Resources).

**changelog** — Detailed migration notes confirming no tuple migration is needed (`admin from organization` was a computed relation, not stored).

### Key Design Decision: `creator` vs `secret_reader`

The `creator` relation models a real domain concept (immutable attribution) rather than an ad-hoc permission hack. It's extensible — if other resources need creator-specific permissions, the pattern exists. The FGA model reads like a policy: `can_read_secrets: creator`.

## Benefits

- Personal secrets (GitHub tokens, AWS keys) are no longer visible to org admins
- Regular org members can create environments without admin intervention
- Creator-only secret retrieval is modeled at the authorization layer, not in application code
- The FGA model now has three clear access patterns (Open, Personal, Restricted) instead of two

## Impact

- **Org admins**: Lose implicit access to all environments and agent instances (intended)
- **Operators**: No change — retain full access through `operator from organization`
- **Members**: Can now create environments (was admin-only)
- **Backend**: Future `getSecretValue` RPC (T01.5/T01.6) will use `can_read_secrets` for authorization
- **No migration needed**: `admin from organization` was computed, not stored as tuples

## Related Work

- Part of sub-project `20260319.03.sp.env-auth-and-secret-redaction` (parent: `20260319.02.agent-picker-personal-env`)
- Next: T01.4 (write `creator` tuple on env creation), T01.5 (proto `getSecretValue` RPC)
- Previous: Agent picker and session composer integration (`2026-03-19-123632`)

---

**Status**: Production Ready (FGA model changes). Backend tuple writing and proto RPC pending.
**Timeline**: ~30 minutes
