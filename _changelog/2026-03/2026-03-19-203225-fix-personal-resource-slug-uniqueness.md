# Fix Personal Resource Slug Uniqueness

**Date**: March 19, 2026

## Summary

Fixed a critical multi-user collision bug where personal environments and agent instances used deterministic slugs (e.g., `personal`, `{agent}-personal`), causing `ALREADY_EXISTS` errors when multiple users in the same organization each tried to create personal resources. The fix generates unique slugs at creation time via the codegen-powered SDK, while labels remain the sole lookup mechanism through FGA-scoped list queries.

## Problem Statement

Personal resources (environments, agent instances) are per-user but stored in an org-scoped namespace. The backend enforces a uniqueness constraint on `(org, slug, kind)` — a platform invariant that cannot be relaxed without broader implications.

### Pain Points

- Second user in an org creating a personal environment gets `ALREADY_EXISTS` because the slug `personal` is already taken by the first user
- Same issue for personal agent instances with slug `{agentSlug}-personal`
- The mismatch: lookup was user-scoped (labels + FGA), but creation's uniqueness check was org-scoped (slug)
- `useAgentSetup` had a latent bug: used `env.metadata!.name` instead of `env.metadata!.slug` for environment references, which would break once names became display-friendly
- Instance creation logic was duplicated between `usePersonalAgentInstance` and `useAgentSetup`

## Solution

Replaced deterministic slugs with unique, non-deterministic slugs while keeping labels as the sole identification mechanism. The fix spans three layers:

1. **Codegen** — added `slug?: string` to all generated SDK `*Input` interfaces and wired to `metadata.slug` in proto builders
2. **React SDK** — new `generateSlugSuffix()` utility and `buildPersonalInstanceInput()` shared builder
3. **Hooks** — updated `usePersonalEnvironment`, `usePersonalAgentInstance`, and `useAgentSetup` to use display-friendly names with unique slugs

## Implementation Details

### Codegen source (`tools/codegen/generator/sdk_client_ts.go`)

Added `slug` to the hardcoded metadata field list in two functions:
- `generateTSInputTypes`: emits `slug?: string;` in all `*Input` interfaces
- `generateTSBuildProto`: emits `...(input.slug && { slug: input.slug }),` in both metadata builder paths (oneof and regular spec)

Running `make codegen-clients` regenerated all 17 resource client files consistently.

### New utility (`sdk/react/src/internal/slug.ts`)

`generateSlugSuffix()` returns 8 hex characters from `crypto.randomUUID()`, providing ~4.3 billion combinations per (org, kind) pair. Satisfies the platform slug pattern `^[a-z0-9]+(-[a-z0-9]+)*$`.

### Shared builder (`sdk/react/src/agent-instance/buildPersonalInstanceInput.ts`)

Pure function centralizing personal agent instance creation: name convention (`{agentSlug} Personal`), unique slug (`{agentSlug}-personal-{suffix}`), and label assignment. Eliminates duplication between `usePersonalAgentInstance` and `useAgentSetup`.

### Bug fix in `useAgentSetup`

Two instances of `env.metadata!.name` corrected to `env.metadata!.slug` for environment references. This was a latent bug that would have broken once names became display-friendly (non-identical to slugs).

## Benefits

- **Multi-user orgs work**: Each user can create their own personal environment and agent instances without slug collisions
- **Consistent SDK API**: All 17 resource types now support explicit `slug` in their input types
- **No duplication**: Personal instance creation logic centralized in one pure function
- **No backend changes**: `ResolveSlugStepV2` already accepts explicit slugs; `CreateOperationCheckDuplicateStepV2` continues to enforce org-scoped uniqueness
- **No data migration**: Existing resources with old slugs continue to be found via label-based list queries
- **Display-friendly names**: `name` field can now differ from `slug`, enabling human-readable resource names in list views

## Impact

- **Platform builders**: SDK input types now expose `slug` for all resources, enabling explicit slug control
- **End users**: Personal environments and agent instances will no longer fail in shared organizations
- **Maintainers**: Codegen is the single source of truth for SDK input shapes — no more hand-editing generated files

## Related Work

- Design Decision DD-002 superseded: Option C (deterministic slugs) → Option D (labels + unique slugs)
- Sub-project `20260319.04.sp.env-instance-list-rpcs` added the label-based list RPCs that make label-only lookup possible
- Sub-project `20260319.05.sp.sdk-labels-and-env-var-ops` added labels to SDK input types via codegen

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~45 minutes)
