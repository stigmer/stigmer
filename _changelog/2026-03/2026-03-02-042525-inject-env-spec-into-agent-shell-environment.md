# Inject `env_spec` Variables into Agent Shell Environment

**Date**: March 2, 2026

## Summary

Fixed two compounding bugs that prevented agent-declared environment variables (`env_spec`) and CLI-provided `--env` overrides from reaching the shell environment used by the `execute` tool. The `skill-creator` agent's `$OUTPUT_DIR` was always empty at runtime because the legacy env merge was gated behind an unrelated condition and the merged variables were never injected into the subprocess.

## Problem Statement

The `skill-creator` agent declares `OUTPUT_DIR` with a default of `"."` in its `env_spec`, and its instructions tell the LLM to run `python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py <name> --path $OUTPUT_DIR`. At runtime, `$OUTPUT_DIR` expanded to empty string, causing exit code 1 and forcing the agent to debug itself before eventually hardcoding `--path .`.

### Pain Points

- `$OUTPUT_DIR` was empty in every `execute` tool call despite being declared in the agent YAML with a default value
- Even explicit CLI `--env OUTPUT_DIR=foo` overrides were silently dropped
- The agent wasted context and user time debugging an infrastructure failure it could not fix
- The existing `env_spec` mechanism appeared functional (display/approval paths resolved correctly) but had no effect on actual command execution

## Solution

Two independent bugs were fixed:

1. **Legacy merge restructured**: The `env_spec` defaults (Layer 1) and `runtime_env` CLI overrides (Layer 3) were nested inside an `if environment_refs:` guard in `execute_graphton.py`. Since `skill-creator` has no `environment_refs`, the entire merge block was skipped. The fix pulls Layers 1 and 3 out of that guard so they always apply, while `environment_refs` resolution remains correctly gated.

2. **Shell environment injection**: `merged_env_vars` was consumed for display humanization, MCP config placeholders, and workspace provisioning credentials — but never passed to the backend that runs shell commands. The fix threads `env_vars` through `sandbox_config` into backend constructors, following the exact pattern `platform_dir` / `STIGMER_PLATFORM_DIR` already uses.

## Implementation Details

### `execute_graphton.py` — Legacy merge restructure (lines ~1249-1290)

The three-layer merge is now unconditional:

- **Layer 1** (agent `env_spec` defaults): Always applied as the base layer
- **Layer 2** (`environment_refs`): Only fetched/merged when the agent instance has refs
- **Layer 3** (`runtime_env` CLI overrides): Always applied as highest priority

Also fixed: the post-provisioning sandbox config injection adds `env_vars` to `sandbox_config_for_agent` after credential stripping, so consumed keys like `GITHUB_TOKEN` never reach the backend.

### `sandbox_factory.py` — Config threading

Reads `env_vars` from the config dict and passes to both `FilesystemBackend` and `create_daytona_backend()`.

### `filesystem.py` — Subprocess env injection

Accepts `env_vars` in the constructor and merges into the `subprocess.run(env=...)` dict. Layering: `os.environ` < `env_vars` < `STIGMER_PLATFORM_DIR` (platform dir always wins).

### `daytona.py` — Remote sandbox env injection

Accepts `env_vars` on `WorkspaceNormalizingBackend` and prefixes each `execute()` command with `export KEY=VALUE` statements (using `shlex.quote` for shell safety). The Daytona SDK's inner backend does not expose a native env parameter, so command prefixing is the pragmatic approach.

## Benefits

- Agent `env_spec` defaults now work as declared — `$OUTPUT_DIR` resolves to `"."` without any workarounds
- CLI `--env` overrides actually reach the shell — `stigmer draft skill --env OUTPUT_DIR=/custom/path` works
- Follows the established `platform_dir` pattern — no new abstractions, consistent with existing architecture
- Sub-agents automatically inherit parent env vars through the existing `sandbox_config` plumbing

## Impact

- **Agents**: Any agent with `env_spec` variables now has those variables available in `execute` tool calls
- **CLI users**: `--env` flag now functions as documented for shell execution, not just MCP config and display
- **skill-creator**: The immediate trigger — scaffolding and packaging commands work without agent self-debugging

## Related Work

- `2026-03-02-033559` — Added `env_spec` to `skill-creator.yaml` and updated instructions to use `$OUTPUT_DIR` (the YAML-side of this fix)
- `2026-03-02-034718` — Humanize platform paths in approval display (the display-side env var resolution)
- `2026-03-02-032821` — Execute tool approval UX improvements

---

**Status**: Production Ready
