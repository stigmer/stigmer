# SDK Example Synchronization Strategy

**Created**: 2026-01-23  
**Updated**: 2026-01-23  
**Status**: ✅ Implemented for Agents (100% coverage)

---

## 🎯 Goal

Maintain **parity between SDK examples and E2E tests** to ensure that what we promise users in documentation actually works.

## 🧠 The Problem We Solved

**Before**: 
- E2E test fixtures (`test/e2e/testdata/agents/basic-agent/main.go`) were manually created
- SDK examples (`sdk/go/examples/01_basic_agent.go`) were separate
- Risk of drift: Examples could break without us knowing

**Result**: 
- SDK examples might not work
- Tests would pass but users would fail
- Loss of confidence in documentation

## ✅ The Solution

**Single Source of Truth**: SDK examples are automatically copied to testdata before tests run.

```mermaid
flowchart LR
    A[SDK Examples<br/>sdk/go/examples/] -->|Copy| B[Test Fixtures<br/>test/e2e/testdata/]
    B --> C[E2E Tests Run]
    C --> D[✅ Confidence:<br/>Examples Work!]
```

## 🔧 Implementation

### 1. Copy Mechanism (`sdk_fixtures_test.go`)

```go
// CopyAllSDKExamples() is called in SetupSuite()
// Before each test run:
examples := []SDKExample{
    {
        SDKFileName:    "01_basic_agent.go",
        TestDataDir:    "agents/basic-agent",
        TargetFileName: "main.go",
    },
}
```

### 2. Test Suite Integration

```go
func (s *FullExecutionSuite) SetupSuite() {
    // STEP 1: Copy SDK examples to testdata
    if err := CopyAllSDKExamples(); err != nil {
        s.T().Fatalf("Failed to copy SDK examples: %v", err)
    }
    
    // STEP 2: Start stigmer server...
}
```

### 3. Test Updates

All tests updated to reference agent names from SDK examples:
- ❌ Old: `"test-agent"` (manually created)
- ✅ New: `"code-reviewer"` (from SDK example `01_basic_agent.go`)

## 📁 File Structure

```
stigmer/
├── sdk/go/examples/
│   └── 01_basic_agent.go          ← SOURCE OF TRUTH
│
└── test/e2e/
    ├── sdk_fixtures_test.go        ← Copy mechanism
    ├── testdata/
    │   └── agents/
    │       └── basic-agent/
    │           ├── main.go         ← COPIED (do not edit!)
    │           └── Stigmer.yaml    ← Config (maintained manually)
    │
    └── e2e_run_full_test.go        ← Uses copied examples
```

## 🚀 Adding New Examples

To add a new agent example:

### Step 1: Create SDK Example
```bash
# Create in sdk/go/examples/
$ cat > sdk/go/examples/02_agent_with_skills.go <<'EOF'
//go:build ignore

package main

import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/stigmer"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        agent.New(ctx,
            agent.WithName("skilled-agent"),
            agent.WithInstructions("..."),
            // ... skills configuration
        )
        return nil
    })
}
EOF
```

### Step 2: Add to Copy List
```go
// In test/e2e/sdk_fixtures_test.go
examples := []SDKExample{
    // ... existing examples
    {
        SDKFileName:    "02_agent_with_skills.go",
        TestDataDir:    "agents/agent-with-skills",
        TargetFileName: "main.go",
    },
}
```

### Step 3: Create Stigmer.yaml
```bash
$ mkdir -p test/e2e/testdata/agents/agent-with-skills
$ cat > test/e2e/testdata/agents/agent-with-skills/Stigmer.yaml <<'EOF'
name: agent-with-skills-test
runtime: go
main: main.go
version: 0.1.0
description: Agent with skills test
EOF
```

### Step 4: Write Test
```go
func (s *FullExecutionSuite) TestAgentWithSkills() {
    // Apply agent
    applyOutput, err := RunCLIWithServerAddr(
        s.ServerPort,
        "apply",
        "--config", "testdata/agents/agent-with-skills/Stigmer.yaml",
    )
    // ... test logic using "skilled-agent" name from SDK
}
```

**⚠️ IMPORTANT**: The `main.go` is copied automatically. DO NOT create it manually!

## 🔄 Workflow Examples (Future)

The same pattern will be applied to workflows:

