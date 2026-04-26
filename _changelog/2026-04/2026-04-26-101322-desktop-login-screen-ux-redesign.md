# Desktop Login Screen UX Redesign

**Date**: April 26, 2026

## Summary

Redesigned the desktop app's login screen to match the premium, crafted feel of Linear, Slack, and Notion. Replaced the placeholder "S" letter with the actual Stigmer molecular logo mark, removed redundant copy and window title bar text, and tightened the visual hierarchy so the screen reads as one cohesive unit rather than disconnected floating elements.

## Problem Statement

The login screen felt unpolished and prototype-like compared to professional desktop apps. Users launching Stigmer for the first time were greeted with a screen that lacked intentional craft.

### Pain Points

- A hardcoded "S" letter served as the logo — read as a placeholder, not a shipped product
- The subtitle "Choose how you'd like to sign in" was redundant filler — the buttons are self-explanatory
- "Stigmer" text in the macOS window title bar was redundant (the heading already says "Sign in to Stigmer") — no premium desktop app does this
- Loose spacing (`gap-8`) between the brand block and buttons created a disconnected layout that felt accidentally empty rather than deliberately spacious
- Button labels used "Sign in with..." while the industry standard (Linear, Notion) uses "Continue with..." to better communicate the multi-step flow

## Solution

Applied a UX-driven redesign informed by competitive analysis of Linear, Slack, and Notion login screens, grounded in Nielsen's heuristics, Gestalt principles, and Jakob's Law.

## Implementation Details

### LoginScreen.tsx

- Replaced `<span>S</span>` with `<img src="/Icon-bw.svg">` — the actual Stigmer molecular logo mark (white paths on transparent background) inside a `size-16 rounded-2xl bg-primary` container
- Removed the subtitle paragraph entirely
- Changed button labels from "Sign in with Google/Email" to "Continue with Google/Email"
- Tightened content block spacing: outer `gap-8` → `gap-6`, brand block `gap-3` → `gap-4`

### tauri.conf.json

- Changed `"title": "Stigmer"` to `"title": ""` — removes the redundant centered text from the macOS title bar while keeping native traffic light buttons

### New Asset

- Copied `Icon-bw.svg` from `client-apps/web/public/` to `client-apps/desktop/public/` for Vite to serve

## Benefits

- First impression matches the quality bar of Linear and Slack
- The actual brand mark (molecular network pattern) is immediately recognizable vs. a generic letter
- Tighter visual hierarchy reads as one cohesive content block, not disconnected islands
- "Continue with..." labels correctly set user expectations for the browser-based OIDC handoff

## Impact

- **Desktop app users**: Improved first-launch experience and brand perception
- **No functional changes**: Auth flow, error handling, and waiting states are untouched

## Related Work

- `2026-04-25-124936-desktop-cloud-auth-pkce-deep-link.md` — Desktop auth PKCE flow
- `2026-04-26-085825-monochrome-theme-preset.md` — Monochrome theme applied to desktop

---

**Status**: ✅ Production Ready
