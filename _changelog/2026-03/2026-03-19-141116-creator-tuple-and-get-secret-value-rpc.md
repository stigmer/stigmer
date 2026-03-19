# Config-Driven Creator Tuple and getSecretValue RPC

**Date**: March 19, 2026

## Summary

Extended the FGA authorization infrastructure with a config-driven `requires_creator_tuple` field and defined the `getSecretValue` proto RPC for creator-only secret retrieval. These changes complete the authorization plumbing for personal environments — the FGA model (T01.1–T01.3), the tuple creation infrastructure (T01.4), and the API contract (T01.5) are all in place. What remains is the backend handler implementation (T01.6) and SDK verification (T01.7).

## Problem Statement

Environments are personal resources that hold sensitive credentials (API keys, tokens). The FGA model introduced a `creator` relation and `can_read_secrets` permission in Session 2 (commit `5fd98510`), but:

1. No `creator` FGA tuple was written at environment creation — the relation existed in the model but was never populated
2. No API endpoint existed for retrieving unredacted secret values — the "reveal" button UX pattern had no backend contract
3. `can_read_secrets` was not in the `ApiResourceIamPermission` enum — it couldn't be used in standard RPC authorization annotations

### Pain Points

- Creator tuple gap: the FGA permission model defined `can_read_secrets: creator` but `creator` tuples were never written, making the permission unreachable
- No single-key secret retrieval: the only way to read environment data included bulk redaction or no redaction (execution engine path), with no middle ground for "reveal one secret"
- Hardcoded tuple patterns: adding new relations like `creator` required either hardcoded kind checks or custom pipeline steps, violating the config-driven design principle

## Solution

Two parallel workstreams across both repos:

1. **T01.4 (Config-driven creator tuple)**: Extended the `AuthorizationConfig` proto with a generic `requires_creator_tuple` boolean flag, set it on environment's `kind_meta`, and implemented `createCreatorRelation()` in `IamPolicyCreationService` — gated entirely by proto configuration
2. **T01.5 (getSecretValue RPC)**: Added `can_read_secrets` to the IAM permission enum, defined `EnvironmentSecretValueInput` message, and declared the `getSecretValue` RPC with standard authorization annotations

## Implementation Details

### T01.4: AuthorizationConfig Extension

Added `bool requires_creator_tuple = 6` to the `AuthorizationConfig` proto message. This follows the file's own design principle: "Configuration-driven: Service reads config, no hardcoded logic." Any future resource needing creator attribution can opt in with a single proto field change — no code changes required.

The environment's `kind_meta` now includes `requires_creator_tuple: true`, causing `IamPolicyCreationService.createTuples()` to write both:
- `environment:<id>#owner@identity_account:<creator_id>` (existing)
- `environment:<id>#creator@identity_account:<creator_id>` (new)

The `createCreatorRelation()` method mirrors `createDirectOwner()` but uses the string `"creator"` as the relation (not an enum value — `IamPolicySpec.relation` is a string field, and FGA relation names don't need to be in `ApiResourceIamPermission`).

### T01.5: getSecretValue Proto Contract

Three additions to stigmer OSS:

1. `can_read_secrets = 25` in `ApiResourceIamPermission` — enables standard RPC authorization annotations
2. `EnvironmentSecretValueInput` in `io.proto` — carries `environment_id` + `key`, both validated with `min_len = 1`
3. `getSecretValue` RPC in `query.proto` — returns a single `EnvironmentValue` (reuses existing message), authorized via `can_read_secrets` on the environment resource

The RPC uses standard authorization annotations (same pattern as `get`, `update`, `delete`), so the existing authorization middleware handles the FGA check automatically — no custom handler authorization needed.

### Design Decision: Config-Driven vs. Alternatives

Three approaches were evaluated:
- **A (Config-driven)**: Extend `AuthorizationConfig` proto — chosen
- **B (Kind-check)**: `if (kind == environment)` in service — rejected (violates config-driven principle)
- **C (Custom step)**: New pipeline step in handler — rejected (duplicates tuple-writing pattern)

Option A was selected because it aligns with the authorization infrastructure's stated design principles, requires zero code changes for future resources, and keeps tuple creation logic centralized in `IamPolicyCreationService`.

## Benefits

- **Zero-code extensibility**: Any future resource needing creator tuples can opt in via proto configuration alone
- **Standard authorization path**: `getSecretValue` uses the same annotation-driven authorization as all other RPCs — no special cases
- **Single-key retrieval**: Limits blast radius (one secret per request), enables per-key audit trails, matches industry UX patterns (AWS, GitHub, 1Password)
- **Clean separation**: FGA tuple creation (infrastructure concern) stays in `IamPolicyCreationService`, not scattered across domain handlers

## Impact

- **FGA tuples**: Every new environment created after this change will have a `creator` tuple alongside the `owner` tuple
- **Existing environments**: No migration needed — environments created before this change will not have `creator` tuples and will fail `can_read_secrets` checks (expected: they were created before the feature existed)
- **Proto consumers**: `getSecretValue` RPC is defined but has no backend handler yet (T01.6) — calling it will return UNIMPLEMENTED until the handler is wired up

## Related Work

- **Parent project**: 20260319.02.agent-picker-personal-env (personal environment flow)
- **FGA model changes**: Commit `5fd98510` in stigmer-cloud (T01.1–T01.3)
- **Previous changelog**: `2026-03-19-134605-fga-personal-resources-auth-model.md`
- **Next**: T01.6 (backend handler), T01.7 (SDK verification)

---

**Status**: ✅ Production Ready (proto + infrastructure; handler pending T01.6)