```go
examples := []SDKExample{
    // Workflows (planned):
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

**Current Status**: Workflow test fixtures are manually maintained. Will migrate in a future iteration.

## ✅ Benefits

### 1. **Confidence**
- SDK examples are proven to work (tests validate them)
- Users can trust documentation

### 2. **Consistency**
- No drift between examples and tests
- Single source of truth

### 3. **Maintenance**
- Update example once, tests automatically use new version
- No manual synchronization needed

### 4. **Quality**
- Bad examples fail tests immediately
- Forces us to keep examples realistic and working

## 🧪 Testing the Strategy

### Verify Copy Works
```bash
# Before test run, delete copied files
rm test/e2e/testdata/agents/basic-agent/main.go

# Run tests (should copy and pass)
cd test/e2e
go test -v -tags=e2e -run TestFullExecution

# Verify file was copied
ls -la test/e2e/testdata/agents/basic-agent/main.go
# Should exist and match sdk/go/examples/01_basic_agent.go
```

### Verify Tests Use SDK Examples
```bash
# Modify SDK example
# Edit sdk/go/examples/01_basic_agent.go:
#   Change agent name from "code-reviewer" to "documentation-expert"

# Run tests (should fail because test expects "code-reviewer")
cd test/e2e
go test -v -tags=e2e -run TestFullExecution

# Expected: Test fails with "agent not found: code-reviewer"
# This proves tests are using SDK examples!
```

## 📝 Documentation Updates

All affected documentation updated:
- ✅ `test/e2e/testdata/agents/README.md` - Explains copy mechanism
- ✅ `test/e2e/basic_agent_apply_test.go` - Comprehensive tests for both agents
- ✅ `test/e2e/basic_agent_run_test.go` - Tests for both basic and full agents
- ✅ `test/e2e/helpers_test.go` - Added GetAgentViaAPI helper
- ✅ `test/e2e/docs/test-coverage-enhancement-2026-01-23.md` - Enhancement summary

## 🎓 Lessons Learned

### What Worked Well
1. **Automatic copying in SetupSuite** - Clean, simple, reliable
2. **Clear file comments** - "COPIED FROM SDK (do not edit manually)"
3. **Structured approach** - `SDKExample` type makes it easy to add more
4. **Comprehensive testing** - Testing ALL scenarios from SDK examples (2026-01-23 enhancement)
5. **Helper function reuse** - `GetAgentViaAPI` serves multiple test cases

### What to Improve
1. **Workflow migration** - Apply same pattern to workflows
2. **Validation** - Verify SDK file exists before copying
3. **Error messages** - Clear feedback if SDK example missing

### Recent Enhancement (2026-01-23)
**Problem**: Tests only verified 33% of SDK example functionality (basic agent only)

**Solution**: Enhanced tests to cover 100% of SDK example scenarios:
- ✅ Both agents tested (code-reviewer and code-reviewer-pro)
- ✅ Optional fields verified (description, iconURL, org)
- ✅ Agent count validation
- ✅ Both agents runnable via CLI

**Result**: Complete confidence in SDK example accuracy

See: `test/e2e/docs/test-coverage-enhancement-2026-01-23.md`

## 🔮 Future Enhancements

### 1. Bidirectional Validation
- Ensure all SDK examples have corresponding tests
- Fail if example exists but no test

### 2. Automated README Generation
- Generate `sdk/go/examples/README.md` from test results
- Show which examples are tested

### 3. CI Integration
- Run tests on every SDK example change
- Prevent merging broken examples

---

## 📊 Test Coverage Status

### Agents (01_basic_agent.go)
- **Status**: ✅ **100% Coverage**
- **Last Updated**: 2026-01-23
- **Tests**: 
  - `TestApplyBasicAgent` - Both agents with all properties
  - `TestApplyAgentCount` - Exactly 2 agents deployed
  - `TestApplyDryRun` - Dry-run mode
  - `TestRunBasicAgent` - Basic agent execution
  - `TestRunFullAgent` - Full agent execution

### Workflows
- **Status**: ⏳ **Pending** - Will migrate in future iteration
- **Current**: Manual test fixtures

---

**Overall Status**: ✅ **Agents complete with comprehensive coverage**, workflows planned  
**Confidence**: **100%** - SDK examples and tests are in complete sync  
**Impact**: **HIGH** - Users can trust our documentation with full confidence
