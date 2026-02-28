---
name: T03 Seedpack as Project
overview: "Convert the seedpack into a proper Stigmer project by adding stigmer.yaml, fixing the missing regeneration script, and creating an orchestration script. However, a critical scanner gap must be resolved first: the declarative scanner cannot discover skills nested under a parent directory."
todos:
  - id: resolve-scanner-gap
    content: "Discuss and resolve the skill scanner gap: scanSkillDirectories only checks 1 level, seedpack needs 2 levels"
    status: pending
  - id: enhance-scanner
    content: Enhance scanSkillDirectories and scanResourceFiles to support nested skill directories (grandchildren)
    status: pending
  - id: scanner-tests
    content: Add tests for nested skill directory scanning in apply_declarative_test.go
    status: pending
  - id: create-stigmer-yaml
    content: Create stigmer.yaml in the seedpack directory
    status: pending
  - id: create-regen-script
    content: Create tools/06_draft-agent-creator-agent.sh following the pattern of 05
    status: pending
  - id: create-orchestration
    content: Create tools/regenerate_all.sh with dependency-ordered execution
    status: pending
  - id: run-tests
    content: Run seedpack tests and CLI tests to verify nothing is broken
    status: pending
isProject: false
---

# T03: Convert Seedpack into a Proper Stigmer Project

## Critical Architectural Gap (Must Resolve First)

The T02 skill scanner (`scanSkillDirectories`) only checks **immediate** subdirectories of the project root for `SKILL.md`. The seedpack organizes skills under a `skills/` parent directory:

```
seedpack/                       <-- project root (where stigmer.yaml will live)
├── skills/                     <-- NOT a skill dir (no SKILL.md here)
│   ├── agent-creator/SKILL.md  <-- 2 levels deep, NOT discovered
│   ├── mcp-server-creator/...  <-- NOT discovered
│   └── skill-creator/...       <-- NOT discovered
├── agents/                     <-- YAML scanning works (1 level) OK
└── mcp-servers/                <-- YAML scanning works (1 level) OK
```

Running `stigmer apply` from the seedpack will find 3 agents + 1 MCP server, but **zero skills**. The T03 plan expects 3 skills to be pushed.

### Options

- **Option A: Enhance scanner to check grandchild directories** -- When a subdirectory is not itself a skill dir, check its children for `SKILL.md`. This is a minimal, predictable extension of the existing one-level convention. Supports the organized `skills/` layout that larger projects (like the seedpack) naturally use.
- **Option B: Flatten seedpack structure** -- Move skill dirs to root level (`agent-creator/`, `mcp-server-creator/`, `skill-creator/` next to `agents/`). This avoids any scanner change but conflicts with the `embed.go` pattern (`//go:embed skills`) and the existing Go code. Would require restructuring `embed.go`, `seedpack.go`, `BUILD.bazel`, and all tests.
- **Option C: Make scanner fully recursive** -- Walk the entire directory tree. Most flexible but introduces risk of scanning unintended deep paths (e.g., `node_modules/`, `vendor/`, etc.).

**Recommendation**: Option A. Minimal change, predictable behavior, aligned with the existing one-level YAML scanning convention. The `scanResourceFiles` function also needs a corresponding update to exclude skill directories found at the grandchild level.

## Implementation Steps (after gap resolution)

### Step 1: Enhance `scanSkillDirectories` in `apply_declarative.go`

Modify [apply_declarative.go](client-apps/cli/cmd/stigmer/root/apply_declarative.go) so that when an immediate subdirectory is NOT a skill dir, it also checks that subdirectory's children for `SKILL.md`. Update `scanResourceFiles` to exclude these nested skill directories from YAML scanning.

Add corresponding tests in [apply_declarative_test.go](client-apps/cli/cmd/stigmer/root/apply_declarative_test.go).

### Step 2: Add `stigmer.yaml` marker file

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

This file is NOT embedded (embed.go only embeds `skills/`, `agents/`, `mcp-servers/`). It purely serves as the `stigmer apply` marker. No changes to `embed.go` or `BUILD.bazel` needed.

### Step 3: Add `tools/06_draft-agent-creator-agent.sh`

Create a new script following the exact pattern of [05_draft-mcp-server-creator-agent.sh](backend/services/stigmer-server/pkg/seedpack/tools/05_draft-mcp-server-creator-agent.sh):

- Attach Agent proto schemas
- Reference the `agent-creator` skill
- Output to `agents/agent-creator.yaml`
- Same dependency checks, error handling, and "next steps" output

### Step 4: Add `tools/regenerate_all.sh`

Orchestration script that runs all tool scripts in dependency order:

1. `01_vendor_skill.sh` -- vendor skill-creator from upstream
2. `02_draft-agent-creator-skill.sh` -- generate agent-creator skill
3. `04_draft-mcp-server-creator-skill.sh` -- generate mcp-server-creator skill
4. `03_draft-skill-creator-agent.sh` -- generate skill-creator agent
5. `06_draft-agent-creator-agent.sh` -- generate agent-creator agent (NEW)
6. `05_draft-mcp-server-creator-agent.sh` -- generate mcp-server-creator agent

Skills before agents (agents reference skills). The script should support `--dry-run` to show what would run and `--skip-vendor` to skip the vendoring step.

### Step 5: Run existing tests + verify

- Run `go test ./backend/services/stigmer-server/pkg/seedpack/ -v` -- existing seedpack tests should still pass (stigmer.yaml is not embedded)
- Run `go test ./client-apps/cli/cmd/stigmer/root/ -v` -- declarative apply tests with the scanner enhancement
- Verify `stigmer apply --dry-run` from the seedpack directory lists all 7 resources

## Files Changed


| Action | File                                                                                 | Reason                                |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------- |
| MODIFY | `client-apps/cli/cmd/stigmer/root/apply_declarative.go`                              | Enhance skill scanner for nested dirs |
| MODIFY | `client-apps/cli/cmd/stigmer/root/apply_declarative_test.go`                         | Tests for nested skill scanning       |
| CREATE | `backend/services/stigmer-server/pkg/seedpack/stigmer.yaml`                          | Project marker                        |
| CREATE | `backend/services/stigmer-server/pkg/seedpack/tools/06_draft-agent-creator-agent.sh` | Missing regen script                  |
| CREATE | `backend/services/stigmer-server/pkg/seedpack/tools/regenerate_all.sh`               | Orchestration                         |


## What Will NOT Change

- `embed.go` -- stigmer.yaml is outside the embed scope
- `seedpack.go` -- runtime discovery is independent of stigmer.yaml
- `BUILD.bazel` -- embedsrcs globs only match embedded dirs
- Existing seedpack tests -- stigmer.yaml doesn't affect embedded content

