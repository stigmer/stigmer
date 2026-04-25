# Blog Author GitHub Profiles

**Date**: April 25, 2026

## Summary

Blog posts now show author profile pictures and clickable names that link to GitHub profiles. The author's display name is automatically fetched from the GitHub API at build time, so the only thing a post author needs to specify in frontmatter is their GitHub handle.

## Problem Statement

The blog listing and individual post pages displayed a plain-text author string with no visual identity. This made the page feel sparse and didn't provide readers with a way to discover more about the author.

### Pain Points

- No author avatar or visual identity on blog posts
- Author name was a generic hardcoded string ("Stigmer Engineering") with no link to a profile
- Adding a new blog post required manually specifying both a display name and a handle

## Solution

Introduced a `github` frontmatter field that drives both the avatar image and the display name. GitHub serves public avatar images at `https://github.com/{handle}.png` (works for users and orgs, no API key required), and the GitHub Users API provides the profile's display name. A build-time utility fetches and caches the name so no runtime API calls are needed.

## Implementation Details

- **Schema** (`site/source.config.ts`): Added optional `github` field to the blog frontmatter Zod schema; made `author` optional since it is now derived
- **GitHub utility** (`site/src/lib/github.ts`): New `getGitHubDisplayName()` function that fetches `https://api.github.com/users/{handle}` at build time with in-memory caching across pages; falls back to the raw handle if the API is unavailable
- **Blog listing** (`site/src/app/blog/page.tsx`): Made async to resolve display names for all unique GitHub handles in a single pass; renders a 32px circular avatar alongside a clickable author name
- **Author link** (`site/src/app/blog/author-link.tsx`): Small `"use client"` component that wraps the author name in an `<a>` tag with `stopPropagation` so clicking the author opens GitHub without also navigating to the blog post
- **Individual post** (`site/src/app/blog/[slug]/page.tsx`): Shows a 40px avatar next to the author name and date, linked to the GitHub profile
- **Blog posts** (`blog/*.mdx`): Replaced `author: "Stigmer Engineering"` with `github: "whysosuresh"` in both existing posts

## Benefits

- Author identity is visually prominent with avatar and linked name
- Zero-maintenance author info: just specify a GitHub handle and the name resolves automatically
- Graceful fallback: if `github` is absent, posts render as before; if the API is down, the handle is used as the display name
- Clicking the author name opens the GitHub profile in a new tab

## Impact

Affects the public blog at `stigmer.ai/blog` and all individual blog post pages. No breaking changes — posts without a `github` field continue to work as before.

---

**Status**: ✅ Production Ready
