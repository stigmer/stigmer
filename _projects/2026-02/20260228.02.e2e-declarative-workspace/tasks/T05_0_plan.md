# T05: End-to-End Testing

**Status**: PENDING
**Created**: 2026-02-28
**Depends On**: T02 (done), T03, T04

## Objective

Validate the complete flow works from fresh install through agent execution with workspace provisioning and platform file isolation. Document the test results.

## Prerequisites

Before running these tests:
1. T02 complete (declarative track enhanced) — **DONE**
2. T03 complete (seedpack is a project)
3. T04 complete (CLI `--workspace` flag)
4. `STIGMER_WORKSPACE_PROVISIONING_ENABLED=1` set in environment
5. `ANTHROPIC_API_KEY` set (for draft commands)

## Test Scenarios

### Scenario 1: Fresh Bootstrap

```bash
# Reset server state
stigmer server reset
stigmer server start

# Verify system resources
stigmer list agents
# Expected: skill-creator, agent-creator, mcp-server-creator

stigmer list skills
# Expected: skill-creator, agent-creator, mcp-server-creator

stigmer list mcp-servers
# Expected: stigmer-mcp-server
```

### Scenario 2: Draft Commands

```bash
# Draft a skill (uses skill-creator agent)
stigmer draft skill -m "Create a skill that helps write unit tests for Go code" \
  --output /tmp/test-skill

# Expected: SKILL.md created in /tmp/test-skill/test-skill/

# Draft an agent (uses agent-creator agent)
stigmer draft agent -m "Create an agent that reviews Go code for best practices" \
  --output /tmp/test-agent

# Expected: agent YAML created in /tmp/test-agent/
```

### Scenario 3: Seedpack Apply (Declarative Track)

```bash
cd backend/services/stigmer-server/pkg/seedpack
stigmer apply

# Expected output:
#   Skills pushed: 3
#   Resources applied: 4 (3 agents, 1 MCP server)
#   Project "stigmer-seedpack" created with 7 members

stigmer get project stigmer-seedpack
# Expected: Project with 7 members listed
```

### Scenario 4: Seedpack Apply with Prune

```bash
cd backend/services/stigmer-server/pkg/seedpack

# Temporarily remove an agent YAML, apply with prune
mv agents/mcp-server-creator.yaml /tmp/
stigmer apply --prune
# Expected: mcp-server-creator agent deleted (orphan pruned)

# Restore and re-apply
mv /tmp/mcp-server-creator.yaml agents/
stigmer apply
# Expected: mcp-server-creator agent re-created
```

### Scenario 5: Agent Run (Empty Workspace)

```bash
stigmer run agent skill-creator -m "Create a hello-world skill"
# Expected: Agent executes, creates skill files as artifacts
```

### Scenario 6: Agent Run (Git Workspace)

```bash
export STIGMER_WORKSPACE_PROVISIONING_ENABLED=1

stigmer run agent skill-creator \
  --workspace https://github.com/stigmer/stigmer-example-project \
  -m "Review the code in this repository"

# Expected:
# - Repo cloned into workspace
# - Agent sees repo files
# - Git diff artifact generated after execution
```

### Scenario 7: Agent Run (Local Path)

```bash
export STIGMER_WORKSPACE_PROVISIONING_ENABLED=1

mkdir -p /tmp/test-workspace && echo "hello" > /tmp/test-workspace/README.md

stigmer run agent skill-creator \
  --workspace /tmp/test-workspace \
  -m "Create a skill based on the project in your workspace"

# Expected:
# - Agent sees /tmp/test-workspace files
# - Platform files in ~/.stigmer/sessions/{session_id}/platform/
# - No platform files in /tmp/test-workspace/
# - ls /tmp/test-workspace → only README.md (no .stigmer/ pollution)
```

### Scenario 8: Custom Project (Full Lifecycle)

```bash
mkdir -p /tmp/my-agents && cd /tmp/my-agents

cat > stigmer.yaml <<'EOF'
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-agents
spec:
  description: My test agent fleet
EOF

# Draft and create resources
stigmer draft skill -m "Create a skill for reviewing Python code" --output .
stigmer draft agent -m "Create an agent for code review that uses the python-reviewer skill" --output .

# Apply the project
stigmer apply
# Expected: Skills pushed, agents applied, project created

# List resources
stigmer list agents --org local
stigmer list skills --org local
```

## Test Results Template

| # | Scenario | Status | Notes |
|---|----------|--------|-------|
| 1 | Fresh Bootstrap | | |
| 2 | Draft Commands | | |
| 3 | Seedpack Apply | | |
| 4 | Seedpack Prune | | |
| 5 | Agent Run (empty) | | |
| 6 | Agent Run (git) | | |
| 7 | Agent Run (local path) | | |
| 8 | Custom Project | | |

## Success Criteria

- All 8 scenarios pass
- No regressions in existing CLI commands
- Platform file isolation verified (no `.stigmer/` in user workspace)
- Git diff artifacts clean (no platform file noise)
