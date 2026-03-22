# T01 Review — Developer Feedback

**Date**: 2026-03-22
**Reviewer**: Suresh

## Feedback

### 1. Existing documentation is stale — start fresh, do not salvage

The 112 existing markdown files in `docs/` are AI-generated, stale, and not user-facing quality. They cannot be presented to users. The plan's approach of "triage, fix, and keep" is wrong.

**Requested change**: Archive all existing docs. Start with a clean `docs/` directory and write fresh content from scratch.

### 2. Audience is platform builders, not end users

Stigmer is a platform for platforms. The documentation audience is **platform builders** who will integrate Stigmer into their own products. Every page must answer: "Does a platform builder need this to integrate Stigmer?"

**Requested change**: The content structure (T07 numbered prefixes) must reflect the platform builder's learning journey, not a generic docs structure. Content architecture must be designed before any writing begins.

### 3. Quality over quantity

Fewer excellent docs are better than many mediocre ones. The existing randomly generated content does not meet the bar.

**Requested change**: Phase 2 should include defining a content architecture and writing a small set of high-quality seed docs, not migrating old content.

## Impact on Plan

- T05 (Content Audit) → becomes "Archive existing docs + Design fresh content architecture"
- T07 (Navigation with numeric prefixes) → becomes "Design platform-builder-oriented content structure"
- T06-T08 should work with new, clean content — not migrated old files
- Snipsync (T10-T11) becomes more important — code samples must be real and tested from day one
