# On-Page Feedback for Documentation

**Date**: March 24, 2026

## Summary

Added a "Report an issue with this page" link to every documentation page footer. The link opens a pre-filled GitHub Issue with the page title, full URL, and a `documentation` label. Zero backend, zero new dependencies, zero client-side JavaScript -- a server component rendering a single `<a>` tag.

## Problem Statement

Documentation pages had no mechanism for readers to report issues, suggest improvements, or flag outdated content. Feedback was limited to finding the GitHub repository and manually creating an issue with no page context.

### Pain Points

- No feedback path from docs pages to the team
- Readers who found issues had to navigate to GitHub, create an issue from scratch, and manually include the page URL
- No structured way to triage documentation issues separately from code issues

## Solution

A server component (`PageFeedback`) that renders a styled link at the bottom of every docs page. The link constructs a GitHub Issue creation URL with:
- Pre-filled title: `Docs feedback: {pageTitle}`
- Pre-filled body: full page URL and a markdown template prompting the user to describe the issue
- Auto-applied `documentation` label for triage

The design was deliberately simplified from the original plan (thumbs up/down widget) after analysis revealed that the site's static export (`output: "export"`) has no backend for persisting feedback counts, making interactive voting decorative at best.

## Implementation Details

- **New file**: `site/src/components/docs/page-feedback.tsx` -- server component, no `"use client"`, no state management
- **Barrel export**: Added to `site/src/components/docs/index.ts`
- **Integration**: Rendered after `DocsBody` in `site/src/app/docs/[[...slug]]/page.tsx`
- Uses `SITE_CONFIG.githubUrl` from constants (single source of truth for repo URL)
- Uses `URLSearchParams` for correct URL encoding
- Styled with Fumadocs `fd-*` token classes and Lucide `MessageSquarePlus` icon
- Opens in new tab with `target="_blank"` and `rel="noopener noreferrer"`

## Benefits

- Readers can report documentation issues in two clicks (link + submit)
- Issues arrive with page context pre-filled, reducing triage effort
- `documentation` label enables filtering docs issues from code issues
- Zero JavaScript shipped for this feature (server component)
- Zero new dependencies added to the project

## Impact

- All 58 documentation pages now have a feedback link
- Documentation team gains a structured intake channel for reader feedback
- Build verified: 65 pages, zero errors, typecheck clean

## Related Work

- T17: LLM-Friendly Output (Session 14) -- added `CopyMarkdownButton` to the same page layout
- T14: CI Quality Gates (Session 5) -- docs CI pipeline validates the build including this component

---

**Status**: Production Ready
**Timeline**: Session 16 (< 1 hour)
