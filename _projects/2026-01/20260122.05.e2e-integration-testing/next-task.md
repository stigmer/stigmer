# Next Task: Iteration 2 - Database Verification & CLI Integration

**Project**: E2E Integration Testing Framework  
**Location**: `_projects/2026-01/20260122.05.e2e-integration-testing/`  
**Current Status**: ✅ Iteration 1 Complete - Ready for Iteration 2  
**Updated**: 2026-01-22

---

## ✅ Completed: Iteration 1 (Minimal POC)

**What We Built:**
- `test/e2e/` directory structure
- Helper utilities (`GetFreePort`, `WaitForPort`)
- Test harness (server lifecycle management)
- Testify suite framework
- Smoke test that validates server startup

**Test Results:**
```bash
$ cd test/e2e && go test -v
✅ PASS: TestE2E/TestServerStarts (1.24s)
ok      github.com/stigmer/stigmer/test/e2e     2.030s
```

**Documentation:**
- [Checkpoint Document](checkpoints/01-iteration-1-complete.md)
- [Test README](../../test/e2e/README.md)

See `checkpoints/01-iteration-1-complete.md` for detailed analysis.

---

## ✅ Completed: Research Phase

Gemini research is complete! We have a comprehensive recommendation:

- **Framework**: `testify/suite` + `testcontainers-go`
- **Architecture**: "Ephemeral Harness" pattern
- **Database Isolation**: Directory-based with temp directories
- **CLI Testing**: Grey-box in-process execution

See `research-summary.md` for full analysis.

---

## 🎯 Next: Implementation Phase

### What We're Building

A POC (Proof of Concept) test that demonstrates the full pattern:

```go
func (s *E2ESuite) TestApplyBasicAgent() {
    // 1. Fresh temp dir created by SetupTest
    // 2. stigmer-server running on random port
    // 3. Run: stigmer apply --config testdata/basic_agent.go
    // 4. Verify: Agent exists in BadgerDB
    // 5. Cleanup: Automatic via TearDownTest
}
```

### Implementation Phases

#### Phase 1: Infrastructure Setup (START HERE)

**Create directory structure:**
```
test/e2e/
├── README.md                  # Test documentation
├── suite_test.go             # Testify suite definition
├── harness_test.go           # Process management
├── cli_runner_test.go        # In-process CLI executor
├── helpers_test.go           # Utilities (ports, health, DB)
└── testdata/
    └── basic_agent.go        # Test fixture
```

**Key files to implement:**

1. **`helpers_test.go`**
   - `GetFreePort()` - Find available port
   - `WaitForPort()` - Health check with timeout
   - `GetFromDB()` - BadgerDB inspector

2. **`harness_test.go`**
   - `TestHarness` struct
   - `StartHarness()` - Spawn stigmer-server
   - `Stop()` - Clean shutdown

3. **`suite_test.go`**
   - `E2ESuite` struct with testify
   - `SetupTest()` - Create temp dir, start services
   - `TearDownTest()` - Stop services, cleanup
   - `TestE2E()` - Entry point

4. **`cli_runner_test.go`**
   - `RunCLI()` - Execute CLI commands in-process

#### Phase 2: First Test (POC)

**Create `e2e_apply_test.go`:**

```go
func (s *E2ESuite) TestApplyBasicAgent() {
    // Apply basic agent
    serverAddr := fmt.Sprintf("localhost:%d", s.Harness.ServerPort)
    output, err := RunCLI("apply", 
        "--config", "testdata/basic_agent.go",
        "--server", serverAddr)
    
    s.Require().NoError(err)
    s.Contains(output, "Deployment successful")
    
    // Verify in database
    value, err := GetFromDB(s.TempDir, "agent:test-agent")
    s.NoError(err)
    s.NotNil(value)
}
```

#### Phase 3: Validate & Document

1. Test runs successfully
2. Add README with usage guide
3. Document patterns for adding more tests
4. Create coding guidelines

---

## 📋 Detailed Implementation Plan

### Step 1: Create Test Directory

```bash
mkdir -p test/e2e/testdata
```

