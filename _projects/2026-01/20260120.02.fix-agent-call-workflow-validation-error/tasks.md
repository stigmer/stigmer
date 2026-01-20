# Tasks: Fix Agent Call Workflow Validation Error

**Project**: Fix Agent Call Workflow Validation Error  
**Status**: 🚧 In Progress

---

## Task 1: Verify Code Changes Are Actually in Place

**Status**: ⏸️ TODO  
**Priority**: Critical

### Objective
Verify that the code changes for agent call support actually exist in the source files.

### Steps
1. Check `unmarshal.go` has `WORKFLOW_TASK_KIND_AGENT_CALL` case
2. Check `proto_to_yaml.go` has `WORKFLOW_TASK_KIND_AGENT_CALL` case  
3. Check `task_converters.go` has `convertAgentCallTask()` function
4. Verify the enum value `WORKFLOW_TASK_KIND_AGENT_CALL` exists in proto stubs

### Success Criteria
- [ ] All three files contain the expected code changes
- [ ] Proto enum includes WORKFLOW_TASK_KIND_AGENT_CALL (value 13)

---

## Task 2: Debug Why Rebuilt Binary Still Throws Error

**Status**: ⏸️ TODO  
**Priority**: Critical

### Objective
Understand why the rebuilt workflow-runner binary is still throwing the "unsupported task kind" error.

### Investigation Areas

**1. Verify Binary Was Actually Rebuilt**
```bash
# Check binary modification time
ls -lh backend/services/workflow-runner/workflow-runner

# Check if Bazel rebuilt it
bazel info bazel-bin
ls -lh bazel-bin/backend/services/workflow-runner/
```

**2. Verify Daemon Is Using New Binary**
```bash
# Check which binary stigmer-server is launching
ps aux | grep workflow-runner

# Check workflow-runner PID and binary path
lsof -p <PID> | grep workflow-runner
```

**3. Check for Build Cache Issues**
```bash
# Clean Bazel cache
bazel clean --expunge

# Rebuild everything
bazel build //backend/services/workflow-runner/...
```

**4. Verify Code Is Compiled Into Binary**
```bash
# Check if binary contains the new function name
strings bazel-bin/backend/services/workflow-runner/workflow-runner_/workflow-runner | grep convertAgentCallTask
```

### Steps
1. Verify binary timestamp is recent (after code changes)
2. Check stigmer-server is using the correct binary path
3. Stop server, clean build, rebuild, restart
4. Verify new binary contains expected symbols

### Success Criteria
- [ ] Binary modification time is after code changes
- [ ] Daemon is using the newly built binary
- [ ] Binary contains expected function symbols
- [ ] Error message changes or disappears after rebuild

---

## Task 3: Check for Additional Code Paths or Caching

**Status**: ⏸️ TODO  
**Priority**: High

### Objective
Identify if there are other code paths that need updating or if there's a caching layer.

### Investigation Areas

**1. Search for Other Unmarshal/Convert Calls**
```bash
cd backend/services/workflow-runner
grep -r "UnmarshalTaskConfig" .
grep -r "convertTask" .
```

**2. Check If There's a Validation Cache**
```bash
# Look for cached validation results
grep -r "validation.*cache" .
grep -r "cached.*validation" .
```

**3. Check Temporal Workflow Cache**
- Temporal may cache workflow definitions
- Check if ValidateWorkflow workflow needs restart

**4. Check Activity Registration**
```bash
# Verify ValidateWorkflow activity is properly registered
grep -r "RegisterActivity.*Validate" .
```

### Steps
1. Search for all places that call UnmarshalTaskConfig
2. Search for all places that call convertTask
3. Check if Temporal worker needs restart
4. Check if there's a validation result cache

### Success Criteria
- [ ] All code paths identified and updated
- [ ] No caching mechanisms blocking new code
- [ ] Temporal worker registrations are correct

---

## Task 4: Implement Proper Fix and Test with Workflow

**Status**: ⏸️ TODO  
**Priority**: Critical

### Objective
Apply the complete fix and verify it works with a test workflow.

### Steps

**1. Apply Complete Fix**
- Ensure all code paths have agent call support
- Clean build and deploy
- Restart all services

**2. Test with Sample Workflow**
```bash
# Navigate to test project
cd ~/.stigmer/stigmer-project

# Run stigmer apply
stigmer apply

# Watch logs
stigmer server logs -c workflow-runner -f
```

**3. Verify Validation Succeeds**
- Watch workflow-runner logs for validation messages
- Confirm no "unsupported task kind" errors
- Verify YAML generation succeeds

**4. Check Generated YAML**
- Review validation logs for generated YAML structure
- Confirm agent call task converts to:
  ```yaml
  call: agent
  with:
    agent: <agent-name>
    message: <message>
  ```

### Success Criteria
- [ ] `stigmer apply` completes without validation errors
- [ ] Workflow-runner logs show successful YAML generation
- [ ] Generated YAML contains proper `call: agent` syntax
- [ ] Workflow deployment succeeds

---

## Task 5: Confirm Agent Call Tasks Execute Successfully

**Status**: ⏸️ TODO  
**Priority**: High

### Objective
Verify that agent call tasks not only validate but also execute properly.

### Steps

**1. Run Test Workflow**
```bash
# Execute the workflow
stigmer workflow run review-demo-pr
```

**2. Monitor Execution**
```bash
# Watch workflow execution logs
stigmer server logs -c workflow-runner -f

# Watch agent execution logs  
stigmer server logs -c agent-runner -f
```

**3. Verify Agent Execution**
- Confirm agent call task is executed
- Verify agent receives the message
- Check agent produces output
- Confirm workflow completes successfully

### Success Criteria
- [ ] Agent call task executes without errors
- [ ] Agent runner receives and processes the call
- [ ] Agent produces expected output
- [ ] Workflow completes successfully
- [ ] Workflow execution status shows SUCCESS

---

## Progress Summary

- **Total Tasks**: 5
- **Completed**: 0
- **In Progress**: 0
- **Remaining**: 5

## Current Focus

**Next Task**: Task 1 - Verify Code Changes Are in Place

Start by confirming the code changes actually exist in the source files before investigating why they're not working.
