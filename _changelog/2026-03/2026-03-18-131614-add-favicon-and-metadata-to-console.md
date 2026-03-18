# Add Favicon and Branded Metadata to Stigmer Console

**Date**: March 18, 2026

## Summary

Added the Stigmer favicon to the Console web app and updated the browser tab title and meta description to reflect the platform's identity as agent infrastructure for platform builders.

## Problem Statement

The Console web app had no favicon configured — the browser showed a default blank icon in the tab. The page title ("Stigmer Console") and description ("Stigmer Web Console") were placeholder text that didn't communicate the product's value proposition.

### Pain Points

- No visual brand recognition in the browser tab
- Generic title/description gave no indication of what Stigmer does
- Inconsistency with the sales site at stigmer.ai, which had full favicon and metadata setup

## Solution

Copied the existing favicon assets from the sales site (`site/public/`) into the Console (`client-apps/web/public/`) and updated the Next.js metadata in the root layout.

## Implementation Details

- Created `client-apps/web/public/` with four icon files: `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`
- Updated `client-apps/web/src/app/layout.tsx` metadata:
  - Title: `Stigmer — Agents for Your Platform`
  - Description: `Embed AI agents into your platform. SDKs, sandboxing, and orchestration — ready to integrate.`
  - Icons: full `metadata.icons` configuration matching the sales site pattern

## Benefits

- Consistent brand identity across sales site and Console
- Browser tab now shows the Stigmer logo
- Title and description communicate the platform-for-platforms positioning

## Impact

Console-only change. No SDK or backend impact. SDK consumers provide their own favicons for host applications.

---

**Status**: Production Ready
