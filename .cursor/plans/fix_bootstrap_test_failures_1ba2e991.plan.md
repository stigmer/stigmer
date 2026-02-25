---
name: Fix bootstrap test failures
overview: Update the 6 failing bootstrap tests to expect 2 agents instead of 1, reflecting the addition of agent-creator-agent to the seedpack.
todos:
  - id: update-success-test
    content: "Update TestBootstrapper_Run_Success: agent count 1->2, verify both agent names, add agent-creator-agent state check"
    status: completed
  - id: update-remaining-5
    content: Update agent count from 1 to 2 in Idempotent, SkipIfSameDigest, and all 3 DegradedMode tests
    status: completed
  - id: verify-tests
    content: Run bootstrap tests to confirm all 6 pass
    status: completed
isProject: false
---

# Fix Bootstrap Test Failures (6 tests)

## Root Cause

The seedpack `agents/` directory now contains **2 agent YAML files** (`agent-creator-agent.yaml` and `skill-creator-agent.yaml`), but all bootstrap tests were written when only 1 agent existed. The `discoverAgents()` function in [seedpack.go](backend/services/stigmer-server/pkg/seedpack/seedpack.go) sorts agents alphabetically, so the order is:

- Index 0: `agent-creator-agent`
- Index 1: `skill-creator-agent`

## Changes

All changes are in a single file: [bootstrap_test.go](backend/services/stigmer-server/pkg/bootstrap/bootstrap_test.go)

### 1. TestBootstrapper_Run_Success (lines 139-168)

- Line 140: `assert.Len(t, agentClient.ApplyCalls, 1)` -> `2`
- Line 141: Update name check from `agentClient.ApplyCalls[0]` expecting `"skill-creator-agent"` to instead verify both agents are present (index 0 = `"agent-creator-agent"`, index 1 = `"skill-creator-agent"`)
- Add a state verification for `agent-creator-agent` (similar to existing line 162-164 for `skill-creator-agent`)

### 2. TestBootstrapper_Run_Idempotent (line 191)

- Line 191: `assert.Len(t, agentClient.ApplyCalls, 1)` -> `2`

### 3. TestBootstrapper_Run_SkipIfSameDigest (line 236)

- Line 236: `assert.Len(t, agentClient.ApplyCalls, 1)` -> `2`

### 4. TestBootstrapper_Run_DegradedMode_SkillError (line 266)

- Line 266: `assert.Len(t, agentClient.ApplyCalls, 1)` -> `2`

### 5. TestBootstrapper_Run_DegradedMode_AgentError (line 301)

- Line 301: `assert.Len(t, agentClient.ApplyCalls, 1)` -> `2`

### 6. TestBootstrapper_Run_DegradedMode_McpServerError (line 336)

- Line 336: `assert.Len(t, agentClient.ApplyCalls, 1)` -> `2`

## Verification

Run the bootstrap package tests:

```
go test ./backend/services/stigmer-server/pkg/bootstrap/ -run 'TestBootstrapper_Run' -v
```

