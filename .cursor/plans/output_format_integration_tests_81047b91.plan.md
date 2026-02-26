---
name: output format integration tests
overview: Add integration tests for the --json/--quiet output format flags across the CLI's 10 mutating commands, testing flag registration on all 10 and handler output for the 8 that are testable without gRPC mocks.
todos:
  - id: test-helper
    content: Add setupTestHome helper to test_helpers_test.go
    status: completed
  - id: flag-tests
    content: Write flag registration + resolveResultFormat tests
    status: completed
  - id: json-tests
    content: Write JSON output tests for 8 handlers (5 success + 3 warning paths)
    status: completed
  - id: quiet-tests
    content: Write quiet output tests for 8 handlers (stdout-is-empty assertions)
    status: completed
  - id: build-bazel
    content: Update BUILD.bazel with new test file and deps
    status: completed
  - id: verify
    content: Run go build, go vet, go test to verify all tests pass
    status: completed
isProject: false
---

# Item 6: Output Format Integration Tests

## Scope and Honest Assessment

The 10 commands fall into two testability tiers:

- **Fully testable** (config-only deps, isolated via `$HOME` override): `config set`, `config list`, `backend status`, `backend set`, `server llm status`
- **Partially testable** (external deps, but have a "not running" code path that produces a `CommandResult` without touching daemons/Ollama): `server stop`, `server status`, `server llm list`
- **Not testable without gRPC mocks**: `delete`, `apply` -- covered by flag wiring tests only

## Files

- **Create**: `[cmd/stigmer/root/output_format_test.go](client-apps/cli/cmd/stigmer/root/output_format_test.go)` -- all output format tests
- **Modify**: `[cmd/stigmer/root/test_helpers_test.go](client-apps/cli/cmd/stigmer/root/test_helpers_test.go)` -- add `setupTestHome` helper
- **Modify**: `[cmd/stigmer/root/BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel)` -- add test file + testify deps

## Test Design

### 1. Flag Registration (all 10 commands)

Table-driven test calling each command constructor and verifying:

- `--json` flag exists, is boolean, defaults to `false`
- `--quiet` / `-q` flag exists, is boolean, defaults to `false`
- Both flags are registered (mutual exclusivity is via `cobra.MarkFlagsMutuallyExclusive`, trusted as library behavior)

Commands under test (constructors accessible since tests are in same package):


| Command                                        | Constructor |
| ---------------------------------------------- | ----------- |
| Using list format since tables are disallowed: |             |


- `stigmer delete` -- `NewDeleteCommand()`
- `stigmer apply` -- `NewApplyCommand()`
- `stigmer config set` -- `newConfigSetCommand()`
- `stigmer config list` -- `newConfigListCommand()`
- `stigmer backend status` -- `newBackendStatusCommand()`
- `stigmer backend set` -- `newBackendSetCommand()`
- `stigmer server stop` -- `newServerStopCommand()`
- `stigmer server status` -- `newServerStatusCommand()`
- `stigmer server llm list` -- `newServerLLMListCommand()`
- `stigmer server llm status` -- `newServerLLMStatusCommand()`

### 2. `resolveResultFormat` Unit Tests

Three cases validating the mapping function in `[output_flags.go](client-apps/cli/cmd/stigmer/root/output_flags.go)`:

- `(false, false)` -> `FormatHuman`
- `(true, false)` -> `FormatJSON`
- `(false, true)` -> `FormatQuiet`

### 3. JSON Output Tests (8 handlers)

Pattern: set up temp `$HOME` with known config, call handler with `clioutput.FormatJSON`, capture stdout via existing `captureStdout` helper, parse as JSON, verify structure.

**Full success-path tests** (use `fullLocalConfig` with `provider: anthropic`):

- `handleConfigList(FormatJSON)` -- expect `status:"success"`, has sections (Backend, LLM, Execution)
- `handleConfigSet("llm.model", "claude-sonnet-4.5", FormatJSON)` -- expect `status:"success"`, message contains "Configuration updated"
- `handleBackendStatus(FormatJSON)` -- expect `status:"success"`, has section with Type field
- `handleBackendSet("local", FormatJSON)` -- expect `status:"success"`, has hints
- `handleLLMStatus(FormatJSON)` -- expect `status:"success"`, has LLM Configuration section

**Warning-path tests** (no daemon/Ollama in temp env):

- `handleServerStop(FormatJSON)` -- expect `status:"warning"`, message "Server is not running"
- `handleServerStatus(FormatJSON)` -- expect `status:"warning"`, message "not running"
- `handleLLMList(FormatJSON)` -- expect `status:"warning"`, message about "local LLM provider"

Each test asserts:

1. stdout is valid JSON (`json.Unmarshal` succeeds)
2. Top-level `status` field matches expected value
3. `message` field is non-empty
4. `sections` present when expected (structural, not brittle text matching)

### 4. Quiet Output Tests (8 handlers)

Same 8 handlers called with `clioutput.FormatQuiet`. Single assertion: **stdout is empty**. The quiet renderer writes only to stderr, so clean stdout proves the format flag is wired correctly and no stray `fmt.Println` leaks data to stdout.

### 5. Test Helper

Add to `[test_helpers_test.go](client-apps/cli/cmd/stigmer/root/test_helpers_test.go)`:

```go
func setupTestHome(t *testing.T, configContent string) {
    t.Helper()
    tmpHome := t.TempDir()
    configDir := filepath.Join(tmpHome, ".stigmer")
    require.NoError(t, os.MkdirAll(configDir, 0755))
    require.NoError(t, os.WriteFile(
        filepath.Join(configDir, "config.yaml"),
        []byte(configContent), 0644,
    ))
    t.Setenv("HOME", tmpHome)
}
```

Uses `t.Setenv` (auto-restores after test) and `t.TempDir` (auto-cleans). Follows existing pattern from `[config_test.go](client-apps/cli/internal/cli/config/config_test.go)` lines 100-118.

### 6. BUILD.bazel Changes

- Add `output_format_test.go` to `go_test.srcs`
- Add test deps:
  - `@com_github_stretchr_testify//assert` (already used in `pkg/clioutput` tests)
  - `@com_github_stretchr_testify//require`
  - `//client-apps/cli/pkg/clioutput` (for `FormatJSON`/`FormatQuiet` constants -- accessible via embed but explicit dep is cleaner)

## Not In Scope

- `stigmer delete` / `stigmer apply` handler output tests -- require gRPC mock infrastructure
- Full e2e tests against a live server
- Testing stderr content for quiet mode (already covered by `[quiet_renderer_test.go](client-apps/cli/pkg/clioutput/quiet_renderer_test.go)`)

