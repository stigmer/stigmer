# GitHub Repo Picker: Public Search, Manual URL, and Permission Management

**Date**: March 28, 2026

## Summary

Extended the `GitHubRepoPicker` in `@stigmer/react` to support searching all public GitHub repositories via the GitHub Search API, added a manual URL entry fallback accessible even when GitHub is connected, and added a "Manage access" link to GitHub App installation settings. These changes close three gaps that prevented users from referencing repositories outside their immediate access scope.

## Problem Statement

The repo picker only showed repositories the authenticated user already had access to (via `GET /user/repos`). Three workflows were impossible:

### Pain Points

- A user who wanted to reference a public repository they don't own or collaborate on had no way to find it.
- Once connected to GitHub, the manual URL input disappeared entirely -- there was no fallback for repos not returned by the API.
- If the GitHub App installation was scoped to "only select repositories," there was no in-app path to expand access.

## Solution

Added three capabilities to the existing `GitHubRepoPicker` component, all in the SDK layer (`sdk/react`), with zero Console changes:

1. **Two-mode picker** -- A segmented control ("My Repos" / "All GitHub") switches between the existing user-repos list and a new GitHub Search API-backed search.
2. **Manual URL entry** -- A "Paste a URL" link in the picker footer opens an inline view for entering any git clone URL and branch.
3. **Manage access link** -- A "Manage access" link opens `https://github.com/settings/installations` so users can adjust their GitHub App repository permissions.

## Implementation Details

### New hook: `useGitHubSearch`

**File**: `sdk/react/src/github/useGitHubSearch.ts`

- Calls `GET https://api.github.com/search/repositories?q={query}` with debounced input (350ms)
- Works with or without an auth token (authenticated: 30 req/min; unauthenticated: 10 req/min)
- Returns the same `GitHubRepo` interface as `useGitHubRepos` for seamless interchangeability
- Supports pagination via `hasMore` / `loadMore()`
- Handles rate-limit errors with a user-friendly message

### Updated `GitHubRepoPicker`

**File**: `sdk/react/src/github/GitHubRepoPicker.tsx`

- **Mode toggle**: Segmented control above the search input. "My Repos" preserves all existing behavior (grouped list, recent repos, instant client-side filter). "All GitHub" switches to debounced server-side search.
- **Shared infrastructure**: Both modes share the search input, repo row rendering (`RepoRow`), branch-selection flow, keyboard navigation, and scroll shadows.
- **Refactored sub-components**: Extracted `RepoRow`, `MyReposList`, and `SearchResultsList` for clarity.
- **Manual URL view**: Navigated via "Paste a URL" footer link; uses `ChevronLeftIcon` back-button pattern consistent with the branch selection view.
- **Footer**: Persistent footer with "Paste a URL" and "Manage access" links separated by a subtle dot divider.

### Exports

- `useGitHubSearch` and `UseGitHubSearchReturn` exported from `sdk/react/src/github/index.ts` and the top-level `sdk/react/src/index.ts`
- No breaking changes to `GitHubRepoPickerProps` -- all new features are always-on with zero configuration

## Benefits

- **Public repo discovery**: Users can now search and select any of GitHub's 400M+ public repositories directly from the picker.
- **Universal fallback**: Manual URL entry works for any git host (GitHub, GitLab, Bitbucket, self-hosted), available regardless of connection state.
- **Self-service permissions**: Users who scoped their GitHub App to "only select repositories" can expand access without contacting support.
- **SDK-first**: All changes live in `@stigmer/react` -- platform builders embedding the picker get these capabilities automatically.

## Impact

- **End users**: Three new workflows that were previously impossible.
- **Platform builders**: `GitHubRepoPicker` gains functionality with no API changes; `useGitHubSearch` is independently importable for custom UIs.
- **Codebase**: Net +420 lines across 4 files (1 new, 3 modified). No backend or proto changes required.

## Related Work

- Original `GitHubRepoPicker` and `useGitHubRepos` hook (existing)
- `useGitHubConnection` OAuth flow (unchanged)
- `WorkspaceEditor` orchestration (unchanged -- manual URL fallback now lives in the picker)

---

**Status**: Production Ready
