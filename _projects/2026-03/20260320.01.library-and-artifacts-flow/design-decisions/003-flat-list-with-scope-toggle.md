# DD-003: Flat List with Scope Toggle Over Grouped Lists

**Date**: 2026-03-20
**Status**: Decided
**Participants**: Developer + Architect

## Context

Resource lists need to show items from the user's org and optionally from other orgs (system agents, public resources). Options: group by org (with section headers) or flat list with a toggle.

## Decision

Use a **flat list** with an **org/all scope toggle** (segmented control).

## Rationale

- Grouping by "system" vs "org" adds visual clutter and cognitive overhead
- A flat list with a toggle is simpler to scan and reduces Miller's Law overload
- Default scope is "Org" (user's own resources — what they care about 95% of the time)
- "All" scope includes system agents and public resources
- No visual distinction between "system" and "user" resources in the list — all are treated equally
- Sort is alphabetical within the flat list

## Toggle Design

Segmented control: `[Org] [All]`
- Persisted per resource type in localStorage: `stigmer:library:{type}:scope`
- Keyboard accessible, styled with `--stgm-*` tokens
