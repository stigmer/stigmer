# E2E Test Rules and Guidelines

This folder contains rules and guidelines specific to E2E testing in Stigmer.

---

## 📁 Files in This Folder

### 1. `refactor-or-create-e2e-test-suite.mdc`
**Comprehensive guide for creating or refactoring E2E test suites**

- **Purpose**: Detailed step-by-step instructions for maintaining test quality
- **Use when**: 
  - Creating tests for new SDK examples
  - Refactoring existing tests that violate standards
  - Need detailed guidance on test structure
  
- **Size**: ~1000 lines (comprehensive reference)
- **Includes**:
  - Core principles (SDK sync + engineering standards)
  - Step-by-step implementation patterns
  - Templates for all file types
  - Refactoring existing tests guide
  - Anti-patterns to avoid
  - Troubleshooting guide
  - Quality checklist

**How to use**:
```
@test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Create test suite for SDK example 08_workflow_with_conditionals.go
```

or

```
@test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor test/e2e/basic_agent_run_test.go to follow standards
```

---

### 2. `QUICK-REFERENCE.md`
**Quick lookup guide with templates and checklists**

- **Purpose**: Fast reference for common patterns
- **Use when**: 
  - Need quick template copy-paste
  - Want to check violations
  - Need file naming conventions
  
- **Size**: ~200 lines (quick lookup)
- **Includes**:
  - Quick start commands
  - File naming patterns
  - Copy-paste templates
  - Checklists
  - Violation checks
  - Pro tips

**How to use**:
```bash
# View in terminal
cat test/e2e/_rules/QUICK-REFERENCE.md

# Or open in editor
code test/e2e/_rules/QUICK-REFERENCE.md
```

---

## 🎯 Which File to Use?

### Use `refactor-or-create-e2e-test-suite.mdc` when:
- ✅ Creating a new test suite from scratch
- ✅ Major refactoring of existing tests
- ✅ Need detailed explanations and examples
- ✅ Want to understand the "why" behind patterns
- ✅ Learning how to structure tests

### Use `QUICK-REFERENCE.md` when:
- ✅ Already familiar with patterns, need quick lookup
- ✅ Want to copy-paste templates
- ✅ Need to check file naming conventions
- ✅ Quick violation checks
- ✅ Reference during code review

---

## 🚀 Quick Start

### Creating Test Suite for New SDK Example

1. **Mention the rule**:
   ```
   @test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Create test suite for SDK example 08_workflow_with_conditionals.go
   ```

2. **What gets created**:
   ```
   test/e2e/
   ├── workflow_conditional_test_constants.go   ← Constants from SDK
   ├── workflow_conditional_test_helpers.go     ← Reusable helpers
   ├── workflow_conditional_apply_core_test.go  ← Main test
   ├── workflow_conditional_apply_count_test.go ← Count test
   └── workflow_conditional_apply_dryrun_test.go← Dry-run test
   ```

3. **Verify**:
   ```bash
   cd test/e2e
   go test -v -tags=e2e -run "TestE2E/TestConditional"
   ```

---

### Refactoring Existing Test

1. **Check for violations**:
   ```bash
   cd test/e2e
   wc -l basic_agent_run_test.go  # Should be < 250 lines
   ```

2. **Mention the rule**:
   ```
   @test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor test/e2e/basic_agent_run_test.go to follow standards
   ```

3. **What happens**:
   - Extracts constants from magic strings
   - Creates reusable helpers
   - Splits into focused test files
   - Verifies all tests still pass
   - Documents the refactoring

---

## 📊 Current Status

### ✅ Already Refactored
- `basic_workflow_apply_*.go` (5 files) - **Fully refactored** ✅
  - See: `test/e2e/docs/implementation/workflow-apply-tests-refactoring-2026-01-23.md`

### ❌ Needs Refactoring
- `basic_agent_run_test.go` (278 lines) - Exceeds 250 line limit
- `basic_workflow_run_test.go` (263 lines) - Exceeds 250 line limit  
- `workflow_calling_agent_apply_test.go` (294 lines) - Exceeds 250 line limit

