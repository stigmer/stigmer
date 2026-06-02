# Session Notes: 2026-05-29 — Workspace File Listing Phase 3

## Accomplishments

- Implemented desktop workspace file listing (Phase 3) with DD-016 parity
- Rust `list_workspace_files` command using `ignore` crate (9 unit tests)
- JS `useNativeWorkspaceFiles` hook (6 unit tests)
- Wired `workspaceFileLister` into `SessionPage` and `SessionLauncher`
- Chose custom Tauri command over `tauri-plugin-fs` / `tauri-plugin-shell` (user approved)

## Decisions Made

- **DD-P3-001**: Custom Rust command instead of FS/shell plugins — smaller security surface, gold-standard gitignore via `ignore` crate
- **DD-P3-002**: 10K entry cap on Rust side; SDK contract not extended for truncation this phase
- **DD-P3-003**: No capability changes — custom commands don't need ACL entries
- **DD-P3-004**: Git entries return `null` on desktop (repo not cloned until execution)

## Key Code Changes

| File | Change |
|------|--------|
| `client-apps/desktop/src-tauri/src/workspace.rs` | New — file listing command + tests |
| `client-apps/desktop/src/hooks/useNativeWorkspaceFiles.ts` | New — IPC wrapper |
| `client-apps/desktop/src/pages/SessionPage.tsx` | Pass `workspaceFileLister` |
| `client-apps/desktop/src/pages/SessionLauncher.tsx` | Pass `workspaceFileLister` |
| `client-apps/desktop/src-tauri/Cargo.toml` | Added `ignore`, `tempfile` (dev) |

## Learnings

- `ignore` crate only applies `.gitignore` when `.git/` exists — test fixtures need a `.git/` directory
- `_cursor/` design docs are gitignored — changelog captures shipped decisions for the repo

## Open Questions

- Truncation UX when exactly 10K entries — heuristic in `WorkspaceEntryFiles` vs extending lister contract
- Manual smoke test in running desktop app not performed in CI

## Next Session Plan

1. Manual verify: attach local folder in desktop, expand workspace entry, confirm file tree
2. Phase 4: drag-to-reference from tree to composer (`_cursor/phase-4-workspace-file-references.md`)
