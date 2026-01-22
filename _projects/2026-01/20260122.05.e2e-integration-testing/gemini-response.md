Here is a comprehensive research and recommendation guide for building the Stigmer End-to-End (E2E) integration test suite.

---

## 1. Executive Recommendation

### **The Framework: `testify/suite` + `testcontainers-go**`

I recommend using **`testify/suite`** combined with **`testcontainers-go`**.

* **Why `testify/suite`?**
* **Lifecycle Hooks:** The critical requirement is database and process isolation. `testify` provides `SetupSuite`, `TearDownSuite`, `SetupTest`, and `TearDownTest` hooks, which are essential for resetting BadgerDB and restarting processes between tests.
* **Familiarity:** It is the industry standard for Go. Temporal’s own Go SDK uses a similar suite pattern.
* **Comparison:** `Ginkgo` (BDD) is powerful but introduces a steep DSL learning curve that often obfuscates simple failure modes in integration tests. The standard `testing` package lacks structure for complex setup/teardown needs.


* **Why `testcontainers-go`?**
* It allows you to spin up ephemeral dependencies (specifically Temporal and Python environments if needed) entirely from Go code, ensuring your tests own the infrastructure they run on.



### **The Architecture: "The Ephemeral Harness"**

Instead of relying on a pre-running `stigmer daemon`, the test suite should act as the daemon. It will spawn the `stigmer-server` and runners as child processes for the duration of the test suite.

---

## 2. Test Architecture Design

### Component Diagram

```mermaid
graph TD
    subgraph "Go Test Process (testify/suite)"
        TestControl[Test Controller]
        CLI[In-Process CLI Executor]
    end

    subgraph "Child Processes (Managed by Test)"
        Server[stigmer-server (Port: Random)]
        Runner[agent-runner (Python)]
        Worker[workflow-runner (Go)]
    end

    subgraph "Infrastructure (Docker/Files)"
        Temporal[Temporal Dev Server (Container)]
        DB[Temp Dir /data/badger]
    end

    TestControl -- Spawns/Kills --> Server
    TestControl -- Spawns/Kills --> Runner
    TestControl -- Spawns/Kills --> Worker
    TestControl -- Starts --> Temporal
    CLI -- gRPC (localhost:Random) --> Server
    Server -- Writes --> DB
    Server -- gRPC --> Temporal

```

### Key Strategy: "Grey Box" CLI Testing

For the most robust tests, do **not** use `os/exec` to call the `stigmer` binary for every command. Instead, compile the CLI commands into the test binary or invoke the `cmd.Execute()` entrypoint directly, redirecting `Stdout` and `Stderr` to buffers.

* **Pros:** 100x faster (no process startup overhead), easy to mock inputs, and you get code coverage reports for the CLI layer.
* **Cons:** Shared memory state (mitigated by not using global variables in CLI code).

---

## 3. Implementation Guide

### A. Folder Structure

Create a dedicated folder to separate these slow tests from unit tests.

```text
stigmer/
├── test/
│   └── e2e/
│       ├── main_test.go       # TestMain (Global setup)
│       ├── suite_test.go      # The Testify Suite definition
│       ├── harness_test.go    # Process manager & port allocation
│       ├── e2e_apply_test.go  # Actual tests
│       └── testdata/          # Golden files & example configs

```

### B. The "Harness" (Process Management)

This helper manages the lifecycle of your backend services during tests.

```go
// test/e2e/harness_test.go
package e2e

import (
    "os/exec"
    "path/filepath"
    "testing"
    "time"
    "github.com/stretchr/testify/require"
)

type TestHarness struct {
    ServerCmd   *exec.Cmd
    ServerPort  int
    TempDir     string
    // Add other processes (agent-runner, etc.)
}

// StartHarness brings up the stack
func StartHarness(t *testing.T, tempDir string) *TestHarness {
    // 1. Get a free port
    port := GetFreePort() // helper utility

    // 2. Prepare stigmer-server command
    // Assumes you built the binary or run via "go run"
    serverCmd := exec.Command("go", "run", "../backend/services/stigmer-server/main.go")
    serverCmd.Env = append(os.Environ(), 
        fmt.Sprintf("STIGMER_HOME=%s", tempDir),
        fmt.Sprintf("STIGMER_PORT=%d", port),
    )
    
    // 3. Start asynchronously
    err := serverCmd.Start()
    require.NoError(t, err)

    // 4. Wait for healthy (Health Check)
    require.True(t, WaitForPort(port, 5*time.Second), "Server failed to start")

    return &TestHarness{
        ServerCmd:  serverCmd,
        ServerPort: port,
        TempDir:    tempDir,
    }
}

func (h *TestHarness) Stop() {
    if h.ServerCmd != nil && h.ServerCmd.Process != nil {
        h.ServerCmd.Process.Kill()
    }
}

```

### C. The Test Suite (`testify`)

This brings it all together, ensuring database isolation.

