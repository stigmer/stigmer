# Output Format Integration Tests for --json/--quiet Flags

**Date**: February 26, 2026

## Summary

Added 24 integration tests verifying that the `--json` and `--quiet` output format flags are correctly wired across all 10 mutating CLI commands. These tests validate flag registration, format resolution, JSON output validity, and stdout isolation in quiet mode -- completing Item 6 of the CLI output system refactor project.

## Problem Statement

The CLI output system refactor (Phases 1-5) introduced `--json` and `--quiet` flags on 10 mutating commands, but shipped without integration tests verifying the end-to-end flag-to-output pipeline. While the rendering layer (`pkg/clioutput`) had thorough unit tests, there was no coverage proving that:

### Pain Points

- Flag registration could silently regress (missing `--json` or `--quiet` on a command)
- JSON output from handlers might not be valid parseable JSON
- Quiet mode might leak data to stdout, breaking piping workflows
- The `resolveResultFormat` helper had no direct tests

## Solution

Handler-level integration tests that call the actual command handlers with controlled config state (via `$HOME` override), capture stdout, and verify output structure. The approach tests the real code path from flag resolution through rendering, without requiring gRPC connections or running services.

## Implementation Details

**New file**: `client-apps/cli/cmd/stigmer/root/output_format_test.go` (270 lines)

Four test functions covering the full output format pipeline:

1. **TestFlagRegistration_AllCommandsHaveJsonAndQuietFlags** -- Table-driven test verifying all 10 commands (`delete`, `apply`, `config set/list`, `backend status/set`, `server stop/status`, `server llm list/status`) register `--json` (no shorthand, default false) and `--quiet`/`-q` (default false).

2. **TestResolveResultFormat** -- Unit tests for the flag-to-format mapping: `(false, false)` -> `FormatHuman`, `(true, false)` -> `FormatJSON`, `(false, true)` -> `FormatQuiet`.

3. **TestJSONOutput_SuccessPaths** and **TestJSONOutput_WarningPaths** -- 8 handlers tested with `FormatJSON`. Success paths (config list/set, backend status/set, LLM status) use a known config with `provider: anthropic` to avoid Ollama dependencies. Warning paths (server stop/status, LLM list) exercise the "not running" code paths that produce output without external services. Each test asserts: valid JSON, correct `status` field, expected message content, and sections when applicable.

4. **TestQuietOutput_StdoutIsEmpty** -- Same 8 handlers with `FormatQuiet`. Asserts stdout is completely empty, proving quiet mode correctly routes all output to stderr.

**Test helper** added to `test_helpers_test.go`: `setupTestHome(t, configContent)` creates a temporary `$HOME` with a `.stigmer/config.yaml`, using `t.Setenv` (auto-restores) and `t.TempDir` (auto-cleans).

**Testability tiers**: Commands were divided into fully testable (5 config-only handlers), partially testable (3 with "not running" paths), and flag-wiring-only (2 requiring gRPC mocks). This pragmatic scoping maximized coverage without building speculative mock infrastructure.

## Benefits

- Regression protection for flag wiring across all 10 commands
- Guarantees `stigmer config list --json | jq .` produces valid JSON
- Guarantees `stigmer backend set local --quiet` produces no stdout pollution
- Establishes reusable `setupTestHome` helper for future handler tests
- First handler-level tests in `cmd/stigmer/root/` (all prior tests tested display helpers, not handlers)

## Impact

- **Test coverage**: +24 tests, +292 lines
- **Files**: 1 created (`output_format_test.go`), 2 modified (`test_helpers_test.go`, `BUILD.bazel`)
- **Dependencies**: Added testify (assert/require), cobra, and clioutput to test target
- **Scope**: CLI output system only; no production code changes

## Related Work

- CLI Output System Refactor (Phases 1-5, Items 3-7): `_changelog/2026-02/` series
- Output Format Architecture Decision: `_projects/2026-02/20260226.01.cli-output-system-refactor/design-decisions/DD01-output-format-architecture.md`
- Renderer unit tests: `client-apps/cli/pkg/clioutput/*_test.go`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
