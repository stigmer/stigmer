# BYOA Guide: Acknowledge Settings CRUD

**Date**: April 13, 2026

## Summary

Added a "Manage OAuth apps from Settings" section to the BYOA guide (`bring-your-own-oauth.mdx`) to acknowledge the new OAuth App CRUD settings page as a second entry point for creating org-level OAuth apps. This prevents the documentation from implying that the BYOA dialog on MCP server detail pages is the only way to create OAuth apps.

## Problem Statement

The BYOA guide was written when the Settings > OAuth Apps page was read-only. After the OAuth App CRUD settings change (`2026-04-13-195337-oauth-app-crud-settings.md`), users can now create, edit, and delete OAuth apps directly from Settings. The guide needed to acknowledge this second path to avoid becoming factually incomplete.

### Pain Points

- The BYOA guide implied the only way to create an org-level OAuth app was through the BYOA dialog
- Platform builders with custom MCP servers (no platform template) had no documented path for registering OAuth apps independently

## Solution

Added a brief section between "Remove a custom app" and "What's next" that:

1. Explains all org OAuth apps appear in Settings > Configuration > OAuth Apps
2. Notes that apps can be created from scratch there (full form, not template-cloned)
3. Clarifies the distinction: BYOA dialog clones and binds; Settings page creates standalone apps referenced via `auth.oauth_app_ref`

No demo added — standard settings CRUD does not warrant a ScenarioPlayer scenario.

## Impact

- **Readers**: BYOA guide now acknowledges both creation paths, preventing confusion when users discover the Settings page
- **Files changed**: 1 modified (`bring-your-own-oauth.mdx`), 1 project tracking update (`next-task.md`)

## Related Work

- OAuth App CRUD Settings — `_changelog/2026-04/2026-04-13-195337-oauth-app-crud-settings.md`
- BYOA Guide and Demo (T04) — `_changelog/2026-04/2026-04-13-193555-byoa-guide-and-demo.md`
- MCP Integration Docs project — `_projects/2026-04/20260413.02.mcp-integration-docs/`
- Deferred: T08 "Custom integration OAuth setup guide" added to project task map for future work

---

**Status**: ✅ Production Ready
