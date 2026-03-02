# Humanize Shell Tool Output

**Date**: March 2, 2026

## Summary

Redesigned the execute/shell tool result formatting to feel like a natural terminal experience. Success output is now just the raw command output with no metadata. Failure output surfaces the exit code prominently with stderr. The CLI includes a backward-compatibility layer that strips legacy labels from older backends.

## Problem Statement

When a shell/execute tool completed execution, the user was shown raw internal formatting that no human terminal would ever produce:

```
Exit code: 0
STDOUT:
file1
file2
```

### Pain Points

- `Exit code: 0` shown on every successful command -- zero value information
- `STDOUT:` and `STDERR:` labels added visual noise with no diagnostic benefit
- The formatting made the tool feel like a debug dump rather than a terminal
- Every shell command execution was cluttered with 2-3 lines of metadata before the actual output

## Solution

Separated the formatting into success and failure paths in the backend, and added a defense-in-depth cleaning layer in the CLI for backward compatibility with older backend versions.

## Implementation Details

### Backend: terminal-style output formatting (`tool_wrappers.py`)

Replaced the monolithic result formatting block with two focused helpers:

- `_format_shell_success(stdout, stderr)` -- returns raw output only, no labels, no exit code. If both streams have content, they are concatenated with a newline separator. Empty output returns `"(no output)"`.
- `_format_shell_failure(exit_code, stdout, stderr)` -- returns `"Command failed (exit code N)"` followed by stderr (the error), then stdout if present. The exit code remains in the string so the LLM can reason about failures.

### CLI: backward-compat result cleaning (`format.go`)

Added `CleanShellResult(result string) string` that strips legacy formatting from older backends:

- Strips `"Exit code: 0\n"` prefix (success only -- non-zero exit codes pass through unchanged)
- Strips `"STDOUT:\n"` and `"STDERR:\n"` label lines
- Returns `"(no output)"` if the cleaned result is empty

### CLI: wiring (`render_known.go`)

`resolveDisplayContent` now applies `CleanShellResult()` when the tool's `primaryField` is `"command"`. This covers both the collapsed preview and expanded view through the single existing content resolution path.

### Tests

- **Backend**: 18 new test cases in `test_tool_wrappers.py` covering `_format_shell_success`, `_format_shell_failure`, and full execute tool integration (success/failure/labels/empty output). Updated 2 existing assertions from old to new format.
- **CLI**: 13 new test cases in `render_test.go` covering `CleanShellResult` (8 cases) and shell tool rendering integration with both legacy and new-format results (5 cases).

## Benefits

- Success commands show only what matters: the output. No `Exit code: 0`, no `STDOUT:` label.
- Failures are clearly identified with a human-readable header and the error content.
- The LLM receives cleaner tool results, removing noise that added no reasoning value.
- Backward compatibility is handled transparently -- no coordination needed between backend and CLI deployments.

## Impact

- **End users**: Every shell command execution is cleaner and feels like a real terminal
- **LLM agents**: Receive stripped-down tool results, reducing token waste on formatting noise
- **CLI maintainers**: Shell-specific cleaning is derived from the existing `toolDisplayMap`, not duplicated -- adding new shell tool names propagates automatically
- **Multi-client**: Backend-first fix means any future UI client inherits the clean format

## Related Work

- Previous: Execute tool approval UX improvement (`2026-03-02-032821-improve-execute-tool-approval-ux.md`) -- this is the post-execution counterpart to that pre-execution approval fix
- Separate: Environment variable resolution in command display (`inject_env_spec_into_shell_8734fc8b.plan.md`) -- tracked independently

---

**Status**: ✅ Production Ready
**Files Changed**: 5 (358 additions, 13 deletions)
