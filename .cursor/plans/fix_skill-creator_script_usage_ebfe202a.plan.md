---
name: Fix skill-creator script usage
overview: The skill-creator agent bypasses its bundled scripts (init_skill.py, package_skill.py) and manually writes all files because the path bridging between the vendored Anthropic SKILL.md, the AI-generated agent YAML, and the Stigmer runtime environment is fragmented and ambiguous. This plan identifies the five gaps in the pipeline and proposes both a targeted fix and an architectural improvement.
todos:
  - id: hand-write-agent-yaml
    content: Hand-write skill-creator.yaml spec.instructions with explicit execute-tool commands, $STIGMER_PLATFORM_DIR paths, and mandatory script usage
    status: completed
  - id: update-generation-script
    content: Update 03_draft-skill-creator-agent.sh prompt to include Stigmer runtime conventions (so regeneration doesn't regress)
    status: completed
  - id: enhance-prompt-section
    content: Enhance generate_prompt_section() in skill_writer.py with clearer script execution guidance and per-skill script listing
    status: completed
  - id: update-prompt-tests
    content: Update test_skill_writer.py tests to validate improved prompt section
    status: completed
  - id: verify-output-path
    content: Investigate how --output from CLI is propagated to agent context and ensure it's available for init_skill.py --path argument
    status: completed
isProject: false
---

# Fix Skill-Creator Agent to Use Bundled Scripts

## Diagnosis: Why the Agent Writes Files Manually

The screenshot shows the skill-creator agent producing all files via the `write` tool (references/agent-schema.md, validation-rules.md, examples.md, SKILL.md) without ever running `init_skill.py` to scaffold or `package_skill.py` to validate. The task list even says "(init_skill.py needs execution environment)" -- the agent **recognized** it should use the script but couldn't figure out how. Five gaps in the pipeline cause this.

### Gap 1: Agent YAML instructions use vague, unresolvable paths

`[skill-creator.yaml](seedpack/agents/skill-creator.yaml)` line 39:

```
Run `scripts/init_skill.py` to scaffold the directory, then populate it
```

This is a bare relative path. The agent has no idea where `scripts/` is. At runtime, the script lives at `$STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py`, but the agent instructions never mention `$STIGMER_PLATFORM_DIR`, the `execute` tool, or a concrete command.

### Gap 2: The vendored SKILL.md was designed for a different runtime

The [SKILL.md](seedpack/skills/skill-creator/SKILL.md) (vendored from [github.com/anthropics/skills](https://github.com/anthropics/skills)) says:

```
scripts/init_skill.py <skill-name> --path <output-directory>
```

This was written for Claude Desktop / Cursor, where relative paths "just work" because the skill directory is the working context. In Stigmer's agent-runner:

- Skills are extracted to `.stigmer/skills/{name}/` (managed by `SkillWriter`)
- Shell commands get `$STIGMER_PLATFORM_DIR` env var pointing to the platform mount root
- The agent must read files via `.stigmer/skills/{name}/...` but execute scripts via `$STIGMER_PLATFORM_DIR/skills/{name}/scripts/...`

The SKILL.md is unaware of this two-path convention. The system prompt (from `generate_prompt_section()`) mentions `$STIGMER_PLATFORM_DIR` but only as a generic one-liner buried in a "Workspace rule" paragraph:

```310:314:backend/services/agent-runner/worker/activities/graphton/skill_writer.py
"For shell execution of skill scripts, use "
"`$STIGMER_PLATFORM_DIR/skills/{name}/scripts/...`.",
```

### Gap 3: The agent YAML was AI-generated without runtime context

`[03_draft-skill-creator-agent.sh](seedpack/tools/03_draft-skill-creator-agent.sh)` generated the `skill-creator.yaml` by feeding the agent-creator agent the SKILL.md content and a sibling example. The generation prompt (lines 90-123) never mentioned:

- The `execute` tool or sandbox environment
- The `$STIGMER_PLATFORM_DIR` convention
- The `.stigmer/skills/` path layout
- How `--output` maps to the agent's working context

So the generated agent instructions just parroted the SKILL.md's relative paths.

### Gap 4: Output path is not explicitly passed to the agent

When `stigmer draft skill --output /path/to/skills` runs, the `--output` directory is where the CLI expects the result. But how does the agent know this path? It needs it as the `--path` argument for `init_skill.py`. If the agent doesn't know the output directory, it can't construct the scaffold command.

### Gap 5: No enforcement -- scripts are optional, not mandatory

Both `write` (manual file creation) and `execute` (running scripts) require approval. The agent can achieve the same result either way, and writing files directly is simpler for the model because it avoids path resolution entirely. There is no mechanism (guard, pre-hook, or post-validation) that ensures scripts are actually used.

---

## The Core Architectural Question

The vendored Anthropic skill-creator skill provides excellent *methodology* (what to do). The Stigmer platform provides the *runtime* (how to do it). The current gap is in the **bridge layer** -- nobody owns the translation from "run `scripts/init_skill.py`" to "`execute('python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py my-skill --path .')`".

This bridge layer should live in the **agent YAML instructions** (the `skill-creator.yaml`), not in the vendored SKILL.md (which we don't own) and not in the generic system prompt (which can't know skill-specific details).

---

## Solution: Two-Layer Fix

### Layer 1: Hand-Write Authoritative Agent Instructions (Targeted Fix)

The `skill-creator.yaml` is currently AI-generated and runtime-unaware. Replace its `spec.instructions` with hand-crafted instructions that:

- **Explicitly reference the `execute` tool** for running bundled scripts
- **Use `$STIGMER_PLATFORM_DIR*`* for all script execution commands
- **Use the skill Location path** (from system prompt) for all `read` operations
- **Provide copy-paste-ready commands** rather than vague "run X" guidance
- **Make script execution mandatory**, not optional ("MUST run" not "run")

Key changes to `[skill-creator.yaml](seedpack/agents/skill-creator.yaml)`:

- Step 3 (Generate) should say:

```
  Use the `execute` tool to scaffold:
  python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py <name> --path .
  

```

- Step 4 (Validate) should say:

```
  Use the `execute` tool to validate and package:
  python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/package_skill.py <path>
  

```

- The instructions should distinguish read paths (`.stigmer/skills/...`) from execute paths (`$STIGMER_PLATFORM_DIR/skills/...`)

### Layer 2: Strengthen the System Prompt Bridge (Systemic Fix)

Update `[generate_prompt_section()](backend/services/agent-runner/worker/activities/graphton/skill_writer.py)` to provide clearer script execution guidance:

- Replace the current generic one-liner with a dedicated "Executing Skill Scripts" subsection
- Include a concrete example showing the read-path vs execute-path distinction
- Per-skill, if the skill has a `scripts/` directory, list the available scripts by name

### Layer 3 (Future): Script-as-Tool Registration

This is a longer-term architectural improvement worth considering but not implementing now:

The `allowed-tools` frontmatter field in SKILL.md is already validated by `quick_validate.py` but unused by the runtime. A future enhancement could let skills declare their scripts as first-class tools:

```yaml
allowed-tools:
  - name: init_skill
    script: scripts/init_skill.py
    description: Scaffold a new skill directory
```

The agent-runner would register these as LangChain tools alongside the platform tools. This eliminates the path-resolution problem entirely -- the agent would call `init_skill(name="my-skill", path=".")` like any other tool.

This aligns with the "degrees of freedom" principle from the SKILL.md itself: scripts are low-freedom operations where consistency is critical. Making them tools removes the agent's ability to skip or misuse them.

---

## Answering "Does Anthropic Have Something We Can Just Use?"

**Yes, partially.** Anthropic provides the [skill-creator skill](https://github.com/anthropics/skills) (SKILL.md + init_skill.py + package_skill.py + quick_validate.py), which we already vendored. This is the methodology layer and it's solid.

Anthropic does **not** provide a skill-creator **agent**. An agent is the runtime wrapper that knows about the execution environment, available tools, and platform conventions. That's inherently platform-specific (Stigmer vs Cursor vs Claude Desktop). We must write this ourselves.

The current approach of AI-generating the agent YAML via `03_draft-skill-creator-agent.sh` is a reasonable bootstrap, but the output needs **human review and refinement** for runtime integration -- which is exactly what didn't happen, and why the agent can't find its scripts.

---

## What Changes Where

- `**[seedpack/agents/skill-creator.yaml](seedpack/agents/skill-creator.yaml)`** -- Hand-write `spec.instructions` with runtime-aware, concrete commands
- `**[seedpack/tools/03_draft-skill-creator-agent.sh](seedpack/tools/03_draft-skill-creator-agent.sh)`** -- Update the generation prompt to include runtime conventions (so future regeneration doesn't regress)
- `**[backend/services/agent-runner/worker/activities/graphton/skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py)`** -- Enhance `generate_prompt_section()` with clearer script execution guidance and per-skill script listing
- `**[backend/services/agent-runner/tests/test_skill_writer.py](backend/services/agent-runner/tests/test_skill_writer.py)**` -- Update tests to validate the improved prompt section

