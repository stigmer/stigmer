# Demo View Sizing and Fixture Data Polish

**Date**: April 2, 2026

## Summary

Scaled down all demo view components so SDK content renders proportionally within the 380px-tall demo player viewport, and updated fixture data to use generic values instead of screenshot-derived names.

## Problem Statement

SDK components (`ApiKeyListPanel`, `MessageThread`, `EnvironmentVariableEditor`, etc.) are designed for full-desktop layouts with `text-sm` (14px) / `text-xs` (12px) type and generous padding. Inside the miniature demo viewport, this made content feel oversized and crowded — the API key settings page overflowed, and conversation threads appeared disproportionately loud.

### Pain Points

- SettingsView content overflowed the viewport at zoom 0.92
- MessageThread and ArtifactPanel had no zoom at all — text-sm messages and prose looked oversized
- Widget sidebar titles and details were oversized for its 192px width
- ResourceListView cards in SkillsListView were at full SDK size
- UserMenu showed a "System" label on the Appearance row that had no function in the demo
- Fixture data used screenshot-specific API key names and Stigmer-internal env vars

## Solution

Applied targeted CSS `zoom` to each view wrapper, choosing levels based on content density. Updated fixture data to be generic and representative.

## Implementation Details

### Zoom values by view

| View | Before | After | Rationale |
|---|---|---|---|
| SettingsView | 0.92 | 0.75 | Most content-dense; needs most reduction to fit |
| ComposerView (MessageThread/ArtifactPanel) | none | 0.82 | Conversations need readability; moderate reduction |
| WidgetsSidebar | none | 0.85 | Compact sidebar; light reduction |
| SkillsListView (ResourceListView) | none | 0.85 | Resource cards; light reduction |
| ComposerView (SessionComposer) | 0.88 | 0.88 | Already appropriate; unchanged |

### Other fixes

- Removed "System" text from the UserMenu Appearance row
- Bumped MessageThread `max-h` from 320px to 390px to compensate for zoom (effective rendered height remains ~320px)

### Fixture data changes

- API key names: `mcp-server` / `for-resource-management` → `ci-pipeline` / `local-dev`
- Environment variables: kept `GITHUB_TOKEN`; replaced `STIGMER_API_KEY` and `STIGMER_SERVER_ADDRESS` with `OPENAI_API_KEY` and `SLACK_WEBHOOK_URL`

## Benefits

- SDK content now renders at sizes proportional to the demo's hand-crafted nav (text-[10px] / text-[9px])
- Settings page fits comfortably within the viewport without overflow
- Fixture data is generic and doesn't leak internal naming

## Impact

- All demo scenarios that use these views (api-key-setup, skill-creation-tour, quickstart-playback) benefit from the sizing improvements

---

**Status**: ✅ Production Ready
