# getSecretValue Full Stack: Creator-Only Secret Retrieval

**Date**: March 19, 2026

## Summary

Implemented the `getSecretValue` RPC end-to-end across both the OSS Go backend, the stigmer-cloud Java backend, the SDK codegen schema, and a React behavior hook. This completes the secret retrieval layer for personal environments — only the creator of an environment can reveal individual secret values, matching the industry-standard "reveal" pattern used by AWS, GitHub, and 1Password.

## Problem Statement

Environments store sensitive credentials (API keys, tokens, connection strings) that are encrypted at rest and redacted in API responses. However, there was no way for the environment creator to retrieve the original unredacted value of a specific secret — a requirement for the "reveal" button in the environment editor UI and for platform builders who need to verify stored credentials.

### Pain Points

- Creators could store secrets but never read them back (only `***REDACTED***` was returned)
- No single-key retrieval — any secret access would require exposing the entire environment
- No React hook for the "reveal" interaction pattern, forcing platform builders to implement their own fetch + state + timeout logic
- The OSS Go backend had no encryption service integration in the environment controller

## Solution

Added a new `getSecretValue` RPC that returns a single decrypted `EnvironmentValue` for a specific key, authorized via the `can_read_secrets` FGA permission (creator-only). Implemented consistently across both backends and exposed through the SDK and React layers.

## Implementation Details

### SDK Codegen Schema

Added `GetSecretValue` to `environment.json` query service methods, enabling auto-generation of typed SDK clients in TypeScript, Go, and Python.

### Go Backend (stigmer OSS)

- Created `get_secret_value.go` handler with a 3-step pipeline: `ValidateProto` → `LoadEnvironmentByID` → `ExtractAndDecryptSingleKey`
- Created new `steps/` package under the environment controller with two custom pipeline steps
- Injected `encryption.SecretService` into `EnvironmentController` (previously unused in OSS — secrets were stored but never decrypted server-side)
- No authorization in OSS (consistent with existing handlers)

### Java Backend (stigmer-cloud)

- Created `EnvironmentGetSecretValueHandler` extending `CustomOperationHandlerV2<EnvironmentSecretValueInput, EnvironmentValue>`
- Pipeline: `validateFieldConstraints` → `authorize` → `LoadAndExtractSecret` → `sendResponse`
- Authorization uses `field_path = "environment_id"` from proto annotations — the standard authorize step extracts the ID via `ApiRequestAuthorizationResourceIdExtractor` and checks `can_read_secrets` permission
- `LoadAndExtractSecret` inner class loads the environment from MongoDB, finds the key, and decrypts via `EnvironmentSecretService`

### React Hook (`@stigmer/react`)

- Created `useRevealSecretValue` — a headless behavior hook following the imperative action pattern
- `reveal(environmentId, key)` fetches and decrypts, `clearRevealedValue()` clears state
- Auto-clear after 30 seconds (configurable via `autoClearMs`) to prevent sensitive values from lingering
- Cleanup on unmount: cancels timers, nulls out revealed value
- Exported from `@stigmer/react` barrel — platform builders import `useRevealSecretValue` alongside `useEnvironment`

## Benefits

- **Single-key blast radius**: Only one secret value is ever in transit or in component state, not the entire environment
- **Per-key audit trails**: Each reveal is a distinct RPC call, enabling fine-grained audit logging
- **Creator-only security**: Not even operators or admins can read secret values — only the identity that stored them
- **Auto-clear UX**: 30-second timeout prevents forgotten "revealed" secrets from lingering in browser state
- **SDK-first**: Platform builders get a typed `getSecretValue()` method and a `useRevealSecretValue()` hook with zero Console dependencies

## Impact

- **Environment creators**: Can now verify stored credentials via the UI ("reveal" button)
- **Platform builders**: Get a headless hook for building their own secret reveal UX
- **Security posture**: Least-privilege enforcement — secrets are returned only to their creator, one key at a time
- **OSS parity**: Go backend now handles secret decryption identically to the Java cloud backend

## Related Work

- FGA model changes for personal resources (Session 2: `5fd98510`)
- Creator tuple wiring via `requires_creator_tuple` config (Session 3: `c06e0d27`)
- Parent project: `20260319.02.agent-picker-personal-env` (Phase 2 dependency)

---

**Status**: ✅ Production Ready (pending proto/SDK regeneration)
**Timeline**: 1 session (~2 hours)
