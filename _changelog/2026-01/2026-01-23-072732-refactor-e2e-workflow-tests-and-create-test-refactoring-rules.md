# Refactor E2E Workflow Tests and Create Test Refactoring Rules

**Date**: 2026-01-23  
**Type**: Test Infrastructure + Documentation  
**Scope**: `test/e2e/`  
**Impact**: High - Establishes testing standards and patterns for all future E2E tests

---

## Summary

Refactored E2E workflow apply tests to follow engineering standards, eliminating code violations and improving maintainability. Created comprehensive Cursor rules to guide future test refactoring and creation, ensuring consistency across all E2E test suites.

**Key Achievements:**
1. ✅ Refactored workflow apply tests (267 lines → 7 focused files < 170 lines each)
2. ✅ Fixed all engineering violations (file size, function size, magic strings, duplication)
3. ✅ Created comprehensive E2E test refactoring rules (~1000 lines of guidance)
4. ✅ Established reusable patterns for all future test suites
5. ✅ All tests passing (5/5) with identical behavior

---

## Problem Statement

### Original Issues

**Test Code Violations:**
- `basic_workflow_apply_test.go` exceeded file size limit (267 lines, limit: 250)
- Test methods too long (97 lines, limit: 50)
- Extensive code duplication (~120 lines repeated across tests)
- Magic strings throughout (15+ occurrences)
- Inconsistent error handling

**Missing Standards:**
- No established pattern for creating new test suites
- No guidance for refactoring existing tests
- Inconsistent file organization across test categories

**Impact:**
- Tests hard to maintain and understand
- High risk of bugs when copy-pasting
- Difficult to extend with new test cases
- No clear pattern for new developers to follow

---

## Solution

### Part 1: Refactor Workflow Apply Tests

Split monolithic test file into layered architecture following SDK sync strategy:

#### Layer 1: Constants (`workflow_test_constants.go` - 31 lines)

**Purpose**: Single source of truth for SDK example values

```go
const (
    // Workflow names from SDK examples (source of truth)
    BasicWorkflowName      = "basic-data-fetch"  // From 07_basic_workflow.go
    BasicWorkflowNamespace = "data-processing"
    BasicWorkflowVersion   = "1.0.0"
    
    // Task names from SDK example
    BasicWorkflowFetchTask   = "fetchData"
    BasicWorkflowProcessTask = "processResponse"
    
    // Expected counts
    BasicWorkflowTaskCount = 2
    BasicWorkflowEnvVarCount = 1
    
    LocalOrg = "local"
)
```

**Benefits:**
- ✅ No magic strings
- ✅ IDE autocomplete
- ✅ Single update point
- ✅ Clear SDK example connection

#### Layer 2: Helpers (`workflow_test_helpers.go` - 169 lines)

**Purpose**: Reusable functions for common test operations

```go
// Apply helper - eliminates duplication
func ApplyBasicWorkflow(t *testing.T, serverPort int) *WorkflowApplyResult

// Verification helpers - consistent validation
func VerifyWorkflowBasicProperties(t *testing.T, workflow *workflowv1.Workflow)
func VerifyWorkflowTasks(t *testing.T, workflow *workflowv1.Workflow)
func VerifyWorkflowEnvironmentVariables(t *testing.T, workflow *workflowv1.Workflow)
func VerifyWorkflowDefaultInstance(t *testing.T, serverPort int, workflow *workflowv1.Workflow)
```

**Benefits:**
- ✅ Eliminated ~120 lines of duplication
- ✅ Each helper has single responsibility
- ✅ Consistent error messages
- ✅ Clear logging for debugging
- ✅ Reusable across all workflow tests

#### Layer 3: Individual Test Files (5 files, 24-48 lines each)

**Purpose**: Focused test files, one aspect per file

1. **`basic_workflow_apply_core_test.go` (48 lines)**
   - Main apply lifecycle test
   - Verifies complete workflow from apply to instance creation

2. **`basic_workflow_apply_count_test.go` (29 lines)**
   - Ensures SDK example creates exactly 1 workflow
   - Maintains parity with SDK example

3. **`basic_workflow_apply_dryrun_test.go` (26 lines)**
   - Tests dry-run mode (no actual deployment)
   - Verifies table output format

4. **`basic_workflow_apply_context_test.go` (36 lines)**
   - Verifies context management (`stigmer.Run()` pattern)
   - Validates compile-time configuration handling

