# SDK Example Synchronization for E2E Tests

**Date**: 2026-01-23  
**Type**: Test Infrastructure Enhancement  
**Impact**: HIGH - Ensures SDK examples are validated by tests  
**Files Changed**: 8 files (4 new, 4 updated)

---

## 🎯 What Was Done

Implemented automatic synchronization between SDK examples and E2E test fixtures to ensure that SDK examples (what we promise users) are actually tested and working.

### The Problem

**Before this change:**
- E2E test fixtures (`test/e2e/testdata/agents/basic-agent/main.go`) were manually created
- SDK examples (`sdk/go/examples/01_basic_agent.go`) were separate files
- Risk of drift: SDK examples could break without tests catching it
- No guarantee that documented examples actually work

**Result**: Loss of confidence in SDK documentation.

### The Solution

**Single Source of Truth Pattern:**
- SDK examples are automatically copied to testdata before each test run
- Tests validate the exact code users see in SDK examples
- Updates to SDK examples automatically tested
- No manual synchronization needed

```
SDK examples (source) → Copy → Test fixtures → Tests run → ✅ Confidence
```

---

## 🔧 Implementation Details

### 1. Copy Mechanism (`sdk_fixtures_test.go`)

Created `test/e2e/sdk_fixtures_test.go` (162 lines) with:

```go
type SDKExample struct {
    SDKFileName    string  // "01_basic_agent.go"
    TestDataDir    string  // "agents/basic-agent"  
    TargetFileName string  // "main.go"
}

func CopyAllSDKExamples() error {
    examples := []SDKExample{
        {
            SDKFileName:    "01_basic_agent.go",
            TestDataDir:    "agents/basic-agent",
            TargetFileName: "main.go",
        },
    }
    
    for _, example := range examples {
        if err := CopySDKExample(example); err != nil {
            return err
        }
    }
    return nil
}
```

**Key functions:**
- `CopySDKExample()` - Copies individual SDK example to testdata
- `CopyAllSDKExamples()` - Copies all configured examples
- `GetSDKExamplesDirectory()` - Locates SDK examples directory
- `GetTestDataDirectory()` - Locates test fixtures directory

### 2. Test Suite Integration

Updated `e2e_run_full_test.go` to call copy function in `SetupSuite()`:

```go
func (s *FullExecutionSuite) SetupSuite() {
    // STEP 1: Copy SDK examples to testdata
    s.T().Log("Step 1: Copying SDK examples to testdata...")
    if err := CopyAllSDKExamples(); err != nil {
        s.T().Fatalf("Failed to copy SDK examples: %v", err)
    }
    s.T().Log("✓ SDK examples copied successfully")
    
    // STEP 2: Start stigmer server...
}
```

