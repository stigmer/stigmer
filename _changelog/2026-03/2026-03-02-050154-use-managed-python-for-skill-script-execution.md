# Use Platform-Managed Python for Skill Script Execution

**Date**: March 2, 2026

## Summary

Skill scripts (e.g. `package_skill.py`, `quick_validate.py`) executed via the `execute` tool in local mode now resolve `python3` to the agent-runner's managed venv Python instead of the host's system Python. This eliminates runtime `ModuleNotFoundError` failures and the agent's subsequent scramble to install missing packages like PyYAML.

## Problem Statement

When the skill-creator agent ran `package_skill.py` during skill creation, the `execute` tool used `subprocess.run(shell=True)` with the host's unmodified PATH. If the host Python lacked PyYAML (which `quick_validate.py` imports), the agent would fail and then attempt recovery through `pip`, `pip3`, and eventually creating a temporary venv — a sequence that was confusing, slow, and unreliable (modern systems reject `pip install` outside a venv with `externally-managed-environment` errors).

### Pain Points

- Every user creating a skill hit this dependency resolution sequence
- The agent wasted multiple tool calls trying different installation methods
- `externally-managed-environment` errors on modern macOS/Linux made `pip install` fail entirely
- The agent-runner's own venv already had PyYAML installed — the package was present but inaccessible

## Solution

Prepend the agent-runner's managed Python directory to `PATH` in the subprocess environment constructed by `FilesystemBackend.execute()`. Since the CLI starts the agent-runner using the venv's Python by absolute path (never adding `bin/` to PATH), the subprocess PATH still pointed to the host Python. The fix connects existing plumbing — no new packages or infrastructure required.

## Implementation Details

**Single file changed**: `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`

- Added `import sys` to module imports
- In `execute()`, after building `env` from `os.environ`, compute `Path(sys.executable).parent` (the venv's `bin/` directory) and prepend it to `PATH` if not already present
- The prepend is idempotent and placed before `env.update(self._env_vars)` so explicit agent `env_spec` overrides take precedence

## Benefits

- Skill scripts work immediately without dependency installation attempts
- Zero wasted tool calls during skill creation
- Consistent Python environment between the agent-runner process and its subprocesses
- No changes to vendored Anthropic skill-creator scripts required

## Impact

- **Local mode only**: `FilesystemBackend` is used exclusively in local mode. Sandbox (Docker) and cloud (Daytona) execution paths are unaffected — they already have PyYAML in their environments.
- **All skill scripts**: Any skill script invoked via `execute` now benefits from the agent-runner's installed packages, not just the skill-creator scripts.

## Related Work

- Agent-runner venv management: `client-apps/cli/internal/cli/pythonrt/`
- Sandbox requirements: `backend/services/agent-runner/sandbox/requirements.txt`
- Execute tool approval UX improvements (recent work on the same branch)

---

**Status**: ✅ Production Ready
