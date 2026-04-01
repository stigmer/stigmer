# Hero Section: 3D Tilt Hover Animation on Code Preview

**Date**: April 1, 2026

## Summary

Added an interactive 3D tilt/parallax hover animation to the code preview card in the hero section. When users hover over the YAML terminal preview on the right side of the hero, it tilts to follow the cursor with spring physics, creating an engaging "the UI modal moves on hover" effect requested by the design team after reviewing the deployed site.

## Problem Statement

The hero section's code preview card was static — it faded in on scroll but had no interactive hover behavior. After deploying the site, the design team reviewed it and requested an interaction animation where the UI modal moves on hover, matching the interactive feel they envisioned in the Figma design.

### Pain Points

- The code preview card felt flat and non-interactive after the entrance animation completed
- No hover feedback on the hero's most prominent visual element
- The static card didn't match the level of polish expected for the hero section of a developer-focused product

## Solution

Implemented a mouse-tracking 3D tilt effect using Framer Motion's `useMotionValue`, `useSpring`, and `useTransform` hooks. The card tracks the cursor position relative to its bounds and applies `rotateX`/`rotateY` transforms through a perspective projection, with spring physics for natural movement.

## Implementation Details

All changes in `site/src/components/sections/Hero.tsx`:

- **Mouse tracking**: `useMotionValue` stores normalized cursor position (0–1) relative to the card. `handleMouseMove` updates on every pointer move; `handleMouseLeave` resets to center (0.5, 0.5).
- **3D tilt**: `useTransform` maps cursor position to ±8° rotation on each axis. `useSpring` wraps the transforms with `stiffness: 200`, `damping: 20`, `mass: 0.5` for a natural, slightly bouncy feel.
- **Scale lift**: `whileHover` scales the card to 1.02× for a subtle lift effect.
- **Cursor-following glow**: A `radial-gradient` overlay tracks the cursor position, fading in on hover and out on leave, adding depth and light play.
- **Accessibility**: `useReducedMotion` check — users with `prefers-reduced-motion` get the static `CodePreviewCard` with no animation wrapper.
- **Performance**: `will-change-transform` on the motion container; all animated properties are GPU-accelerated (transform, opacity only).

Refactored `CodePreview` into two components:
- `CodePreview` — the interactive wrapper with all motion logic
- `CodePreviewCard` — the pure presentational terminal card (unchanged markup)

Constants extracted to module scope for easy tuning:
- `TILT_DEGREES = 8` — maximum tilt angle
- `SPRING_CONFIG = { stiffness: 200, damping: 20, mass: 0.5 }` — spring physics

## Benefits

- Hero section feels interactive and polished, matching the design team's vision
- Spring-based animation feels natural — no jarring linear movements
- Glow effect adds depth without being distracting
- Fully accessible — respects `prefers-reduced-motion` system setting
- Easy to tune — tilt angle and spring physics are single constants

## Impact

- **Users**: More engaging first impression on the marketing site's hero section
- **Design team**: Delivers the interaction animation requested in the Figma review
- **Developers**: Clean separation of motion logic and presentational markup makes future updates straightforward

## Related Work

- Builds on the existing Framer Motion animation system (`FadeInUp`, `StaggerContainer`) already used in the hero
- Consulted the Figma design via MCP tools to verify the code preview card layout and confirm the designer's intent

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes
