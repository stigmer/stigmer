# E2E Test Suite Quick Reference

Quick reference for using `@refactor-or-create-e2e-test-suite` rule.

---

## Quick Start Commands

### Create New Test Suite
```
@refactor-or-create-e2e-test-suite Create test suite for SDK example 08_workflow_with_conditionals.go
```

### Refactor Existing Tests
```
@refactor-or-create-e2e-test-suite Refactor test/e2e/basic_agent_run_test.go to follow standards
```

### Batch Refactoring
```
@refactor-or-create-e2e-test-suite Refactor all agent tests to follow standards
```

---

## File Naming Patterns

### Constants
```
workflow_test_constants.go
agent_test_constants.go
skill_test_constants.go
```

### Helpers
```
workflow_test_helpers.go
agent_test_helpers.go
skill_test_helpers.go
```

### Tests
```
<category>_<aspect>_test.go

Examples:
basic_workflow_apply_core_test.go
basic_workflow_apply_count_test.go
basic_workflow_apply_dryrun_test.go
basic_agent_run_basic_test.go
basic_agent_run_invalid_test.go
```

---

## Constants Template

```go
//go:build e2e
// +build e2e

package e2e

// <Category> test constants - matches SDK example <NN>_<name>.go
const (
	// Resource names from SDK example (source of truth)
	<Name>Name      = "value-from-sdk"
	<Name>Namespace = "value-from-sdk"
	<Name>Version   = "value-from-sdk"
	
	// Test fixture paths
	<Name>TestDataDir = "testdata/examples/<NN>-<name>"
	
	// Expected counts
	<Name>TaskCount = N
	<Name>EnvVarCount = N
	
	// Backend configuration
	LocalOrg = "local"
)
```

---

## Helper Function Templates

### Apply Helper
```go
func Apply<Name>(t *testing.T, serverPort int) *<Category>ApplyResult {
	absTestdataDir, err := filepath.Abs(<Name>TestDataDir)
	require.NoError(t, err, "Failed to get absolute path")

	output, err := RunCLIWithServerAddr(serverPort, "apply", "--config", absTestdataDir)
	require.NoError(t, err, "Apply should succeed")

	resource, err := Get<Resource>BySlug(serverPort, <Name>Name, LocalOrg)
	require.NoError(t, err, "Should query resource by slug")

	return &<Category>ApplyResult{
		Resource: resource,
		Output:   output,
	}
}
```

### Verification Helper
```go
func Verify<Name>Properties(t *testing.T, resource *protov1.Resource) {
	require.Equal(t, <Name>Name, resource.Metadata.Name, 
		"Name should match SDK example")
	require.NotEmpty(t, resource.Spec.Description, 
		"Should have description from SDK")
	
	t.Logf("✓ Properties verified")
}
```

---

## Test File Template

```go
//go:build e2e
// +build e2e

package e2e

// Test<Name><Aspect> tests <description>
//
// Example: sdk/go/examples/<NN>_<name>.go
// Test Fixture: test/e2e/testdata/examples/<NN>-<name>/
//
// This test validates <specific aspect>.
func (s *E2ESuite) Test<Name><Aspect>() {
	s.T().Logf("=== Testing <Aspect> ===")

	// Apply from SDK example
	result := Apply<Name>(s.T(), s.Harness.ServerPort)

	// Verify specific aspect
	Verify<Aspect>(s.T(), result.Resource)

	s.T().Logf("✅ Test passed: <description>")
}
```

---

## Checklist (Print This!)

```
Planning:
☐ Read SDK example
☐ Extract names, counts, features
☐ Plan test scenarios

Create:
☐ Constants file (<category>_test_constants.go)
☐ Helpers file (<category>_test_helpers.go)  
☐ Test files (one per test/aspect)

Verify:
☐ All files < 250 lines
☐ All functions < 50 lines
☐ No magic strings
☐ SDK example in copy list
☐ Tests pass
☐ Document refactoring
```

