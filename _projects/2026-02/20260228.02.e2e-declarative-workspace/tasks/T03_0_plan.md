# T03: Convert Seedpack into a Proper Stigmer Project

**Status**: PENDING
**Created**: 2026-02-28

## Objective

Convert the seedpack at `backend/services/stigmer-server/pkg/seedpack/` into a proper Stigmer project that can be applied with `stigmer apply`. This serves dual purposes:
1. Validates the declarative track works end-to-end with a real project
2. Becomes the canonical reference project for customers

## Why Keep It In Place

The Go `embed` directive requires files within the package directory tree. Moving the seedpack to a top-level directory would require a build-time copy step. Keeping it in place means:
- Zero build changes — `embed.go` works unchanged
- `stigmer apply` works from any directory (just `cd` to the seedpack)
- The project structure serves as the reference for customers

## Tasks

### 3.1 Add `stigmer.yaml` marker file

Create `backend/services/stigmer-server/pkg/seedpack/stigmer.yaml`:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: stigmer-seedpack
spec:
  description: >
    Default skills, agents, and MCP servers bootstrapped with every Stigmer server.
    This project serves as both the server's bootstrap content and a reference
    example for creating your own Stigmer projects.
```

No `entry_point` → declarative track.

### 3.2 Add missing regeneration script

Create `tools/06_draft-agent-creator-agent.sh` following the pattern of `05_draft-mcp-server-creator-agent.sh`. This script generates the `agents/agent-creator.yaml` using `stigmer draft agent`.

### 3.3 Create orchestration script

Create `tools/regenerate_all.sh` that runs all scripts in dependency order:

```
1. 01_vendor_skill.sh          → skills/skill-creator/
2. 02_draft-agent-creator-skill.sh    → skills/agent-creator/
3. 04_draft-mcp-server-creator-skill.sh → skills/mcp-server-creator/
4. 03_draft-skill-creator-agent.sh    → agents/skill-creator.yaml
5. 06_draft-agent-creator-agent.sh    → agents/agent-creator.yaml (NEW)
6. 05_draft-mcp-server-creator-agent.sh → agents/mcp-server-creator.yaml
7. stigmer apply (optional)           → registers all as project
```

### 3.4 Verify all scripts work

Run each tool script with the current CLI and verify output. Document any issues.

### 3.5 Test `stigmer apply` from seedpack directory

```bash
cd backend/services/stigmer-server/pkg/seedpack
stigmer apply
```

Expected output:
- 3 skills pushed (skill-creator, agent-creator, mcp-server-creator)
- 3 agents applied (skill-creator, agent-creator, mcp-server-creator)
- 1 MCP server applied (stigmer-mcp-server)
- Project "stigmer-seedpack" created with 7 members

## Dependencies

- T02 must be complete (skill directory scanning + subdirectory YAML scanning) — **DONE**
- `stigmer server start` must work and bootstrap successfully

## Files to Create/Modify

| Action | File |
|--------|------|
| CREATE | `seedpack/stigmer.yaml` |
| CREATE | `seedpack/tools/06_draft-agent-creator-agent.sh` |
| CREATE | `seedpack/tools/regenerate_all.sh` |
| VERIFY | All existing `seedpack/tools/*.sh` scripts |

## Success Criteria

- `stigmer apply` from seedpack directory succeeds
- All 7 resources appear in project membership
- `stigmer apply --prune` works (no unexpected deletions)
- All tool scripts execute without errors
