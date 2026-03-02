---
name: Fix skill-creator output path
overview: Remove the hardcoded workspace-root output path from the skill-creator agent and replace it with a declared, overridable OUTPUT_DIR environment variable using the platform's existing env_spec mechanism.
todos:
  - id: env-spec
    content: Add `env_spec` with `OUTPUT_DIR` (default `.`) to `skill-creator.yaml`
    status: completed
  - id: update-instructions
    content: "Update `skill-creator.yaml` instructions: replace hardcoded `.` with `$OUTPUT_DIR` in scaffold, package, and path convention text"
    status: completed
  - id: update-script
    content: Add `--env OUTPUT_DIR=${SKILLS_DIR}` to the `stigmer draft skill` invocation in `02_draft-agent-creator-skill.sh`
    status: completed
  - id: cleanup
    content: Remove stale `agent-creator/` directory from repo root
    status: completed
isProject: false
---

# Fix Skill-Creator Output Path via `env_spec`

## Domain Analysis

### The Critique

The `skill-creator` agent has a **separation of concerns violation**: a platform-provided, reusable agent hardcodes a runtime concern (output directory) into its static instructions in two places:

1. **Line 34 of `[skill-creator.yaml](seedpack/agents/skill-creator.yaml)`**: `"New skill files you create go in the workspace root (e.g., ./my-skill/), NOT inside .stigmer/skills/."`
2. **Line 58**: The scaffold command hardcodes `--path .`

This creates three problems:

- **Rigid coupling** -- The agent cannot be used in any context that needs output somewhere other than workspace root
- **Broken `--output` semantics** -- The CLI's `--output` flag exists to control output location, but the agent ignores it. `--output` only controls *post-execution artifact download*, not where the agent writes. These are disconnected: the agent always writes to workspace root regardless of what `--output` says.
- **Instruction pollution** -- The "Runtime Path Conventions" section mixes three unrelated concerns: reading bundled skill files, executing bundled scripts, and output location. The first two are legitimate agent-level concerns; the third is a runtime parameter.

### The Fix

Use the platform's existing `env_spec` mechanism to make the output directory a declared, overridable runtime parameter. This approach:

- Uses **existing infrastructure** -- `env_spec` is already in the Agent proto; `--env` is already registered on all draft commands via `agentExecFlags`
- Is **declarative** -- the contract is visible in the agent YAML, not hidden in prose instructions
- Follows **the platform's own convention** for configurable runtime behavior (same mechanism MCP servers use for credentials)
- Keeps the **default experience unchanged** -- interactive users who omit `--env` get `.` (workspace root), which is the intuitive default

### Why NOT auto-inject `--output` into `OUTPUT_DIR` at the CLI level

I considered having `executeDraft()` auto-inject `OUTPUT_DIR` from the `--output` flag so the user wouldn't need `--env`. I'm **recommending against this** because:

- `--output` means "where to **download** artifacts locally after execution"
- `OUTPUT_DIR` means "where the agent should **write** files in the workspace"
- For **local workspaces** these happen to align (same filesystem), but for **remote/git workspaces** they are fundamentally different contexts -- the agent's workspace is provisioned on the server, while `--output` is a local path
- Silently coupling these two concepts would create a subtle, hard-to-debug mismatch for remote workspaces

The explicit `--env OUTPUT_DIR=path` approach is correct and honest about the distinction.

---

## Changes

### 1. `[seedpack/agents/skill-creator.yaml](seedpack/agents/skill-creator.yaml)` -- Declare `OUTPUT_DIR` in `env_spec`

Add `env_spec` to the agent spec:

```yaml
  env_spec:
    description: Runtime configuration for skill creation
    data:
      OUTPUT_DIR:
        value: "."
        description: >-
          Directory where the generated skill will be created.
          Relative paths are resolved from the workspace root.
          Defaults to the workspace root.
```

### 2. `[seedpack/agents/skill-creator.yaml](seedpack/agents/skill-creator.yaml)` -- Update instructions to reference `$OUTPUT_DIR`

Replace the hardcoded workspace-root instruction (lines 34-35):

**Before:**

```
New skill files you create go in the workspace root (e.g., `./my-skill/`),
NOT inside `.stigmer/skills/`.
```

**After:**

```
New skill files you create go in the directory specified by `$OUTPUT_DIR`
(defaults to the workspace root `.` when not overridden at runtime).
```

Replace the hardcoded `--path .` in the scaffold command (line 58):

**Before:**

```
python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py <skill-name> --path .
```

**After:**

```
python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py <skill-name> --path $OUTPUT_DIR
```

Replace the hardcoded `./<skill-name>` in the package command (line 80):

**Before:**

```
python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/package_skill.py ./<skill-name>
```

**After:**

```
python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/package_skill.py $OUTPUT_DIR/<skill-name>
```

### 3. `[seedpack/tools/02_draft-agent-creator-skill.sh](seedpack/tools/02_draft-agent-creator-skill.sh)` -- Pass `OUTPUT_DIR` via `--env`

Add `--env "OUTPUT_DIR=${SKILLS_DIR}"` to the `stigmer draft skill` invocation (line 146-154). The `--env` flag is already available on draft commands via the shared `agentExecFlags` registered through `registerAgentExecFlags` in `[run_agent_exec.go](client-apps/cli/cmd/stigmer/root/run_agent_exec.go)`.

### 4. Clean up stale files

The `agent-creator/` directory at the repo root (visible in `git status` as untracked) was created by a previous run that wrote to workspace root. These should be removed:

- `agent-creator/SKILL.md`
- `agent-creator/assets/example_asset.txt`
- `agent-creator/references/api_reference.md`
- `agent-creator/scripts/example.py`

---

## Scope Boundaries

- **In scope**: `skill-creator.yaml` and the draft script that triggered this issue
- **Out of scope (but noted for consistency)**: `agent-creator.yaml` and `mcp-server-creator.yaml` don't have this issue explicitly (no hardcoded path instructions), but if they need `OUTPUT_DIR` in the future, the same `env_spec` pattern applies
- **Out of scope**: CLI-level auto-injection of `--output` into `OUTPUT_DIR` -- intentionally deferred as explained above

