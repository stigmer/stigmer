# Playwright E2E Structural Test Expansion

**Date**: May 21, 2026

## Summary

Added 52 new Playwright E2E tests across 6 spec files covering settings pages (12 routes), library gaps (skills, MCP servers), error state resilience, accessibility (axe-core WCAG 2.0 AA audits), and responsive sidebar behavior. Fixed 21 stale `data-testid="resource-card"` locators across 6 authorization specs to match actual SDK DOM (`role="listitem"`). Total functional test count: 52 existing + 52 new = 104 tests in 19 files.

## Problem Statement

The Stigmer web console had significant E2E coverage gaps despite having 12 spec files and ~52 tests. Several critical surfaces had zero Playwright coverage.

### Pain Points

- 12 settings routes under `/settings/*` had zero E2E coverage
- `/library/skills` and `/library/mcp-servers` list pages had no dedicated specs
- No error resilience tests -- invalid URLs, missing resources, and 404 behavior untested
- No automated accessibility audits (no axe-core, no keyboard navigation tests)
- No responsive/viewport tests despite sidebar having mobile overlay behavior at < 1024px
- 6 authorization specs used `data-testid="resource-card"` which does not exist in SDK components, causing silent test skips
- Existing specs used fragile anti-patterns: `waitForTimeout`, `.catch(() => false)`, loose `toBeTruthy()` OR chains

## Solution

Created 6 new spec files following strengthened test conventions: `getByRole`/`getByLabel` selectors grounded in verified SDK ARIA contracts, `expect()` auto-waiting instead of fixed sleeps, and `locatorA.or(locatorB)` instead of boolean OR chains.

## Implementation Details

### New spec files

- **`settings.spec.ts`** (24 tests) -- Settings index (sr-only h1, group headings, management sidebar) + parameterized tests for all 10 section routes (heading by `aria-labelledby` ID) + cloud-gate tests using `CloudFeatureNotice` (`role="status"`) detection
- **`library-skills.spec.ts`** (5 tests) -- Heading, search (`"Search skills…"`), workbench (`"Skill workbench"`), "Upload skill" link, scope/view toggles
- **`library-mcp-servers.spec.ts`** (5 tests) -- Heading, search (`"Search MCP servers…"`), workbench (`"MCP server workbench"`), "Add MCP server" link, "Import from file" button
- **`error-states.spec.ts`** (6 tests) -- 404 page with heading + recovery link, sidebar persistence on error pages, inline error states for invalid execution/session/agent/workflow IDs (handles both backend-connected and disconnected scenarios)
- **`accessibility.spec.ts`** (7 tests) -- axe-core WCAG 2.0 AA audits on home/dashboard/library/settings (critical+serious impact), keyboard sidebar navigation, composer keyboard input (Shift+Enter newlines), landmark verification
- **`responsive.spec.ts`** (5 tests) -- Mobile (375px) sidebar open/close/backdrop using `localStorage` init scripts, desktop (1280px) in-flow sidebar without backdrop, collapse+reopen cycle

### Locator fix

Replaced 21 instances of `[data-testid="resource-card"]` with `[role="listitem"]` across 6 authorization spec files. The SDK `ResourceCards` component renders cards with `role="list" aria-label="Resource cards"` and `role="listitem"` -- no `data-testid` exists.

### New dependency

Added `@axe-core/playwright ^4.10.3` to `test/e2e/package.json` for automated accessibility audits.

## Benefits

- Settings pages (12 routes) now have structural E2E coverage detecting crashes, missing headings, and broken cloud/OSS gates
- Library gaps filled: skills and MCP servers list pages verified end-to-end
- Error resilience tested: app handles invalid URLs gracefully without blank screens or uncaught boundaries
- Baseline accessibility audits catch WCAG violations automatically on every test run
- Responsive behavior tested: sidebar overlay, backdrop, and collapse verified at mobile and desktop viewports
- Authorization specs now use correct locators matching actual SDK DOM

## Impact

- **Test coverage**: 52 → 104 functional E2E tests (+100%)
- **Pages covered**: 13 previously untested routes now have structural coverage
- **Accessibility**: First automated axe-core audits in the web console test suite
- **Test quality**: New specs establish higher-quality patterns (no `waitForTimeout`, no `.catch(() => false)`, no `toBeTruthy` OR chains) as a template for future specs

## Related Work

- Part of Workstream D in the pre-deploy integration test expansion project (`_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion`)
- Plan: `.cursor/plans/playwright_e2e_expansion_e116dae9.plan.md`

---

**Status**: Production Ready
**Timeline**: 1 session
