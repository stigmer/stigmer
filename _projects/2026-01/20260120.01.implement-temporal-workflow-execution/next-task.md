# Next Task: Manual Runtime Testing

**Task**: Task 5 - Manual Runtime Testing  
**Status**: ⏸️ Ready to Start (Bug Fix Applied)  
**Priority**: HIGH  
**Estimated Time**: 30-45 minutes

---

## Recent Update (2026-01-20)

🔧 **Critical Bug Fixed**: Temporal workflow registration names

**Issue**: All three workflows were failing with "workflow type not found" errors due to mismatch between registration names (implicit) and invocation names (explicit).

**Fix**: Updated all three workers to use `RegisterWorkflowWithOptions` with explicit workflow names matching Java pattern.

**Status**: ✅ Fixed and verified (build successful)

**Details**: See checkpoint `checkpoints/2026-01-20-temporal-workflow-registration-fix.md`

---

## Context

🎉 **ALL IMPLEMENTATION COMPLETE!**

The Temporal infrastructure and controller integrations are now complete:
- ✅ All 3 workers implemented and running
- ✅ All 3 controller integrations complete
- ✅ Code compiles and builds successfully
- ✅ Full parity with Java Cloud achieved
- ✅ Workflow registration bug fixed

**What's Next**: Manual runtime testing to verify end-to-end behavior.

---

## Task 5: Manual Runtime Testing

### Objective

Verify that all three Temporal integrations work correctly at runtime:
1. Workflow validation (invalid workflows rejected, valid workflows accepted)
2. Agent execution triggering (executions transition from PENDING → RUNNING)
3. Workflow execution triggering (verify still working after recent changes)

### Prerequisites

**Start Temporal Server**:
```bash
temporal server start-dev
```

**Access Temporal UI**:
- Open browser: http://localhost:8233
- Verify UI loads

### Test 1: Workflow Validation (NEW)

**Purpose**: Verify workflows are validated via Temporal before persistence

**Test 1a: Invalid Workflow (Should Fail)**

1. Create invalid workflow YAML:
```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: invalid-test-workflow
  owner_scope: platform
spec:
  serverless_workflow:
    # Missing required fields
    id: test
    # Missing states, etc.
```

2. Apply via CLI:
```bash
stigmer apply workflow invalid-workflow.yaml
```

3. **Expected Result**:
   - ❌ Error: "workflow validation failed: ..."
   - Error message from Zigflow parser
   - Workflow NOT created in database

4. **Check Logs**:
```bash
# Look for validation logs in stigmer-server output:
# - "Starting Layer 2: Temporal validation"
# - "Layer 2: Validation failed (state: INVALID)"
# - Error details from Zigflow
```

5. **Check Temporal UI**:
   - Navigate to Workflows
   - Search for: `stigmer/workflow-validation/`
   - Should see completed workflow with validation result

**Test 1b: Valid Workflow (Should Succeed)**

1. Create valid workflow YAML (use example from docs)

2. Apply via CLI:
```bash
stigmer apply workflow valid-workflow.yaml
```

3. **Expected Result**:
   - ✅ Success: "Workflow created: ..."
   - Workflow persisted to database

4. **Check Logs**:
```bash
# Look for validation logs:
# - "✓ Layer 2: Validation passed (state: VALID)"
# - "Workflow validation completed successfully"
```

5. **Check Temporal UI**:
   - Should see completed validation workflow
   - Workflow marked as completed
   - No errors

**Test 1c: Validation Without Temporal (Graceful Degradation)**

1. Stop Temporal server

2. Try to create workflow:
```bash
stigmer apply workflow test-workflow.yaml
```

3. **Expected Result**:
   - ⚠️ Warning: "Skipping workflow validation - Temporal validator not available"
   - Workflow created (no validation)
   - Success (graceful degradation)

### Test 2: Agent Execution Triggering (NEW)

**Purpose**: Verify agent executions trigger Temporal workflows and transition to RUNNING

**Prerequisites**:
- Agent created
- agent-runner service running

**Test 2a: Agent Execution (Should Trigger Workflow)**

1. Start agent-runner:
```bash
cd backend/services/agent-runner
python -m agent_runner.main
```

2. Create agent execution:
```bash
stigmer agent-execution create \
  --agent-id <agent-id> \
  --name test-execution
```

3. **Expected Result**:
   - ✅ Execution created: execution ID returned
   - Initial phase: PENDING

4. **Check stigmer-server Logs**:
```bash
# Look for:
# - "Setting execution phase to PENDING"
# - "Starting Temporal workflow for execution: <id>"
# - "Temporal workflow started successfully"
```

5. **Check Temporal UI**:
   - Navigate to Workflows
   - Search for: `stigmer/agent-execution/`
   - Should see RUNNING workflow on `agent_execution_stigmer` queue
   - Worker: stigmer-server

6. **Check Execution Status**:
```bash
stigmer agent-execution get <execution-id>
# Expected: phase transitions PENDING → RUNNING → COMPLETED/FAILED
```

**Test 2b: Agent Execution Without Temporal (Graceful Degradation)**