### Step 2: Implement Utilities (`helpers_test.go`)

Based on Gemini's recommendations:

```go
package e2e

import (
    "fmt"
    "net"
    "time"
    "path/filepath"
    "github.com/dgraph-io/badger/v3"
)

// GetFreePort finds an available port
func GetFreePort() int {
    addr, _ := net.ResolveTCPAddr("tcp", "localhost:0")
    l, _ := net.ListenTCP("tcp", addr)
    defer l.Close()
    return l.Addr().(*net.TCPAddr).Port
}

// WaitForPort checks if a port is accepting connections
func WaitForPort(port int, timeout time.Duration) bool {
    deadline := time.Now().Add(timeout)
    for time.Now().Before(deadline) {
        conn, err := net.DialTimeout("tcp", 
            fmt.Sprintf("localhost:%d", port), 
            100*time.Millisecond)
        if err == nil {
            conn.Close()
            return true
        }
        time.Sleep(100 * time.Millisecond)
    }
    return false
}

// GetFromDB reads a value from BadgerDB
func GetFromDB(tempDir string, key string) ([]byte, error) {
    opts := badger.DefaultOptions(filepath.Join(tempDir, "data"))
    opts.Logger = nil
    db, err := badger.Open(opts)
    if err != nil {
        return nil, err
    }
    defer db.Close()
    
    var value []byte
    err = db.View(func(txn *badger.Txn) error {
        item, err := txn.Get([]byte(key))
        if err != nil {
            return err
        }
        value, err = item.ValueCopy(nil)
        return err
    })
    return value, err
}
```

### Step 3: Implement Harness (`harness_test.go`)

```go
package e2e

import (
    "fmt"
    "os"
    "os/exec"
    "testing"
    "time"
    "github.com/stretchr/testify/require"
)

type TestHarness struct {
    ServerCmd   *exec.Cmd
    ServerPort  int
    TempDir     string
}

func StartHarness(t *testing.T, tempDir string) *TestHarness {
    // Get free port
    port := GetFreePort()
    
    // Start stigmer-server
    serverCmd := exec.Command("go", "run", 
        "../../backend/services/stigmer-server/main.go")
    serverCmd.Env = append(os.Environ(),
        fmt.Sprintf("STIGMER_HOME=%s", tempDir),
        fmt.Sprintf("STIGMER_PORT=%d", port),
    )
    
    err := serverCmd.Start()
    require.NoError(t, err, "Failed to start stigmer-server")
    
    // Wait for healthy
    healthy := WaitForPort(port, 5*time.Second)
    require.True(t, healthy, "Server failed to become healthy")
    
    return &TestHarness{
        ServerCmd:  serverCmd,
        ServerPort: port,
        TempDir:    tempDir,
    }
}

func (h *TestHarness) Stop() {
    if h.ServerCmd != nil && h.ServerCmd.Process != nil {
        h.ServerCmd.Process.Kill()
        h.ServerCmd.Wait() // Reap zombie
    }
}
```

### Step 4: Implement Suite (`suite_test.go`)

```go
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

// SetupTest runs before each test
func (s *E2ESuite) SetupTest() {
    // Create fresh temp directory
    var err error
    s.TempDir, err = os.MkdirTemp("", "stigmer-e2e-*")
    s.Require().NoError(err)
    
    // Start services
    s.Harness = StartHarness(s.T(), s.TempDir)
}

// TearDownTest runs after each test
func (s *E2ESuite) TearDownTest() {
    if s.Harness != nil {
        s.Harness.Stop()
    }
    if s.TempDir != "" {
        os.RemoveAll(s.TempDir)
    }
}

// TestE2E is the entry point
func TestE2E(t *testing.T) {
    suite.Run(t, new(E2ESuite))
}
```

### Step 5: Implement CLI Runner (`cli_runner_test.go`)

