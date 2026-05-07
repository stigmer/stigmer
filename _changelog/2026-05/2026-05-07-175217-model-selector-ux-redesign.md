# ModelSelector UX Redesign: Harness Dropdown + Enriched Registry

**Date**: May 7, 2026

## Summary

Redesigned the ModelSelector component to support a growing ecosystem of execution harnesses (Cursor, GitHub Copilot, Claude Agent SDK, OpenAI Codex, Devin) with a scalable dropdown-based architecture. Enriched the model registry with human-readable metadata (shortDescription, speedTier) and fixed the default model selection from a hardcoded constant to a dynamic priority-based resolution chain.

## Problem Statement

The ModelSelector was designed for a 2-harness world (native + cursor) and presented models in a flat list with tiny "Stigmer"/"Cursor" tags. With the platform expanding to 6+ harnesses, this approach created visual noise that wouldn't scale.

### Pain Points

- Only 1 model was featured for the native harness — users saw a single option before "Show All"
- Tabs/tags wouldn't scale beyond 2-3 harnesses without layout changes
- No guidance on WHY to pick one model over another (only name + cost tier shown)
- Default model was hardcoded to `claude-sonnet-4.5` regardless of context
- No mechanism for the system to recommend models based on harness, org defaults, or user history

## Solution

Separated the two decisions (harness choice + model choice) into a combined popover with:
1. A harness dropdown at the top (scales to N harnesses linearly)
2. A scoped model list below showing only that harness's catalog
3. Rich metadata (short descriptions, speed badges) for informed selection
4. A dynamic default resolution chain replacing the hardcoded constant

## Implementation Details

### Model Registry Enrichment
- Added `shortDescription` (3-6 word pitch) and `speedTier` (fastest/fast/balanced/slow) to all 40+ model entries
- Fixed `featured` curation: 4 native models (Opus 4.6, Sonnet 4.6, Haiku 4.5, GPT-4o) and 5 cursor models (Auto, Composer 2, Claude 4.7 Opus, Claude 4.6 Sonnet, GPT-5.3 Codex)

### Harness Type Evolution
- `HarnessOption` expanded from `"native" | "cursor"` to include `"copilot" | "claude_code" | "codex" | "devin"`
- Added `HARNESS_META` record with display labels and descriptions for all harnesses
- Added `HARNESS_OPTIONS` ordered list for dropdown rendering

### Component Redesign
- Compact trigger button: `Cursor · Claude 4.7 Opus ▾`
- Harness dropdown (hidden when platform builder locks to single harness)
- Speed tier badges (Fastest/Fast/Balanced/Powerful) replacing raw $/$$/$$$ indicators
- Short descriptions in the curated view
- "Show All" with provider-grouped layout
- New platform builder props: `availableHarnesses`, `curatedModels`, `groupBy`, `showSpeedBadge`, `showDescriptions`, `compact`

### Default Resolution Chain
- New `resolveDefaultModelId()` function with priority: user preference → org default → agent default → harness default → platform fallback
- Phase 1 (implemented): localStorage + featured-model resolution
- Phase 2 (future): Server-side persistence
- Phase 3 (future): Org-level and agent-level defaults

## Benefits

- Adding a new harness = adding one dropdown option + model entries in JSON (zero UI code changes)
- Non-technical users get 3-5 curated options with clear descriptions instead of 1 option or 40
- Platform builders can lock to a single harness and the dropdown disappears entirely
- The default model adapts dynamically to the selected harness and featured curation
- TypeScript types enforce that every new harness has display metadata

## Impact

- **End users**: Clearer model selection with guidance on speed/quality tradeoffs
- **Platform builders**: Granular control over what their users see via new props
- **Platform team**: Adding new harnesses (Copilot, Codex, Devin) requires zero component changes
- **Backend**: Unaffected — same JSON fields consumed, new fields are additive

## Related Work

- Model registry update process (`@update-model-registry` rule)
- Billing policy service (reads same registry, unaffected by new fields)
- ComposerToolbar wiring (will need prop updates when integrating new `onHarnessChange`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
