---
name: Flip default to inline
overview: Make inline rendering the only output mode for TTY terminals. Remove the --no-tui flag (now meaningless), update help text/examples/tests/doctor hints. Keep TUI code intact but unreachable from CLI flags.
todos:
  - id: output-mode-logic
    content: "Update `output_mode.go`: remove NoTUI from struct, remove --no-tui flag, simplify resolveOutputMode to JSON-or-inline"
    status: completed
  - id: output-mode-tests
    content: "Update `output_mode_test.go`: remove NoTUI tests, add AlwaysInline test, clean up TERM-related tests"
    status: completed
  - id: run-help-text
    content: "Update `run.go` help text and examples: remove --no-tui references"
    status: completed
  - id: doctor-hint
    content: Update `doctor_checks_runtime.go` hint to remove --no-tui suggestion
    status: completed
  - id: verify-build-tests
    content: Run build and existing tests to confirm nothing breaks
    status: completed
isProject: false
---

# Phase 1: Flip Default to Inline-Only

## What Changes

The CLI currently defaults to alt-screen TUI when stdout is a TTY. We flip that so TTY defaults to inline. No `--tui` flag is added -- inline is the only interactive mode. The TUI code stays in the codebase (unreachable) so we don't lose it.

## Files to Change

All under `client-apps/cli/cmd/stigmer/root/` in the [stigmer](stigmer/) repo.

### 1. `output_mode.go` -- Core logic change

`**outputModeFlags` struct**: Remove the `NoTUI` field entirely. The struct keeps only `JSON bool`.

`**registerOutputModeFlags`**: Remove the `--no-tui` flag registration and the `MarkFlagsMutuallyExclusive` call (only one flag remains, nothing to be exclusive with).

`**resolveOutputMode`**: Simplify to:

```go
func resolveOutputMode(flags outputModeFlags) OutputMode {
    if flags.JSON {
        return OutputJSON
    }
    return OutputInline
}
```

The non-TTY and TERM=dumb checks become redundant since all non-JSON paths return `OutputInline`. Remove them for clarity -- fewer branches, no dead logic.

**Keep the `OutputInteractive` constant** and its `String()` case. The TUI code references it. It just has no path to reach it from the CLI.

**Update the doc comment** on `resolveOutputMode` to reflect the new two-path precedence.

### 2. `output_mode_test.go` -- Update tests

- Remove `TestResolveOutputMode_NoTUIFlag_ReturnsInline` (flag no longer exists).
- Remove or adapt `TestResolveOutputMode_DumbTerminal_ReturnsInline` and `TestResolveOutputMode_TermNotDumb_DoesNotForceInline` -- TERM=dumb no longer matters since everything non-JSON is inline.
- Remove `TestResolveOutputMode_DefaultFlags_AreZeroValues` check for `NoTUI` field.
- Add a new test: `TestResolveOutputMode_NoFlags_AlwaysInline` -- verifies that without `--json`, the result is always `OutputInline` regardless of environment.
- Keep the JSON-related tests (they still apply).
- Keep `TestOutputMode_String` (unchanged).

### 3. `run.go` -- Help text and examples

Update the long-form help string:

- **Remove** the `--no-tui` line from the `OUTPUT MODES` section.
- **Update** the auto-detect description: replace "interactive TUI when stdout is a terminal, inline stream otherwise" with something like "output streams inline to the terminal; use --json for machine-readable output".
- **Remove** the example line `stigmer run agent my-agent --no-tui`.

### 4. `doctor_checks_runtime.go` -- Hint text

Line 105: Change the hint from:

```
"Running in a non-interactive environment — consider --no-tui or --json flags"
```

to:

```
"Running in a non-interactive environment — consider --json flag for scripting"
```

The `--no-tui` suggestion no longer makes sense since inline is already the default.

### 5. `run_stream.go` and `run_session.go` -- No changes needed

The `switch` on `OutputMode` still has a `default:` branch routing to `streamAgentInteractive` / `resumeSessionInteractive`. This is dead code now, but **we intentionally keep it** -- the TUI code stays intact and can be re-enabled by adding a flag later.

### 6. `draft_handler.go` -- No changes needed

`registerDraftFlags` calls `registerOutputModeFlags`, which we already changed. The `outputModeFlags` struct change propagates automatically.

## What We Preserve

- `OutputInteractive` constant and its `String()` case
- All TUI code: `run_stream.go` default branch, `streamAgentInteractive`, `resumeSessionInteractive`, the entire `pkg/executiontui/` package
- The `run_stream_inline.go` renderer (now the primary path)
- `OutputJSON` and `--json` flag (unchanged)

## Risk Assessment

- **Breaking change for `--no-tui` users**: Anyone with `--no-tui` in scripts or aliases will get an "unknown flag" error. This is acceptable because: (a) inline is now the default so they don't need the flag, and (b) this is pre-1.0 software.
- **Dead code**: The TUI branch in `run_stream.go` becomes unreachable. Acceptable per your direction to keep the code.
- **No behavioral change for `--json`**: JSON mode is completely untouched.

