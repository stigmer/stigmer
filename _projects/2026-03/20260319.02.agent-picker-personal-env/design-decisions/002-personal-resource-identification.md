# Design Decision 002: Personal Resource Identification

**Date**: 2026-03-19
**Status**: Superseded (2026-03-19)

## Context

How do we identify personal Environments and personal AgentInstances programmatically? We need a reliable way to check "does this user already have a personal instance for Agent X?"

## Options Considered

### Option A: Naming convention only
Use deterministic slugs: `personal` for Environment, `{agent-slug}-personal` for AgentInstance.

- Pro: O(1) lookup via `getByReference`, no new APIs
- Con: Pollutes slug namespace, no semantic queryability

### Option B: Labels only
Use `stigmer.ai/personal: "true"` label on resources.

- Pro: Clean, semantic, queryable
- Con: Requires backend search service to support label filtering (may not exist yet)

### Option C: Deterministic naming + labels
Use both. Naming for fast O(1) lookup. Labels for semantic identification and future queryability.

- Pro: O(1) lookup, semantic labels
- Con: **Slug uniqueness is per (org, kind) — deterministic slugs collide in multi-user orgs.** The second user to create a personal environment in the same org gets `ALREADY_EXISTS`.

### Option D: Labels + unique slugs (selected)
Use labels for all lookups (via FGA-scoped label-based list RPCs). Use unique, non-deterministic slugs at creation time. Use `name` for display.

- Pro: No slug collisions, clean display names, label-based lookup scales to any number of users
- Con: No O(1) slug-based lookup (not needed — label-based listing covers all use cases)

## Decision

Option D. Labels are the sole identification mechanism. Slugs are unique but opaque.

| Resource | Name (display) | Slug (unique) | Labels |
|----------|---------------|---------------|--------|
| Personal Environment | `Personal Environment` | `env-personal-{random}` | `stigmer.ai/personal: "true"` |
| Personal AgentInstance | `{agentSlug} Personal` | `{agentSlug}-personal-{random}` | `stigmer.ai/personal: "true"`, `stigmer.ai/for-agent: "{org}/{slug}"` |

Lookup uses `list(org, labels)` with FGA-scoped results. The `name` field is display-friendly (may be duplicate). The `slug` field is unique per (org, kind) as the platform requires.

## Why Option C Was Superseded

Option C assumed deterministic slugs would work because each user would have their own personal resources. However, slug uniqueness is enforced per `(org, kind)` by the generic `CreateOperationCheckDuplicateStepV2` — a platform invariant that is org-scoped, not user-scoped. In multi-user organizations, the second user attempting to create a personal environment with slug `personal` hits `ALREADY_EXISTS`.

The root mismatch: **lookup was identity-scoped** (labels + FGA), but **creation's uniqueness check was org-scoped** (slug). Label-based list RPCs (added in T01) resolved the lookup side. This revision resolves the creation side by generating unique slugs.

## Consequences

- Lookup uses label-based list RPCs with FGA visibility scoping
- Slug generation uses random suffixes (`generateSlugSuffix()` in `@stigmer/react`)
- `name` field is used for display in list views (already supported by `EnvironmentListPanel`)
- No backend changes required — `ResolveSlugStepV2` already accepts explicit slugs
- Existing resources with slug `personal` continue to work (found by label queries)
- No data migration needed
