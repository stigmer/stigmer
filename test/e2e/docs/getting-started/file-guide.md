# E2E Test File Guide

Quick reference for what each test file does.

## Test Files (Actual Tests)

### Example-Specific Tests

**`basic_agent_apply_test.go`**
- Tests `stigmer apply` for basic agent (SDK example 01)
- Verifies deployment and storage
- Tests dry-run mode

**`basic_agent_run_test.go`**
- Tests `stigmer run` for basic agent (SDK example 01)
- Verifies execution creation
- Tests error handling

### Generic Tests

**`e2e_run_test.go`**
- Generic run tests (not example-specific)
- Currently: TestRunWithInvalidAgent

**`e2e_run_full_test.go`**
- Phase 2: Full execution tests with real LLM
- Waits for actual agent execution
- Validates execution results

## Infrastructure Files (Test Support)

### Test Setup

**`suite_test.go`**
- Test suite definition (E2ESuite)
- SetupSuite: Copies SDK examples, checks prerequisites
- SetupTest: Creates isolated test environment
- TearDownTest: Cleanup

### Server Management

**`harness_test.go`**
- Manages isolated stigmer-server for each test
- Each test gets fresh server + temp directory
- Automatic start/stop

**`stigmer_server_manager_test.go`**
- Manages production stigmer server (Phase 2)
- Detects if server is already running
- Only stops if tests started it

### Prerequisites

**`prereqs_test.go`**
- Checks Temporal (port 7233)
- Checks Ollama (port 11434)
- Provides helpful setup instructions

### Helpers

**`helpers_test.go`**
- GetFreePort: Find available port
- WaitForPort: Wait for server startup
- AgentExistsViaAPI: Query agent via gRPC
- ListKeysFromDB: Database inspection

**`cli_runner_test.go`**
- RunCLIWithServerAddr: Execute CLI commands in tests
- Handles server address override

**`sdk_fixtures_test.go`**
- CopyAllSDKExamples: Copy SDK code to testdata
- Ensures tests use actual SDK examples

**`validation_test.go`**
- ExecutionValidator: Validate agent execution output
- Deterministic checks (no LLM needed)
- Gibberish detection, error detection, etc.

## File Count

**12 test files total:**
- 2 example-specific test files (basic agent)
- 2 generic test files
- 8 infrastructure/support files

**All following Go best practices:**
- Tests in main package directory (not subdirs)
- Clear naming showing purpose
- Fixtures in testdata/ directory
