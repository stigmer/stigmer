# API Key Setup Demo Scenario

**Date**: April 2, 2026

## Summary

Added a new demo scenario (`DemoApiKeySetup`) to the Quickstart docs page that visually walks users through the "Sign up and get your API key" flow: starting from the New Session page, navigating through the user profile menu to Settings, and creating an API key. All domain UI is powered by real SDK components — no custom business-logic components were created.

## Problem Statement

The Quickstart page's "Sign up and get your API key" step tells users to navigate to Settings and create an API key, but offers no visual demonstration of how that flow looks in the Stigmer web app.

### Pain Points

- Users reading the Quickstart had no visual reference for the API key creation flow
- The Settings navigation path (profile menu → Settings → API Keys) was described only in text
- The two existing demo scenarios (quickstart-playback, skill-creation-tour) established a pattern that this step was missing

## Solution

Built a third demo scenario following the established three-tier architecture (engine / views / scenarios), reusing the existing `ScenarioPlayer` and `Cursor` engine components and composing real SDK components (`ApiKeyListPanel`, `CreateApiKeyForm`, `ApiKeyCreatedAlert`, `EnvironmentVariableEditor`) for the Settings page view.

## Implementation Details

### SDK Layer Changes

- **`sdk/react/src/demo/samples.ts`**: Added `ApiKeyOverrides` interface, `samples.apiKey()` factory, and `samples.apiKeyList()` list response factory. Follows the exact same protobuf-based factory pattern used by all other resource types.
- **`sdk/react/src/demo/fixtures.ts`**: Added `fixtures.environment.get` helper mapping to `EnvironmentQueryController.get` RPC. This was previously missing — only `getByReference` existed, but `EnvironmentVariableEditor` internally calls `stigmer.environment.get(id)`.

### View Layer Changes

- **`AppShell.tsx`**: Enhanced with `data-cursor-target="user-profile"` on the profile row, `highlightUserProfile` pulse animation prop, and `showUserMenu` prop that renders a `UserMenu` overlay (Settings, Appearance, Sign out) matching the real Console UI. The menu has `data-cursor-target="settings-menu-item"` for cursor targeting.
- **`SettingsView.tsx`** (new): Thin layout wrapper composing four SDK components into a settings page. Controls visual state via props (`apiKeyState: "list" | "creating" | "created"`). Includes a `PrefilledCreateForm` using the same native-setter technique as `TypingComposer` to simulate user input in the timed playback.

### Scenario Layer

- **`scenarios/api-key-setup/steps.ts`**: Discriminated union `ApiKeySetupStep` with 8 views, fixture data for 2 existing API keys and a personal environment with 3 variables, and the step sequence with timing.
- **`scenarios/api-key-setup/index.tsx`**: Main component with `StigmerProvider`, `ScenarioPlayer`, `Cursor`, render switch, and helper functions following the `skill-creation-tour` pattern exactly.

### Integration

- Exported as `DemoApiKeySetup` from the docs barrel, registered in MDX components, and embedded in the Quickstart page's "Sign up and get your API key" step.

## Benefits

- Users see the exact navigation flow for finding and creating API keys before they attempt it themselves
- The demo uses real SDK components, ensuring visual consistency with the actual web app
- The `fixtures.environment.get` addition and `samples.apiKey()` factory are reusable for future demos involving API keys or environment editors
- Zero custom business-domain components — SettingsView is layout-only

## Impact

- **Quickstart page**: Enhanced with visual walkthrough for the first step
- **SDK demo infrastructure**: Gained API key sample factories and environment `get` fixture
- **AppShell**: Now supports user menu overlay, reusable by future scenarios

## Related Work

- [Demo Components Three-Tier Architecture](2026-04-02-164409-demo-components-three-tier-architecture.md)
- [Skill Creation Guided Tour Demo](2026-04-02-141121-skill-creation-guided-tour-demo.md)
- [Quickstart Revision and Demo Improvements](2026-04-02-143113-quickstart-revision-and-demo-improvements.md)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