---

## Common Scenarios

### Scenario: New Workflow Test
```
Files to create:
- workflow_<name>_test_constants.go (if not exists)
- workflow_<name>_test_helpers.go (if not exists)
- workflow_<name>_apply_core_test.go
- workflow_<name>_apply_count_test.go
- workflow_<name>_apply_dryrun_test.go
```

### Scenario: New Agent Test
```
Files to create:
- agent_<name>_test_constants.go (if not exists)
- agent_<name>_test_helpers.go (if not exists)
- agent_<name>_apply_core_test.go
- agent_<name>_run_basic_test.go
- agent_<name>_run_invalid_test.go
```

### Scenario: Refactor Existing
```
Steps:
1. Create constants file first
2. Create helpers file second
3. Replace duplicated code with helpers
4. Split into focused test files
5. Delete old monolithic file
6. Verify all tests pass
```

---

## Quick Violations Check

Run these commands to check for violations:

```bash
# Check file sizes (should be < 250 lines)
wc -l test/e2e/*_test.go | grep -v "total" | awk '$1 > 250 {print $2, $1}'

# Count magic strings (look for repeated literal strings)
grep -r '"code-reviewer"' test/e2e/*.go | wc -l

# Check function sizes (look for long functions)
grep -A 100 "^func.*Test" test/e2e/*_test.go | grep -c "^func"
```

---

## Quick Fixes

### Fix: Too many magic strings
```bash
# Before refactoring - count occurrences
grep -r '"basic-data-fetch"' test/e2e/ | wc -l

# Create constant
const BasicWorkflowName = "basic-data-fetch"

# After refactoring - should be 0
grep -r '"basic-data-fetch"' test/e2e/*.go | wc -l
```

### Fix: Duplicated apply code
```bash
# Extract to helper
func ApplyBasicWorkflow(t *testing.T, serverPort int) *WorkflowApplyResult

# Replace all duplicated apply code with:
result := ApplyBasicWorkflow(s.T(), s.Harness.ServerPort)
```

### Fix: Test file too long
```bash
# Split by test aspect:
# - Core apply → _apply_core_test.go
# - Count → _apply_count_test.go  
# - Dry-run → _apply_dryrun_test.go
# - Context → _apply_context_test.go
```

---

## Examples to Reference

### Well-Structured Test Suite
```
test/e2e/
├── workflow_test_constants.go (31 lines) ✅
├── workflow_test_helpers.go (169 lines) ✅
├── basic_workflow_apply_core_test.go (46 lines) ✅
├── basic_workflow_apply_count_test.go (28 lines) ✅
├── basic_workflow_apply_dryrun_test.go (24 lines) ✅
├── basic_workflow_apply_context_test.go (36 lines) ✅
└── basic_workflow_apply_dependencies_test.go (44 lines) ✅
```

See:
- `test/e2e/docs/implementation/workflow-apply-tests-refactoring-2026-01-23.md`
- Full rule: `.cursor/rules/test/refactor-or-create-e2e-test-suite.mdc`

---

## When to Use

✅ **Use this rule when:**
- Creating tests for new SDK example
- File exceeds 250 lines
- Function exceeds 50 lines
- Seeing repeated code across tests
- Magic strings everywhere
- Tests hard to understand

❌ **Don't use for:**
- Simple one-off tests (< 50 lines total)
- Tests with no duplication
- Tests already following standards

---

## Pro Tips

💡 **Start with constants** - Establishes contract with SDK example

💡 **Extract helpers incrementally** - Don't refactor everything at once

💡 **Keep tests passing** - Refactor in small, verifiable steps

💡 **Use descriptive names** - `ApplyBasicWorkflow` not `DoApply`

💡 **One responsibility per file** - If explaining requires "and", split it

💡 **Log verification steps** - Makes debugging easier

💡 **Reference SDK example** - Comments should mention source file

---

**Remember**: The goal is maintainable tests that serve as documentation! 📚