5. **`basic_workflow_apply_dependencies_test.go` (45 lines)**
   - Tests implicit task dependencies
   - Verifies SDK pattern of field-based dependencies

**Benefits:**
- ✅ Each file under 50 lines
- ✅ Clear, single purpose per file
- ✅ Easy to find specific test
- ✅ Simple to extend with new tests

### Part 2: Create E2E Test Refactoring Rules

Created comprehensive Cursor rule system in `test/e2e/_rules/`:

#### 1. Main Rule (`refactor-or-create-e2e-test-suite.mdc` - ~1000 lines)

**Sections:**
- **When to Use**: Criteria for triggering (file size, duplicat

ion, magic strings)
- **Core Principles**: SDK sync strategy + engineering standards
- **Implementation Pattern**: Step-by-step guide
  - Analyze SDK example
  - Create constants file
  - Create helpers file
  - Create individual test files
  - Verify SDK example is copied
  - Run tests
- **Common Test Scenarios**: Apply tests, run tests, feature tests
- **Refactoring Existing Tests**: 5-phase approach
- **Quality Checklist**: Verification before completion
- **Anti-Patterns**: What to avoid
- **Troubleshooting**: Common issues and solutions

**Example Usage:**
```
@test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Create test suite for SDK example 08_workflow_with_conditionals.go
```

or

```
@test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor test/e2e/basic_agent_run_test.go to follow standards
```

#### 2. Quick Reference (`QUICK-REFERENCE.md` - ~200 lines)

**Purpose**: Fast lookup for templates and patterns

**Contents:**
- Quick start commands
- File naming conventions
- Copy-paste templates (constants, helpers, tests)
- Checklists
- Violation checks
- Pro tips

#### 3. README (`README.md` - ~450 lines)

**Purpose**: Overview and navigation guide

**Contents:**
- What's in `_rules/` folder
- Which file to use when
- Quick start guides
- Current refactoring status
- Common commands
- Success criteria

---

## Implementation Details

### Refactoring Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Single File Size** | 267 lines | 169 lines (largest) | ✅ 37% reduction |
| **Largest Test Method** | 97 lines | 48 lines | ✅ 51% reduction |
| **Magic Strings** | 15+ occurrences | 0 | ✅ 100% eliminated |
| **Code Duplication** | ~120 lines | 0 | ✅ 100% eliminated |
| **Number of Files** | 1 | 7 | Better organization |
| **Test Pass Rate** | 5/5 | 5/5 | ✅ Maintained |
| **Test Execution Time** | ~1.6s | ~1.6s | ⚡ No impact |

### File Structure Changes

**Before:**
```
test/e2e/
└── basic_workflow_apply_test.go (267 lines, 5 violations)
```

**After:**
```
test/e2e/
├── _rules/                                          ← NEW
│   ├── README.md (450 lines)
│   ├── QUICK-REFERENCE.md (200 lines)
│   └── refactor-or-create-e2e-test-suite.mdc (~1000 lines)
│
├── workflow_test_constants.go (31 lines)            ← NEW
├── workflow_test_helpers.go (169 lines)             ← NEW
├── basic_workflow_apply_core_test.go (48 lines)    ← NEW
├── basic_workflow_apply_count_test.go (29 lines)   ← NEW
├── basic_workflow_apply_dryrun_test.go (26 lines)  ← NEW
├── basic_workflow_apply_context_test.go (36 lines) ← NEW
└── basic_workflow_apply_dependencies_test.go (45 lines) ← NEW
```

### SDK Sync Strategy Maintained

**✅ Critical: No changes to SDK example needed**

The refactoring:
- Uses constants that match SDK example (`basic-data-fetch`, `fetchData`, etc.)
- Tests reference exact names from `sdk/go/examples/07_basic_workflow.go`
- Automatic copy mechanism still works (already in `sdk_fixtures_test.go`)
- If SDK example changes, just update constants once

**SDK example remains source of truth:**
```go
// Constant references SDK example
const BasicWorkflowName = "basic-data-fetch"  // From 07_basic_workflow.go

// Tests use constant
workflow, err := GetWorkflowBySlug(serverPort, BasicWorkflowName, LocalOrg)
```

### Test Execution Results

All 5 workflow apply tests passing with identical behavior:

