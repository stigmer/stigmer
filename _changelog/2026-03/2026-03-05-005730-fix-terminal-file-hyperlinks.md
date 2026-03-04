# Fix Terminal File Hyperlinks in Stigmer CLI

**Date**: March 5, 2026

## Summary

Fixed terminal file path hyperlinks so that clicking on tool call file paths (e.g., `Read(.stigmer/skills/mcp-server-creator/SKILL.md)`) opens the file locally instead of opening a broken URL in the browser. The fix addresses three independent failure layers: OSC 8 terminal escape sequence compatibility, multi-workspace path resolution gaps, and the lack of a user-controllable escape hatch.

## Problem Statement

When the user Cmd+clicks on tool call file paths rendered by the Stigmer CLI in the terminal, the terminal opens a browser with the raw text as a URL (e.g., `read(.stigmer/skills/mcp-server-creator/SKILL.md)` treated as a web address). The browser shows "This site can't be reached" because the text is not a URL — it's a file path wrapped in tool call formatting.

### Pain Points

- Clicking any tool call file path opens Chrome instead of the file, disrupting workflow
- The entire `Read(path)` text turns into a clickable link, including the `Read` label
- Multi-workspace sessions with paths like `.stigmer/skills/...` fail to resolve because `.stigmer` is a directory inside a workspace, not a workspace root basename
- No way for users to disable hyperlinks when their terminal doesn't support OSC 8

## Solution

A three-layer fix in the `toolrender` package:

1. **BEL terminator**: Switched the OSC 8 string terminator from ST (`\033\\`) to BEL (`\a`/`\007`) for broader terminal compatibility — xterm.js-based terminals (VS Code, Cursor), older iTerm2 builds, and macOS Terminal.app handle BEL more reliably.

2. **Terminal allowlist + env override**: Made `HyperlinksEnabled` detection conservative by default. Added a `TERM_PROGRAM` allowlist (iTerm2, WezTerm, Ghostty, VS Code, tmux, Kitty) and a `STIGMER_HYPERLINKS` environment variable override for explicit user control.

3. **Stat-based path resolution fallback**: Enhanced `resolveWorkspacePath` to stat-probe workspace roots when basename matching fails, fixing `.stigmer/skills/...` style paths in multi-workspace sessions.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/pkg/toolrender/hyperlink.go` | BEL terminator, `STIGMER_HYPERLINKS` env override, `TERM_PROGRAM` allowlist, `isEnvTrue` helper |
| `client-apps/cli/pkg/toolrender/render_compact.go` | `StatFunc` field on `CompactOptions`, stat-probe fallback in `resolveWorkspacePath` |
| `client-apps/cli/pkg/toolrender/hyperlink_test.go` | Updated escape sequence assertions, added env override and allowlist tests |
| `client-apps/cli/pkg/toolrender/render_compact_test.go` | Added stat-based fallback tests with injectable stat stubs |

### Key Design Decisions

- **BEL over ST**: The OSC 8 spec supports both terminators. BEL is shorter, unambiguous, and universally supported. ST (`\033\\`) can be misinterpreted by some terminal parsers where the backslash has other significance.
- **Allowlist over blocklist**: False negatives (plain text) are always safe. False positives (broken browser links) are disruptive. Users with unlisted terminals can set `STIGMER_HYPERLINKS=on`.
- **Injectable `StatFunc`**: Keeps `resolveWorkspacePath` deterministic in tests while defaulting to `os.Stat` in production. The stat-probe only runs as a fallback after basename matching fails, so the common case has no added I/O.

### `HyperlinksEnabled` Detection Order

1. `STIGMER_HYPERLINKS` env var (force on/off, takes precedence)
2. TTY check (must be a terminal file descriptor)
3. `TERM=dumb` / `NO_COLOR` exclusions
4. `TERM_PROGRAM` allowlist (conservative default-off)

## Benefits

- File paths in tool call output become proper `file://` hyperlinks that open in the editor
- Users in unsupported terminals see plain text instead of broken browser redirects
- Multi-workspace sessions correctly resolve hidden-directory paths (`.stigmer/`, `.cursor/`, etc.)
- Explicit `STIGMER_HYPERLINKS` env var gives users full control regardless of auto-detection

## Impact

- **End users**: Clicking tool call paths opens files locally instead of broken browser tabs
- **Multi-workspace users**: `.stigmer/skills/...` and similar paths now resolve correctly
- **CI/CD pipelines**: Hyperlinks remain disabled by default (no TTY), no behavior change
- **Terminal compatibility**: Broader OSC 8 support via BEL terminator

## Related Work

- Initial OSC 8 hyperlink support was added as part of the compact tool rendering system
- The `toolrender` package was recently introduced to consolidate all tool call display formatting

---

**Status**: ✅ Production Ready