**Behavior:**
- Copies happen automatically before each test run
- Failures are fatal (tests can't run with stale fixtures)
- Clear logging for debugging

### 3. Test Updates

Updated all agent tests to reference agent names from SDK examples:

**Before:**
```go
runOutput, err := RunCLIWithServerAddr(
    s.ServerPort,
    "run", "test-agent", // Manually created test fixture
    "--message", "Say hello",
)
```

**After:**
```go
runOutput, err := RunCLIWithServerAddr(
    s.ServerPort,
    "run", "code-reviewer", // From SDK example 01_basic_agent.go
    "--message", "Say hello",
)
```

**Files updated:**
- `e2e_run_full_test.go` - 2 agent name changes, setup integration
- `e2e_apply_test.go` - Agent name + extraction logic
- `e2e_run_test.go` - Agent name + comments

### 4. File Cleanup

**Deleted:**
- `test/e2e/testdata/agents/basic-agent/main.go` (manually created, 726 bytes)

**Reason**: Now copied automatically from SDK example. Manual file was duplicating SDK content and could drift.

**Preserved:**
- `test/e2e/testdata/agents/basic-agent/Stigmer.yaml` - Config file, maintained manually

---

## 📖 Documentation

### New Documentation

**1. `SDK_SYNC_STRATEGY.md`** (374 lines)

Comprehensive guide covering:
- Why this pattern exists (single source of truth)
- How it works (copy mechanism in SetupSuite)
- File structure and ownership
- How to add new examples
- Testing the strategy
- Future workflow migration plans
- Lessons learned

**2. Updated `testdata/agents/README.md`**

Added sections:
- **SDK Example Synchronization** - Explains automatic copying
- **⚠️ DO NOT manually edit main.go** - Clear warnings
- **Adding New Test Cases** - Step-by-step guide with examples
- Updated expected behavior to reference SDK example agent names

---

## 🎯 Why This Matters

### 1. **Confidence in Documentation**

Users can trust SDK examples because tests prove they work:
- Example fails to compile → Test fails
- Example has wrong agent name → Test fails
- Example uses deprecated API → Test fails

### 2. **No Drift**

Single source of truth eliminates divergence:
- ❌ Before: SDK example ≠ Test fixture (manual sync needed)
- ✅ After: Test uses SDK example directly (auto sync)

### 3. **Easier Maintenance**

Update SDK example once, tests automatically use new version:
- Change agent name → Tests use new name automatically
- Add new field → Tests validate new field automatically
- Fix bug in example → Tests verify fix automatically

### 4. **Quality Gate**

Forces SDK examples to be realistic and working:
- Can't publish broken examples (tests would fail)
- Examples must use valid configurations
- Examples must follow actual product behavior

---

## 🧪 Testing

### Verification Steps

1. **Delete copied file**:
   ```bash
   rm test/e2e/testdata/agents/basic-agent/main.go
   ```

2. **Run tests** (should copy and pass):
   ```bash
   cd test/e2e
   go test -v -tags=e2e -run TestFullExecution
   ```

3. **Verify file copied**:
   ```bash
   diff testdata/agents/basic-agent/main.go \
        ../../sdk/go/examples/01_basic_agent.go
   # Should be identical!
   ```

### Proof Tests Use SDK Examples

1. **Modify SDK example**:
   ```go
   // In sdk/go/examples/01_basic_agent.go
   // Change: agent.WithName("code-reviewer")
   // To:     agent.WithName("documentation-expert")
   ```

2. **Run tests** (should fail):
   ```bash
   cd test/e2e
   go test -v -tags=e2e -run TestFullExecution
   # Expected error: "agent not found: code-reviewer"
   ```

This proves tests use SDK examples, not stale fixtures!

---

## 🔄 Future Work

### Workflow Migration (Planned)

Apply same pattern to workflow test fixtures:

```go
examples := []SDKExample{
    {
        SDKFileName:    "07_basic_workflow.go",
        TestDataDir:    "workflows/basic-workflow",
        TargetFileName: "main.go",
    },
    {
        SDKFileName:    "08_workflow_with_conditionals.go",
        TestDataDir:    "workflows/conditional-switch",
        TargetFileName: "main.go",
    },
    // ... more workflows
}
```

**Current status**: Workflow test fixtures are manually maintained. Will migrate when E2E workflow testing is mature.

### Additional Agent Examples

Extend to more agent configurations:
- `02_agent_with_skills.go` → `agents/agent-with-skills/`
- `03_agent_with_mcp_servers.go` → `agents/agent-with-mcp/`
- `04_agent_with_subagents.go` → `agents/agent-with-subagents/`

---

## 📊 Impact Assessment

### Code Quality: HIGH
- ✅ Eliminates manual synchronization burden
- ✅ Enforces consistency between docs and tests
- ✅ Tests validate real examples users see

### Developer Experience: HIGH
- ✅ Automatic copying (no manual steps)
- ✅ Clear "do not edit" warnings
- ✅ Easy to add new examples (just configure mapping)

### User Trust: HIGH
- ✅ SDK examples guaranteed to work
- ✅ Documentation matches reality
- ✅ Users experience success when following examples

### Test Reliability: HIGH
- ✅ Tests always use latest SDK examples
- ✅ No stale fixtures
- ✅ Failures indicate real problems with SDK examples

---

## 🎓 Lessons Learned

### What Worked Well

**1. Automatic Copying in SetupSuite**
- Clean, simple, reliable
- No manual steps for developers
- Fails fast if SDK example missing

**2. Structured Approach**
- `SDKExample` type makes mappings explicit
- Easy to understand and maintain
- Clear ownership (SDK vs testdata)

**3. Clear Documentation**
- "COPIED FROM SDK (do not edit)" warnings prevent confusion
- README explains mechanism thoroughly
- Strategy document for future reference

### Key Insights

**1. SDK Examples Should Be Realistic**
- Use real agent names (not "test-agent")
- Show multiple configurations
- Examples should be educational AND testable

**2. Tests Should Adapt to Examples**
- Tests reference agent names from SDK
- Tests validate example behavior
- Not the other way around (examples adapting to tests)

**3. Documentation Is Critical**
- Warnings prevent manual editing of copied files
- README explains "why" not just "how"
- Future developers can understand the system

---

## 🔗 Related Work

### Previous E2E Test Iterations

This builds on prior E2E testing work:
- **Phase 1**: Basic apply/run tests with manually created fixtures
- **Phase 2**: Full execution tests with Temporal integration
- **Deterministic validation**: 3-tier validation framework
- **Workflow testing**: 5 workflow types with comprehensive fixtures

### Future Integration

This pattern will be referenced when:
- Adding more agent example tests
- Migrating workflow test fixtures to SDK examples
- Creating SDK examples for other languages (Python, etc.)

---

## ✅ Success Criteria

- [x] SDK examples automatically copied before each test run
- [x] All agent tests use SDK example agent names ("code-reviewer")
- [x] Manually created test fixtures deleted
- [x] Comprehensive documentation (strategy + README updates)
- [x] Clear warnings about not editing copied files
- [x] Tests pass with copied SDK examples
- [x] Easy to add more examples (just update mapping list)

---

**Status**: ✅ Complete  
**Next**: Optionally extend to more agent examples, or apply pattern to workflow tests

---

## 📁 Files Changed

### New Files (4)
1. `test/e2e/sdk_fixtures_test.go` (162 lines) - Copy mechanism
2. `test/e2e/SDK_SYNC_STRATEGY.md` (374 lines) - Strategy documentation
3. `_projects/2026-01/20260122.05.e2e-integration-testing/checkpoints/2026-01-23-sdk-example-synchronization.md` - Checkpoint
4. This changelog

### Updated Files (4)
1. `test/e2e/e2e_run_full_test.go` - Setup integration, agent names
2. `test/e2e/e2e_apply_test.go` - Agent name + extraction
3. `test/e2e/e2e_run_test.go` - Agent name + comments
4. `test/e2e/testdata/agents/README.md` - Sync explanation, warnings

### Deleted Files (1)
1. `test/e2e/testdata/agents/basic-agent/main.go` - Manually created (now copied from SDK)

---

**Total**: 8 files changed (4 new, 4 updated, 1 deleted), ~700 lines added