```bash
=== RUN   TestE2E/TestApplyBasicWorkflow
    --- PASS: TestE2E/TestApplyBasicWorkflow (0.34s)

=== RUN   TestE2E/TestApplyWorkflowCount
    --- PASS: TestE2E/TestApplyWorkflowCount (0.34s)

=== RUN   TestE2E/TestApplyWorkflowDryRun
    --- PASS: TestE2E/TestApplyWorkflowDryRun (0.28s)

=== RUN   TestE2E/TestApplyWorkflowWithContext
    --- PASS: TestE2E/TestApplyWorkflowWithContext (0.34s)

=== RUN   TestE2E/TestApplyWorkflowTaskDependencies
    --- PASS: TestE2E/TestApplyWorkflowTaskDependencies (0.33s)
```

**Total Runtime**: ~1.6 seconds (no performance regression)

---

## Documentation Created

### Test Documentation

1. **`test/e2e/docs/implementation/workflow-apply-tests-refactoring-2026-01-23.md`**
   - Complete refactoring summary
   - Before/after metrics
   - Step-by-step changes
   - Quality improvements
   - SDK sync compliance
   - Success criteria

### Rule Documentation

2. **`test/e2e/_rules/README.md`**
   - Overview of rule system
   - Which rule to use when
   - Quick start guides
   - Current refactoring status
   - Common commands

3. **`test/e2e/_rules/QUICK-REFERENCE.md`**
   - Copy-paste templates
   - File naming patterns
   - Quick commands
   - Checklists
   - Pro tips

4. **`test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc`**
   - Comprehensive implementation guide
   - Core principles (SDK sync + engineering standards)
   - Step-by-step patterns
   - Refactoring phases
   - Anti-patterns
   - Troubleshooting
   - Quality checklist

---

## Benefits

### Immediate Benefits

**Code Quality:**
- ✅ All files under 250 lines (largest: 169)
- ✅ All functions under 50 lines (largest test: 48)
- ✅ Zero magic strings (all constants)
- ✅ Zero code duplication (helpers extract common code)
- ✅ Consistent error handling

**Maintainability:**
- ✅ Easy to find specific tests (one file per aspect)
- ✅ Clear structure (constants → helpers → tests)
- ✅ Tests serve as documentation
- ✅ Simple to extend with new tests

**SDK Sync:**
- ✅ Constants make SDK connection explicit
- ✅ Changes to SDK example caught immediately
- ✅ Single source of truth maintained
- ✅ No manual test fixture creation

### Long-Term Benefits

**Established Patterns:**
- ✅ Clear template for creating new test suites
- ✅ Proven refactoring approach for existing tests
- ✅ Consistent organization across all E2E tests
- ✅ Reduced cognitive load for developers

**Continuous Improvement:**
- ✅ Easy to add new workflow tests (reuse helpers)
- ✅ Can extend patterns to other test categories
- ✅ Foundation for test quality automation
- ✅ Documentation evolves with tests

**Team Productivity:**
- ✅ New developers have clear patterns to follow
- ✅ Code reviews faster (consistent structure)
- ✅ Less time debugging tests
- ✅ Confident refactoring with helper extraction

---

## Remaining Work

### Files Needing Refactoring

Identified 3 more test files exceeding 250-line limit:

1. **`basic_agent_run_test.go`** (278 lines)
   - Status: ❌ Needs refactoring
   - Violations: File too long, code duplication, magic strings

2. **`basic_workflow_run_test.go`** (263 lines)
   - Status: ❌ Needs refactoring
   - Violations: File too long, code duplication

3. **`workflow_calling_agent_apply_test.go`** (294 lines)
   - Status: ❌ Needs refactoring
   - Violations: File too long, code duplication

**Can now use the rule:**
```
@test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor basic_agent_run_test.go
```

---

## Technical Decisions

### Decision 1: Layered Architecture

**Choice**: Split into constants → helpers → tests layers

**Rationale:**
- Constants establish contract with SDK examples
- Helpers eliminate duplication
- Individual test files maintain single responsibility
- Clear separation of concerns

**Alternative Considered**: Keep everything in one file with better organization
**Why Rejected**: Doesn't solve file size, duplication, or magic string issues

### Decision 2: Rules Location

**Choice**: `test/e2e/_rules/` instead of `.cursor/rules/test/`

