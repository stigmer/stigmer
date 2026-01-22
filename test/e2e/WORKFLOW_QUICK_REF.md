# Workflow E2E Testing - Quick Reference

## 🚀 Run Tests

```bash
# Phase 1: Deploy tests (fast, 5 sec)
cd test/e2e
go test -v -tags=e2e -run TestWorkflowApply

# Phase 2: Execution tests (slow, 30-60 sec)
go test -v -tags=e2e -run TestWorkflowExecution

# All workflow tests
go test -v -tags=e2e -run TestWorkflow -timeout 120s

# Specific test
go test -v -tags=e2e -run TestWorkflowApply/TestApplySimpleSequential
```

## 📋 Test Coverage

| Workflow | Task Types | Deploy | Execute |
|----------|-----------|--------|---------|
| Simple Sequential | SET, HTTP_CALL | ✅ | ⏳ |
| Conditional Switch | SET, SWITCH | ✅ | ⏳ |
| Parallel Fork | SET, FORK | ✅ | ⏳ |
| Loop For | SET, FOR | ✅ | ⏳ |
| Error Handling | SET, TRY | ✅ | ⏳ |

## 📂 Files

```
test/e2e/
├── e2e_workflow_test.go          ← Main test file
├── WORKFLOW_TESTING_GUIDE.md     ← Complete guide  
└── testdata/workflows/
    ├── README.md                 ← Fixture docs
    ├── simple_sequential.go      ← Basic test
    ├── conditional_switch.go     ← Switch test
    ├── parallel_fork.go          ← Fork test
    ├── loop_for.go               ← Loop test
    └── error_handling.go         ← Try/Catch test
```

## 🎯 What It Tests

**Critical Pipeline**: Go SDK → Proto → YAML → Temporal

1. **Task Configuration** - Serialization correctness
2. **Dependencies** - Implicit & explicit tracking
3. **Control Flow** - Sequential, parallel, conditional, loop, error
4. **Data Flow** - Field references, context, exports

## 📚 Documentation

- **WORKFLOW_TESTING_GUIDE.md** - Complete guide (483 lines)
- **testdata/workflows/README.md** - Fixture docs (267 lines)
- **WORKFLOW_TESTING_SUMMARY.md** - Implementation summary
- **WORKFLOW_QUICK_REF.md** - This file

## 🐛 Debugging

```bash
# Check workflow structure
stigmer apply --config testdata/workflows/Stigmer.yaml

# View Temporal UI
open http://localhost:8233

# Check logs
stigmer server  # (see terminal output)
```

## ✨ Next Steps

1. Run Phase 1 tests → Verify all pass
2. Implement Phase 2 execution tests (2-3 hours)
3. Add more task types (GRPC_CALL, AGENT_CALL, RUN)
4. Add error scenarios
5. CI/CD integration