1. Stop Temporal server

2. Create agent execution:
```bash
stigmer agent-execution create --agent-id <id>
```

3. **Expected Result**:
   - ⚠️ Warning: "Workflow creator not available - execution will remain in PENDING"
   - Execution created with phase=PENDING
   - Success (graceful degradation)

4. **Check Status**:
```bash
stigmer agent-execution get <execution-id>
# Expected: phase=PENDING (never transitions)
```

### Test 3: Workflow Execution (Verification)

**Purpose**: Verify workflow executions still work after recent changes

**Test 3a: Workflow Execution (Should Work)**

1. Ensure workflow and workflow instance exist

2. Create workflow execution:
```bash
stigmer workflow-execution create \
  --workflow-instance-id <instance-id> \
  --name test-execution
```

3. **Expected Result**:
   - ✅ Execution created
   - Phase: PENDING

4. **Check Temporal UI**:
   - Should see workflow on `workflow_execution_stigmer` queue
   - Workflow should progress

5. **Check Subscribe Stream**:
```bash
stigmer workflow-execution subscribe <execution-id>
# Expected: Real-time status updates as execution progresses
```

### Test 4: All Three Workers in Temporal UI

**Verify All Workers Visible**:

1. Open Temporal UI: http://localhost:8233
2. Navigate to: Workers
3. **Expected Workers**:
   - ✅ `workflow_execution_stigmer` (stigmer-server)
   - ✅ `workflow_execution_runner` (workflow-runner)
   - ✅ `agent_execution_stigmer` (stigmer-server)
   - ✅ `agent_execution_runner` (agent-runner)
   - ✅ `workflow_validation_stigmer` (stigmer-server)
   - ✅ `workflow_validation_runner` (workflow-runner)

**Status**: All 6 workers should show as RUNNING

---

## Success Criteria

This task is complete when:

### Workflow Validation
- [ ] Invalid workflows are rejected with Zigflow errors
- [ ] Valid workflows are accepted and created
- [ ] Validation workflows visible in Temporal UI
- [ ] Graceful degradation works (without Temporal)
- [ ] Logs show Layer 2 validation executing

### Agent Execution
- [ ] Agent executions trigger Temporal workflows
- [ ] Executions transition from PENDING → RUNNING
- [ ] Workflows visible in Temporal UI on correct queue
- [ ] Graceful degradation works (stays PENDING without Temporal)
- [ ] Failed workflow starts mark execution FAILED

### Workflow Execution
- [ ] Workflow executions still work correctly
- [ ] Status transitions happen
- [ ] Subscribe streams work
- [ ] Temporal UI shows workflows

### Overall
- [ ] All 6 workers visible in Temporal UI
- [ ] No errors in stigmer-server logs
- [ ] No errors in agent-runner/workflow-runner logs
- [ ] Graceful degradation works for all domains

---

## Troubleshooting

### Workflow Validation Not Running

**Symptom**: Workflows created without validation logs

**Check**:
```bash
# 1. Is Temporal running?
temporal workflow list

# 2. Is workflow validation worker registered?
# Check stigmer-server logs for:
# "Created workflow validation worker and validator"
# "Workflow validation worker started"

# 3. Is workflow-runner running?
# Check for ValidateWorkflow activity registration
```

**Fix**: Restart stigmer-server and verify Temporal connection logs

### Agent Execution Stuck in PENDING

**Symptom**: Executions never transition to RUNNING

**Check**:
```bash
# 1. Is agent-runner running?
ps aux | grep agent-runner

# 2. Is Temporal workflow triggered?
# Check stigmer-server logs for:
# "Starting Temporal workflow for execution: <id>"

# 3. Check Temporal UI
# Search for: stigmer/agent-execution/<id>
```

**Fix**:
- If workflow not in UI: Temporal not connected (check logs)
- If workflow in UI but not progressing: Check agent-runner logs
- If workflow failed: Check error in Temporal UI

### Workflow Validation Timeout

**Symptom**: Validation takes >30 seconds or times out

**Check**:
```bash
# 1. Is workflow-runner running?
ps aux | grep workflow-runner

# 2. Check Temporal UI for workflow
# Look for activity timeout or failure
```

**Fix**: Ensure workflow-runner has `ValidateWorkflow` activity registered on `workflow_validation_runner` queue

---

## After Testing

When all tests pass:

1. **Document Results**: Add test results to checkpoint or CURRENT_STATUS.md
2. **Mark Task Complete**: Update tasks.md
3. **Update README**: Note that project is complete and tested
4. **Celebrate**: 🎉 Full Temporal integration complete!

---

## If Issues Found

If testing reveals issues:

1. **Document the issue** in project notes or create a new task
2. **Debug using logs** (stigmer-server, agent-runner, workflow-runner, Temporal UI)
3. **Fix and iterate** until tests pass
4. **Update checkpoint** with findings

---

**Status**: Ready to begin manual testing  
**Next**: Run Test 1 (Workflow Validation)  
**Estimated Time**: 30-45 minutes for all tests

---

*Updated: 2026-01-20 22:22*