**Rationale:**
- Rules right where they're used
- More discoverable when working in `test/e2e/`
- Self-contained documentation
- Clear that rules are E2E-specific

**Alternative Considered**: Keep in `.cursor/rules/test/`
**Why Rejected**: Rules too far from code they affect, less discoverable

### Decision 3: SDK Sync Strategy Enforcement

**Choice**: Maintain automatic copy mechanism, use constants from SDK examples

**Rationale:**
- SDK examples are source of truth
- Tests validate what users will actually use
- Changes to SDK caught by tests immediately
- No drift between examples and tests

**Alternative Considered**: Create manual test fixtures
**Why Rejected**: Creates drift risk, more maintenance burden

---

## Integration with Existing Systems

### SDK Sync Strategy

**Preserved:**
- SDK examples automatically copied to `testdata/examples/` before tests run
- Tests reference exact names/values from SDK examples
- `sdk_fixtures_test.go` unchanged
- All 19 SDK examples remain in sync

**Enhanced:**
- Constants make SDK connection more explicit
- Clear documentation of which SDK file is source
- Easier to update if SDK example changes

### Engineering Standards

**Compliant with:**
- `.cursor/rules/client-apps/cli/coding-guidelines.mdc`
  - File size limits (< 250 lines)
  - Function size limits (< 50 lines)
  - No magic strings
  - No code duplication
  - Single responsibility principle

**New Standard Established:**
- E2E tests now have documented structure pattern
- Can extend to agent tests, skill tests, etc.
- Consistent approach across all test categories

---

## Quality Assurance

### Pre-Refactoring Checks

- [x] All tests passing before refactoring (5/5)
- [x] Identified all violations (file size, function size, duplication, magic strings)
- [x] Analyzed SDK example for source of truth values
- [x] Planned file structure (constants, helpers, individual tests)

### Post-Refactoring Verification

- [x] All tests still passing (5/5)
- [x] No performance regression (~1.6s before and after)
- [x] All files under 250 lines
- [x] All functions under 50 lines
- [x] Zero magic strings
- [x] Zero code duplication
- [x] SDK sync strategy maintained
- [x] Documentation comprehensive

### Rule Quality Checks

- [x] Main rule comprehensive (~1000 lines of guidance)
- [x] Quick reference created for fast lookup
- [x] README provides clear navigation
- [x] Examples from actual refactoring included
- [x] Anti-patterns documented
- [x] Troubleshooting guide included
- [x] Quality checklist provided

---

## Lessons Learned

### What Worked Well

1. **Incremental Refactoring**
   - Created constants first (established contract)
   - Extracted helpers second (eliminated duplication)
   - Split tests last (maintained passing state)
   - Verified tests pass after each phase

2. **Helper Function Pattern**
   - `ApplyBasicWorkflow()` eliminated ~120 lines of duplication
   - Verification helpers (`Verify*`) made tests readable
   - Each helper has clear single responsibility
   - Reusable across all workflow tests

3. **Constants from SDK Example**
   - Made SDK sync strategy explicit
   - Eliminated magic strings completely
   - Single update point if SDK changes
   - Clear connection to source of truth

4. **Comprehensive Documentation**
   - Rule captures exact pattern used
   - Quick reference for fast lookup
   - README for navigation
   - Can now replicate for other test suites

### What to Improve

1. **Automated Violation Detection**
   - Could create script to find files > 250 lines
   - Could check for magic strings automatically
   - Could detect code duplication patterns

2. **Template Generation**
   - Could create script to generate constants file from SDK example
   - Could auto-generate helper skeletons
   - Could template test file structure

3. **Integration with CI**
   - Could enforce file size limits in CI
   - Could check for magic strings in PR checks
   - Could run test suite performance benchmarks

---

## Impact Assessment

### Code Health

**Before**: 
- 1 file with 5 violations
- Hard to maintain
- High duplication risk
- Unclear organization

**After**:
- 7 files with 0 violations
- Clear structure
- No duplication
- Self-documenting

**Impact**: 🟢 High - Test code quality significantly improved

### Developer Experience

**Before**:
- No clear pattern for creating tests
- Each developer might structure differently
- Hard to find specific test logic
- Uncertain what to extract as helper

**After**:
- Clear pattern documented in rules
- Consistent structure expected
- Easy to find tests (one file per aspect)
- Helper extraction guidance provided

