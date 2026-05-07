# Fix GitHub Release Notes Rendering

**Date**: May 7, 2026

## Summary

GitHub Releases for all v0.4.x versions were displaying raw commit messages instead of the curated, human-readable release notes stored in annotated tags. Two independent bugs in the release pipeline silently discarded the curated content, causing every release since v0.4.0 to fall back to auto-generated commit logs.

## Problem Statement

Despite the `release-stigmer-oss` rule producing rich annotated tag messages with highlights, categorized changes, and full changelog links, the GitHub Release pages showed only commit SHAs and subject lines.

### Pain Points

- Release pages looked unprofessional — raw commit hashes instead of user-facing narratives
- The curated release notes written during each release were silently thrown away
- Users and contributors had no meaningful summary of what changed between versions
- The problem was invisible locally because `git tag -l --format='%(contents:body)'` worked fine on the developer machine

## Solution

Identified and fixed two independent bugs that conspired to discard curated release notes:

1. **CI checkout missing `fetch-tags: true`** — The `release` job in `release.cli.yaml` used `actions/checkout@v4` with `fetch-depth: 0` but without `fetch-tags: true`. The checkout action passes `--no-tags` to `git fetch` by default, so annotated tag objects were never downloaded. The workflow's `git cat-file -t` check returned "commit" instead of "tag", causing it to fall through to the `git log` fallback.

2. **Git stripping Markdown headings from tag messages** — The `git tag -a -m "..."` command uses `--cleanup=strip` by default, which treats lines starting with `#` as comments and removes them. All Markdown section headings (`## Highlights`, `### Features`, etc.) were silently deleted when tags were created.

## Implementation Details

### CI Workflow Fix (`release.cli.yaml`)

Added `fetch-tags: true` to the checkout step in the `release` job. This removes `--no-tags` from the git fetch command, ensuring annotated tag objects are available for `%(contents:body)` extraction.

### Release Rule Fix (`release-stigmer-oss.mdc`)

Changed the main `v*` tag creation command from `git tag -a` to `git tag --cleanup=verbatim -a`, which preserves all content verbatim including `#`-prefixed lines. Added an explanatory note to prevent future regressions.

### Retroactive Release Notes Repair

Updated GitHub Release notes for v0.4.0, v0.4.1, and v0.4.2 via `gh release edit` with properly structured Markdown including all section headings, highlights, and categorized change lists.

## Benefits

- All v0.4.x releases now display rich, structured release notes with Installation, Highlights, and categorized What's Changed sections
- Future releases will automatically render curated notes from annotated tags
- The release pipeline is now end-to-end validated — notes written locally survive through CI to the GitHub Release page

## Impact

- **Users**: Can now see meaningful release summaries when deciding whether to upgrade
- **Contributors**: Release pages accurately reflect the work that went into each version
- **Release process**: The `release-stigmer-oss` rule's output is no longer silently discarded

## Related Work

- `release-stigmer-oss.mdc` rule — the release orchestration rule that produces annotated tags
- `release.cli.yaml` workflow — the CI pipeline that builds CLI binaries and creates GitHub Releases

---

**Status**: ✅ Production Ready