```go
// test/e2e/suite_test.go
package e2e

import (
    "os"
    "testing"
    "github.com/stretchr/testify/suite"
)

type E2ESuite struct {
    suite.Suite
    Harness *TestHarness
    TempDir string
}

// SetupSuite runs ONCE before all tests (e.g., start Temporal Container)
func (s *E2ESuite) SetupSuite() {
    // Start Temporal via Testcontainers here if needed
}

// SetupTest runs before EACH test (Clean DB state)
func (s *E2ESuite) SetupTest() {
    // Create a fresh temp directory for BadgerDB
    var err error
    s.TempDir, err = os.MkdirTemp("", "stigmer-e2e-*")
    s.Require().NoError(err)

    // Start Stigmer Server pointing to this fresh dir
    s.Harness = StartHarness(s.T(), s.TempDir)
}

// TearDownTest cleans up processes
func (s *E2ESuite) TearDownTest() {
    s.Harness.Stop()
    os.RemoveAll(s.TempDir)
}

// Test Entrypoint
func TestE2E(t *testing.T) {
    suite.Run(t, new(E2ESuite))
}

```

### D. Writing the Tests

#### Scenario 1: `stigmer apply` (Persistence)

```go
// test/e2e/e2e_apply_test.go
func (s *E2ESuite) TestApplyBasicAgent() {
    // 1. Prepare CLI command
    // We point the CLI to the test server's port
    serverAddr := fmt.Sprintf("localhost:%d", s.Harness.ServerPort)
    
    // 2. Run "stigmer apply"
    // Helper that invokes your root command logic
    output, err := RunCLI("apply", "--config", "testdata/basic_agent.go", "--server", serverAddr)
    
    s.Require().NoError(err)
    s.Contains(output, "Deployment successful")

    // 3. Verify Persistence directly in BadgerDB
    // We can open the DB file directly since we own the TempDir
    dbOpts := badger.DefaultOptions(filepath.Join(s.TempDir, "data"))
    db, _ := badger.Open(dbOpts)
    defer db.Close()
    
    // Verify agent exists
    err = db.View(func(txn *badger.Txn) error {
        _, err := txn.Get([]byte("agent:test-agent"))
        return err
    })
    s.NoError(err, "Agent should exist in DB")
}

```

#### Scenario 2: `stigmer run` (Async Streaming)

```go
func (s *E2ESuite) TestRunAndStream() {
    // 1. Apply first
    serverAddr := fmt.Sprintf("localhost:%d", s.Harness.ServerPort)
    RunCLI("apply", "--config", "testdata/basic_agent.go", "--server", serverAddr)

    // 2. Run execution in background to capture stream
    outputChan := make(chan string)
    
    go func() {
        out, _ := RunCLI("run", "test-agent", "--message", "hello", "--server", serverAddr)
        outputChan <- out
    }()

    // 3. Wait for result with Timeout
    select {
    case output := <-outputChan:
        s.Contains(output, "🤖 Agent:")
        s.Contains(output, "✅ Execution completed")
    case <-time.After(10 * time.Second):
        s.Fail("Execution timed out")
    }
}

```

---

## 4. Addressing Technical Challenges

### Database Isolation Strategy

**Recommendation: Directory-based Isolation.**
BadgerDB is an embedded database. You do not need complex transaction rollbacks. Simply creating a new `os.MkdirTemp` for every `SetupTest` gives you a physically empty database for every single test case. It is fast and guarantees 100% isolation.

### Process Management & Python

Since `agent-runner` is Python, your Go `StartHarness` should exec it just like the Go binaries.
**Pro-tip:** In your CI pipeline, ensure `poetry install` runs before `go test`. In `StartHarness`, look for the virtualenv python executable.

```go
// Finding the python runner
cmd := exec.Command("poetry", "run", "python", "agent_runner.py")
cmd.Dir = "../backend/services/agent-runner"

```

### Async/Streaming Patterns

Use **Polling** instead of sleeping. Use `testify/assert.Eventually` for database checks, but for streaming CLI output, consuming the stream is safer.

```go
// Good Pattern for DB checks
s.Eventually(func() bool {
    // Check if execution is marked as COMPLETED in DB
    status := GetExecutionStatusFromDB(s.TempDir, executionID)
    return status == "COMPLETED"
}, 10*time.Second, 500*time.Millisecond)

```

---

## 5. CI/CD Integration

To run this in GitHub Actions, you need a workflow that sets up the prerequisites (Go, Python, Temporal).

```yaml
name: E2E Integration Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      # Use Temporal Dev Server service if not using Testcontainers
      temporal:
        image: temporalio/admin-tools:latest
        ports: ["7233:7233"]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Go
        uses: actions/setup-go@v4
        
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
          
      - name: Install Python Deps
        run: pip install poetry && cd backend/services/agent-runner && poetry install

      - name: Run E2E Tests
        # -p 1 ensures tests don't run in parallel (avoids port conflicts if logic is weak)
        run: go test -v ./test/e2e/... -p 1

```

---

## 6. Next Steps for You

I have designed this to be implemented incrementally.

1. **Create the directory structure:** `test/e2e/`.
2. **Implement `harness.go`:** Just try to start `stigmer-server` from a Go test and ping its health port.
3. **Implement `suite_test.go`:** Add the `SetupTest` to create a temp dir.

**Would you like me to generate the exact code for `harness.go` including the logic to find free ports and wait for service health?**