**Impact**: 🟢 High - Clear patterns established for all E2E tests

### Future Maintenance

**Before**:
- Refactoring requires significant effort
- No guidance on how to structure tests
- Risk of introducing violations with new tests

**After**:
- Refactoring pattern documented
- Rules guide test creation
- Violations prevented by following pattern

**Impact**: 🟢 High - Maintenance significantly easier

### Test Reliability

**Before**:
- Tests passing but fragile (duplication risk)
- Magic strings could cause confusion
- Hard to verify SDK parity

**After**:
- Tests passing with clear structure
- Constants from SDK make parity explicit
- Easy to verify against SDK example

**Impact**: 🟢 Medium - Tests more maintainable, reliability unchanged

---

## Files Changed

### New Files Created (13)

**Test Files:**
1. `test/e2e/workflow_test_constants.go` (31 lines)
2. `test/e2e/workflow_test_helpers.go` (169 lines)
3. `test/e2e/basic_workflow_apply_core_test.go` (48 lines)
4. `test/e2e/basic_workflow_apply_count_test.go` (29 lines)
5. `test/e2e/basic_workflow_apply_dryrun_test.go` (26 lines)
6. `test/e2e/basic_workflow_apply_context_test.go` (36 lines)
7. `test/e2e/basic_workflow_apply_dependencies_test.go` (45 lines)

**Rule Files:**
8. `test/e2e/_rules/README.md` (450 lines)
9. `test/e2e/_rules/QUICK-REFERENCE.md` (200 lines)
10. `test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc` (~1000 lines)

**Documentation Files:**
11. `test/e2e/docs/implementation/workflow-apply-tests-refactoring-2026-01-23.md` (comprehensive refactoring summary)

### Files Deleted (1)

1. `test/e2e/basic_workflow_apply_test.go` (267 lines - replaced by 7 focused files)

### Summary

- **Lines added**: ~2,200 (tests + rules + documentation)
- **Lines removed**: 267 (old monolithic test)
- **Net change**: +1,933 lines
- **Quality improvement**: 5 violations eliminated, clear patterns established

---

## Next Steps

### Immediate (Can Use Rules Now)

1. **Refactor remaining test files:**
   ```
   @test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor basic_agent_run_test.go
   @test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor basic_workflow_run_test.go
   @test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Refactor workflow_calling_agent_apply_test.go
   ```

2. **Create test suites for new SDK examples:**
   ```
   @test/e2e/_rules/refactor-or-create-e2e-test-suite.mdc Create test suite for SDK example 08_workflow_with_conditionals.go
   ```

### Short-Term (Apply Patterns)

1. **Extend to other test categories**
   - Agent tests (similar structure)
   - Skill tests (when created)
   - Integration tests (cross-component)

2. **Create automation scripts**
   - Violation detection
   - Template generation
   - CI integration

### Long-Term (Systematic Improvement)

1. **Automated test generation**
   - Generate constants from SDK examples
   - Auto-create helper skeletons
   - Template test file structure

2. **Quality gates in CI**
   - Enforce file size limits
   - Check for magic strings
   - Validate SDK sync
   - Performance benchmarks

---

## Conclusion

Successfully refactored E2E workflow apply tests from monolithic 267-line file with 5 violations to clean 7-file structure with 0 violations. Created comprehensive Cursor rule system to guide all future E2E test creation and refactoring, establishing consistent patterns across the test suite.

**Key Achievements:**
- ✅ 100% violation elimination (file size, function size, magic strings, duplication)
- ✅ 100% test pass rate maintained (5/5 tests)
- ✅ 0% performance regression (~1.6s execution time)
- ✅ Comprehensive rules created (~1000 lines of guidance)
- ✅ Clear patterns established for all E2E tests
- ✅ SDK sync strategy preserved and enhanced

**Impact:**
- Code quality significantly improved
- Maintainability dramatically increased
- Clear patterns for future development
- Foundation for systematic test suite improvement
- Developer experience enhanced with documented standards

**Ready for:**
- Refactoring remaining 3 test files (278, 263, 294 lines)
- Creating test suites for new SDK examples
- Extending patterns to other test categories
- Systematic quality improvement across all E2E tests

This work establishes the foundation for maintaining high-quality, well-structured E2E tests that serve as reliable documentation and validation of Stigmer's functionality.