```go
package e2e

import (
    "bytes"
    // Import your CLI root command
    // "github.com/stigmer/stigmer/client-apps/cli/cmd"
)

func RunCLI(args ...string) (string, error) {
    var stdout, stderr bytes.Buffer
    
    // Get root command
    rootCmd := cmd.GetRootCommand() // You'll need to expose this
    rootCmd.SetOut(&stdout)
    rootCmd.SetErr(&stderr)
    rootCmd.SetArgs(args)
    
    err := rootCmd.Execute()
    
    output := stdout.String()
    if err != nil {
        output += "\nSTDERR:\n" + stderr.String()
    }
    
    return output, err
}
```

### Step 6: Create Test Fixture (`testdata/basic_agent.go`)

```go
package main

import (
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    agent := stigmer.DefineAgent("test-agent", func(config *stigmer.AgentConfig) {
        config.Instructions = "You are a test agent"
        config.Model = "openai:gpt-4"
    })
    
    stigmer.Apply(agent)
}
```

### Step 7: Write First Test (`e2e_apply_test.go`)

```go
package e2e

import "fmt"

func (s *E2ESuite) TestApplyBasicAgent() {
    // Execute apply
    serverAddr := fmt.Sprintf("localhost:%d", s.Harness.ServerPort)
    output, err := RunCLI("apply", 
        "--config", "testdata/basic_agent.go",
        "--server", serverAddr)
    
    // Verify success
    s.Require().NoError(err)
    s.Contains(output, "Deployment successful")
    
    // Verify database state
    value, err := GetFromDB(s.TempDir, "agent:test-agent")
    s.NoError(err, "Agent should exist in database")
    s.NotNil(value)
}
```

---

## 🎯 Success Criteria

Before marking this complete:

- [ ] Test directory structure created
- [ ] All helper utilities implemented
- [ ] Harness can start/stop stigmer-server
- [ ] CLI runner works in-process
- [ ] First test (`TestApplyBasicAgent`) passes
- [ ] Test completes in < 10 seconds
- [ ] README documents how to run tests
- [ ] Code follows Stigmer coding standards

---

## 🚨 Known Challenges

### Challenge 1: CLI Root Command Access

**Problem**: Need to call CLI in-process  
**Solution**: Expose `GetRootCommand()` in CLI package

```go
// In client-apps/cli/cmd/root.go
func GetRootCommand() *cobra.Command {
    return rootCmd
}
```

### Challenge 2: Server Path

**Problem**: Finding stigmer-server binary  
**Options**:
1. Use `go run` (slower but simple)
2. Build binary first with `go build`
3. Use relative path to source

**Recommendation**: Start with `go run`, optimize later

### Challenge 3: Python Runner

**Problem**: agent-runner needs to be started  
**Decision**: Start with just stigmer-server POC, add runners in Phase 2

---

## 📚 Documentation Needs

After POC works, create:

1. **`test/e2e/README.md`**
   - How to run tests
   - How to add new tests
   - Troubleshooting guide

2. **Coding Guidelines**
   - Test naming conventions
   - Test structure patterns
   - Common assertions

3. **CI/CD Integration**
   - GitHub Actions workflow
   - Required dependencies

---

## 🔄 Iterative Approach

### Iteration 1: Minimal POC
- Just harness + suite
- Start server successfully
- One simple test that verifies server started

### Iteration 2: Database Verification
- Add DB helper
- Test that applies agent
- Verify in database

### Iteration 3: Full CLI Integration
- In-process CLI execution
- Full apply test with output verification
- Multiple test cases

---

## Questions Before Starting

1. **Should we start implementation now?**
   - Or do you want to review research first?

2. **Any modifications to Gemini's recommendations?**
   - Different framework?
   - Different architecture?

3. **Which test scenario to implement first?**
   - Apply? Run? Both?

4. **Time budget for this POC?**
   - Quick prototype (2-3 hours)?
   - Production-ready (full day)?

---

## Quick Start Command

When you're ready to begin:

```bash
# Create directory
mkdir -p test/e2e/testdata

# Start with helpers
cursor test/e2e/helpers_test.go
```

Or just say: **"Start Phase 1"** and I'll begin implementing!

---

**Status**: 🟢 Ready to implement  
**Next Action**: Create test infrastructure (Phase 1)  
**Estimated Time**: 2-4 hours for full POC  
**Confidence**: HIGH - Clear path forward
