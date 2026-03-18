# Session Launcher UX Polish — Persistence, Display, and Dev Proxy

**Date**: March 17, 2026

## Summary

A set of UX improvements to the session launcher: the folder browser now opens at `~` instead of the CLI server's CWD, both the model selector and last-browsed folder persist across sessions via localStorage, workspace entry display shows full paths and org/repo names, and the Next.js dev server proxies filesystem API requests to the Go CLI's web console.

## Problem Statement

Several friction points in the new session launcher degraded the experience:

### Pain Points

- The folder browser opened at the CLI daemon's working directory (wherever `stigmer server` was run from), not the user's home directory — confusing and unpredictable
- Every new session required re-selecting the LLM model and re-navigating to the same project folder — repetitive for returning users
- Local workspace entries showed only the last path segment (e.g., `stigmer`) instead of the full path — ambiguous when multiple projects share a name
- GitHub entries showed just the repo name (e.g., `deepagents`) instead of `org/repo` — loses context for users with repos across multiple organizations
- The workspace entry type badge showed raw enum values (`GIT`, `LOCAL`) in uppercase monospace — not user-friendly
- The folder browser returned 404 during `next dev` because the Next.js dev server doesn't serve `/api/fs/list` — the endpoint only exists on the Go CLI's embedded web console (port 8234)

## Solution

Six targeted changes across the CLI backend, SDK, and web app:

1. **Default to home directory** — Changed the Go `/api/fs/list` handler to default to `os.UserHomeDir()` instead of `os.Getwd()`.
2. **Dev proxy** — Added a Next.js rewrite to proxy `/api/fs/*` requests to `localhost:8234` during development.
3. **Model persistence** — `SessionLauncher` reads/writes `stigmer:session:model` in localStorage, with validation against the model registry to gracefully handle stale IDs.
4. **Folder path persistence** — `WorkspaceEditor` reads/writes `stigmer:folder:last-path` in localStorage and passes it as `initialPath` to `FolderBrowser`.
5. **Full path display** — `deriveNameFromPath` returns the full path; the entry row uses `[direction:rtl] text-left` to truncate from the start so the meaningful trailing segments remain visible.
6. **Org/repo display** — `deriveNameFromGitUrl` returns `org/repo` instead of just `repo`. Entry type badge uses friendly labels (`Local`, `GitHub`) via a `TYPE_LABELS` map.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/embedded/webconsole/api_fs.go` | Default path: CWD → home |
| `client-apps/web/next.config.ts` | Rewrite rule for `/api/fs/*` → `localhost:8234` |
| `client-apps/web/src/components/session/SessionLauncher.tsx` | Model persistence + stale ID validation |
| `sdk/react/src/workspace/WorkspaceEditor.tsx` | Folder persistence, entry display, type labels |
| `sdk/react/src/workspace/useWorkspaceEntries.ts` | Name derivation: full path and org/repo |

### SDK Architecture Notes

- **Model persistence** lives in `client-apps/web/SessionLauncher.tsx` (Console-specific) — the `ModelSelector` SDK component stays a pure controlled component with no persistence opinion.
- **Folder persistence** lives in `sdk/react/src/workspace/WorkspaceEditor.tsx` (SDK) — follows the existing pattern where `useGitHubConnection` stores `stigmer:github:token` in localStorage. Platform builders embedding `WorkspaceEditor` get the convenience automatically.
- All display changes use Tailwind utility classes (`[direction:rtl]`, `text-left`), not inline styles — preserving the class-based override system for platform builders.
- localStorage keys follow the existing `stigmer:<context>:<key>` namespace convention.

## Benefits

- Returning users skip two redundant selections (model + folder navigation) on every session
- Full path display eliminates ambiguity for users working across multiple projects
- Org/repo format matches GitHub's own display convention (Jakob's Law)
- Dev proxy unblocks local development with `next dev` — folder browser works without running the full embedded web console

## Impact

Direct users of the Stigmer Console get a smoother session creation flow. Platform builders inheriting `WorkspaceEditor` get folder persistence and improved entry display for free.

---

**Status**: ✅ Production Ready
