# Tenancy Proto Documentation Cleanup

**Date**: April 4, 2026

## Summary

Brought Organization and Project proto documentation up to the Agent-level quality standard so the auto-generated SDK docs render clean, complete, and professional descriptions for every RPC, field, and enum value.

## Problem Statement

The tenancy proto files (Organization, Project) had documentation gaps that produced visible defects in the generated SDK reference pages.

### Pain Points

- **ManagementMode enum values rendered with empty description cells** — the individual enum values (`self_managed`, `platform_managed`) had no leading comments, so the SDK docs showed blank rows.
- **Authorization details leaked into SDK method summaries** — RPC comments mixed internal authorization requirements (e.g., "Requires: can_view") into the first sentence, which the codegen extracted as the public-facing description.
- **Stub field comments on Organization** — fields like `metadata`, `spec`, and `status` had single-word comments ("metadata", "spec", "status") that added no value in the generated TypeTable.
- **No `overview.md` files** — unlike Agent, neither Organization nor Project had a `docs/overview.md`, so the SDK page lacked a concise introduction with a representative YAML example.
- **Embedded YAML in Project proto comment** — the `Project` message had ~30 lines of YAML examples inside the proto comment, which rendered as a flat paragraph in the SDK page.

## Solution

Applied the same `@internal` separation pattern established for Agent across all tenancy protos, created `overview.md` files, and ensured every field, enum value, and RPC has an SDK-quality first sentence.

## Implementation Details

### Organization (6 files edited, 1 file created)

- **`organization/docs/overview.md`** — Created with 3-sentence description and representative YAML example.
- **`api.proto`** — Replaced stub field comments with proper descriptions. Added `@internal` to the `Organization` message to hide multi-tenancy implementation detail.
- **`command.proto`** — Added `@internal` markers to all four RPCs (`apply`, `create`, `update`, `delete`), moving authorization details behind the marker.
- **`query.proto`** — Added `@internal` markers to `get` and `find`. Changed `find` first sentence to verb-first "List organizations with pagination and filtering."
- **`enum.proto`** — Added individual leading comments to `self_managed` and `platform_managed` enum values.
- **`io.proto`** — Added missing `Organizations.entries` field description, improved message-level comments.
- **`spec.proto`** — Added `@internal` markers to `management_mode`, `identity_provider_ref`, `external_org_id`, and `is_personal` fields.

### Project (3 files edited, 1 file created)

- **`project/docs/overview.md`** — Created with description and two YAML examples (declarative and SDK tracks).
- **`api.proto`** — Stripped embedded YAML examples from message comment, keeping a clean first sentence with internal detail behind `@internal`.
- **`command.proto`** — Added `@internal` markers to all four RPCs.
- **`io.proto`** — Added missing `ProjectId.value` field description.

## Benefits

- Every field, enum value, and RPC in the tenancy protos now has an SDK-quality description.
- No authorization or implementation details leak into the public SDK reference.
- The overview sections match the Agent-level standard with concise descriptions and YAML examples.
- Consistent `@internal` separation pattern across the entire tenancy domain.

## Impact

- **SDK users**: See clean, complete documentation on Organization and Project reference pages.
- **Proto maintainers**: Clear pattern to follow — SDK-facing first sentence, internal details behind `@internal`.
- **Codegen**: No generator changes required — the existing `docStripInternal` / `docFirstSentence` pipeline handles everything.

## Related Work

- Follows the same pattern established in the Agent proto documentation cleanup.
- Part of the broader SDK docs auto-generation initiative on `feat/sdk-docs-auto-generation-improvements`.

---

**Status**: ✅ Production Ready