---

## 🎓 Core Principles

### 1. SDK Sync Strategy (MANDATORY)
- SDK examples are the source of truth
- Tests use values from SDK examples
- Constants reference SDK example file
- Never create manual test fixtures

### 2. Engineering Standards (MANDATORY)
- **File size**: Max 250 lines (ideal: 50-150)
- **Function size**: Max 50 lines (ideal: 20-40)
- **No magic strings**: Define constants
- **No duplication**: Extract helpers
- **Single responsibility**: One file, one purpose

### 3. Layered Architecture
```
Constants Layer  → SDK example values (names, paths, counts)
Helpers Layer    → Reusable apply/verify functions  
Test Layer       → Individual focused test files
```

---

## 📚 Related Documentation

### In This Repository
- `test/e2e/docs/guides/sdk-sync-strategy.md` - SDK synchronization strategy
- `test/e2e/docs/implementation/workflow-apply-tests-refactoring-2026-01-23.md` - Example refactoring
- `test/e2e/testdata/README.md` - Test fixture organization

### SDK Examples (Source of Truth)
- `sdk/go/examples/01_basic_agent.go` - Agent examples
- `sdk/go/examples/07_basic_workflow.go` - Workflow examples
- `sdk/go/examples/15_workflow_calling_simple_agent.go` - Integration examples

### Engineering Standards
- `.cursor/rules/client-apps/cli/coding-guidelines.mdc` - General coding standards

---

## 🛠️ Common Commands

### Check Test File Sizes
```bash
cd test/e2e
wc -l *_test.go | awk '$1 > 250 {print $2 " exceeds limit: " $1 " lines"}'
```

### Run Specific Test Suite
```bash
# Workflow tests
go test -v -tags=e2e -run "TestE2E/TestApplyBasicWorkflow"

# Agent tests
go test -v -tags=e2e -run "TestE2E/TestRunBasicAgent"

# All E2E tests
go test -v -tags=e2e -run "^TestE2E$"
```

### Count Magic Strings (Violations)
```bash
# Check for repeated literal strings (should be constants)
grep -r '"code-reviewer"' *.go | wc -l
grep -r '"local"' *.go | wc -l
grep -r '"basic-data-fetch"' *.go | wc -l
```

---

## ✅ Success Criteria

After refactoring, your tests should have:

- ✅ All files under 250 lines (ideally under 150)
- ✅ All functions under 50 lines (ideally 20-40)
- ✅ Zero magic strings (all constants)
- ✅ Zero code duplication (helpers extract common code)
- ✅ Clear, descriptive names
- ✅ Tests passing with same behavior
- ✅ SDK sync strategy maintained
- ✅ Documentation updated

---

## 💡 Pro Tips

1. **Start Small**: Refactor smallest file first to build confidence
2. **Constants First**: Create constants file before extracting helpers
3. **Keep Tests Passing**: Refactor in small, verifiable steps
4. **Reference SDK**: Always mention which SDK example is the source
5. **One Responsibility**: If explaining a file requires "and", split it

---

## 🤝 Contributing

When adding new test files:

1. **Follow the pattern**: Use constants + helpers + focused tests
2. **Reference SDK example**: Always note which SDK file is the source
3. **Keep files small**: Under 250 lines (split if larger)
4. **Document changes**: Update implementation docs when refactoring
5. **Run full suite**: Ensure all tests pass before committing

---

## 📞 Need Help?

1. **Read the full rule**: `refactor-or-create-e2e-test-suite.mdc`
2. **Check quick reference**: `QUICK-REFERENCE.md`
3. **See examples**: `test/e2e/workflow_test_*.go` files
4. **Review refactoring doc**: `test/e2e/docs/implementation/workflow-apply-tests-refactoring-2026-01-23.md`

---

**Remember**: Good tests are documentation. Make them readable, maintainable, and trustworthy! 🎯
