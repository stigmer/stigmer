---
name: Phase 5 Workspace Prompt
overview: Inject a `## Workspace` section into the agent system prompt when workspace provisioning is active, using the existing `provision_result.workspace_description` string from the source handlers. Minimal, clean change (~15 lines production code) following the established skills/input-files injection pattern in execute_graphton.py.
todos:
  - id: inject-workspace-section
    content: Inject `## Workspace` section in execute_graphton.py prompt assembly (after instructions, before skills)
    status: completed
  - id: fix-stale-paths
    content: Update stale path references in prompt_enhancement.py FILESYSTEM_CAPABILITY (`bin/skills/` -> `.stigmer/skills/`, `inputs/` -> `.stigmer/inputs/`)
    status: completed
  - id: add-tests
    content: Add tests for workspace section injection (git_repo, local_path, empty, None, ordering)
    status: completed
isProject: false
---

# Phase 5: Workspace Awareness in System Prompt

## Domain Analysis

### What exists today

All three workspace source handlers already generate well-crafted `workspace_description` strings:

- **git.py** `_build_description()` ([git.py](backend/services/agent-runner/worker/workspace/sources/git.py) L424-432): repo URL, branch, short SHA, exploration guidance, artifact notice
- **local_path.py** ([local_path.py](backend/services/agent-runner/worker/workspace/sources/local_path.py) L72-77): path, "operating directly on user's files" warning, git guidance
- **empty.py** ([empty.py](backend/services/agent-runner/worker/workspace/sources/empty.py) L26-29): "workspace is empty, create as needed"

`provision_result` is available in [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) at L1172 after provisioning. The `workspace_description` field exists but is never used in prompt assembly.

### What needs to change

The prompt assembly block (L1652-1699) currently builds:

```
instructions -> skills -> input files -> response rules -> delegation rules
```

We inject a `## Workspace` section between instructions and skills:

```
instructions -> WORKSPACE -> skills -> input files -> response rules -> delegation rules
```

This ordering is intentional: WHERE you work (workspace) before HOW you work (skills) before WHAT data you have (input files) before behavioral rules.

### Architectural decisions

- **No changes to graphton's `prompt_enhancement.py`**: Workspace context is session-specific state, not a generic agent capability. It follows the same injection pattern as skills and input files (both built in `execute_graphton.py`). Confirmed with user above.
- **Only injected when provisioning is active**: When `provision_result` is None (feature flag off or no workspace_source), no workspace section is added. Backward compatible.
- **Subagent workspace awareness deferred**: Sub-agents (via `subagent_transformer.py`) don't receive `provision_result` today. Threading it through adds complexity for marginal benefit. Can be a separate follow-up.

### Stale path reference cleanup (Phase 4 miss)

`prompt_enhancement.py` `FILESYSTEM_CAPABILITY` constant (L82-96) references outdated paths:

```python
# Current (stale):
"File paths should be workspace-relative (e.g., `inputs/data.txt`,
`bin/skills/my-skill/SKILL.md`)."

# Should be:
"File paths should be workspace-relative (e.g., `.stigmer/inputs/data.txt`,
`.stigmer/skills/my-skill/SKILL.md`)."
```

This is a Phase 4 miss that should be fixed now to avoid contradictory guidance in the system prompt.

---

## Implementation

### 1. Inject workspace section in execute_graphton.py

**File**: [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) ~L1652

Insert after `enhanced_system_prompt = instructions` and **before** the skills section:

```python
if provision_result and provision_result.workspace_description:
    enhanced_system_prompt += (
        "\n\n## Workspace\n\n"
        + provision_result.workspace_description
    )
    activity_logger.info("Enhanced system prompt with workspace context")
```

This is 5 lines of production code. It follows the exact pattern of the skills and input files injection that immediately follows it.

### 2. Fix stale FILESYSTEM_CAPABILITY paths in prompt_enhancement.py

**File**: [prompt_enhancement.py](backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py) L89-91

Update the example paths from `inputs/data.txt` and `bin/skills/my-skill/SKILL.md` to `.stigmer/inputs/data.txt` and `.stigmer/skills/my-skill/SKILL.md`.

### 3. Tests

Add tests verifying:

- Workspace section injected for git_repo source (contains repo URL, branch, commit)
- Workspace section injected for local_path source (contains path, "direct" warning)
- Workspace section injected for empty source
- Workspace section NOT injected when `provision_result` is None
- Section appears in correct position (after instructions, before skills)
- Existing behavior unchanged when provisioning is disabled

Test location depends on existing test structure -- likely in the same test file that covers prompt assembly in execute_graphton tests.

---

## What this does NOT include (explicit scoping)

- No changes to graphton library beyond the path reference fix
- No subagent workspace awareness (future)
- No changes to workspace_description content (the strings in git.py, local_path.py, empty.py are already well-crafted)
- No changes to provisioning logic, proto, or backend layer
- No new files created

