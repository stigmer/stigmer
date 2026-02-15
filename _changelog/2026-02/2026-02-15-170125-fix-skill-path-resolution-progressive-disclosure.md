# Fix Skill Path Resolution and Implement Agent Skills Specification

**Date**: February 15, 2026

## Summary

Fixed the critical skill location resolution bug where agents could not find skill files on the first attempt, requiring extensive filesystem exploration. Simultaneously migrated from full SKILL.md injection to the Agent Skills specification's progressive disclosure model, reducing context window usage by ~300+ lines per skill while improving path reliability through workspace-root path normalization.

## Problem Statement

The agent execution flow had a fundamental path mismatch bug: skills were written to `/workspace/bin/skills/{hash}/` but the agent constructed paths like `/workspace/bin/skills/{hash}/scripts/init_skill.py` which the external `DaytonaBackend` incorrectly resolved to `/workspace/workspace/bin/skills/...` (double-prefix), causing "File not found" errors. This forced agents to perform 15+ exploratory tool calls to locate skills, wasting tokens and time.

Additionally, the system was injecting full SKILL.md content (358+ lines for skill-creator) into every agent's system prompt, consuming significant context window space unnecessarily.

### Pain Points

- **Double-prefix path bug**: `DaytonaBackend` from external `deepagents_cli` library didn't handle workspace-root-prefixed paths like the internal `FilesystemBackend` did
- **Expensive skill discovery**: Agents wasted ~15 tool calls exploring the filesystem to find skills
- **Context window bloat**: Full SKILL.md injection consumed 300+ lines per skill in the prompt
- **Opaque directory names**: 64-character version hashes made paths unmemorable for LLMs
- **Counterproductive prompt guidance**: Telling the agent "Do NOT prefix paths with `/workspace/`" introduced the concept and primed the LLM to use it
- **Spec non-compliance**: Full content injection violated the Agent Skills specification's progressive disclosure model

## Solution

Implemented a three-pronged solution:

1. **Path Normalization Layer**: Created `WorkspaceNormalizingBackend` wrapper that strips workspace-root prefixes (e.g. `/workspace/`) from all path arguments before delegating to the external `DaytonaBackend`, preventing double-prefix resolution errors.

2. **Progressive Disclosure**: Rewrote `generate_prompt_section()` to inject only skill metadata (name + description + location) at startup per the Agent Skills specification, with agents reading SKILL.md on demand when activating a skill.

3. **Human-Readable Paths**: Changed skill directories from `bin/skills/{64-char-hash}/` to `bin/skills/{name}/` (e.g. `bin/skills/skill-creator/`), making paths meaningful to both humans and LLMs.

## Implementation Details

### 1. WorkspaceNormalizingBackend Wrapper

**File**: `backend/libs/python/graphton/src/graphton/core/backends/daytona.py`

Created a transparent wrapper that normalizes paths before delegating:

```python
class WorkspaceNormalizingBackend:
    """Strips workspace-root prefixes from paths.
    
    Prevents double-prefix bug where agent provides /workspace/foo
    and backend resolves it to /workspace/workspace/foo.
    """
    def _normalize(self, path: str) -> str:
        if path.startswith(self._workspace_root + "/"):
            return path[len(self._workspace_root) + 1:]
        if path == self._workspace_root:
            return "."
        return path
    
    def read(self, path: str) -> str:
        return self._inner.read(self._normalize(path))
    # ... similar for write, list_files, etc.
```

Integrated into factory:

```python
def create_daytona_backend(config: dict[str, Any]) -> BackendProtocol:
    # ... create sandbox ...
    workspace_root = sandbox.get_work_dir().rstrip("/")
    inner = DaytonaBackend(sandbox)
    return WorkspaceNormalizingBackend(inner, workspace_root)
```

**Impact**: Works transparently whether agent uses relative paths (`bin/skills/...`) or absolute workspace-prefixed paths (`/workspace/bin/skills/...`). The external `DaytonaBackend` now receives only relative paths.

### 2. Progressive Disclosure Prompt Rewrite

**File**: `backend/services/agent-runner/worker/activities/graphton/skill_writer.py`

**Before** (full injection, ~358 lines for skill-creator):
```markdown
### SKILL: skill-creator
LOCATION: `bin/skills/{hash}/`

# Skill Creator

[... full 350+ line SKILL.md body ...]
```

**After** (metadata only, ~4 lines):
```markdown
### skill-creator
**Description**: Guide for creating effective skills...
**Location**: `bin/skills/skill-creator/`
**Activate**: `read bin/skills/skill-creator/SKILL.md`
```

The agent now:
1. Sees available skills with descriptions at startup (~100 tokens/skill)
2. Reads SKILL.md when it decides to activate a skill
3. Loads scripts/references only when needed

### 3. Human-Readable Directory Names

Replaced:
```python
def _resolve_version_hash(skill: Skill) -> str:
    return skill.status.version_hash or slug_fallback
```

With:
```python
def _resolve_skill_dir_name(skill: Skill) -> str:
    """Prefer metadata.name, fallback to version_hash, then slug."""
    if skill.metadata.name:
        return skill.metadata.name
    if skill.status.version_hash:
        return skill.status.version_hash
    return skill.metadata.slug.replace("/", "_")
```

Result: `bin/skills/skill-creator/` instead of `bin/skills/a34ed6ddb7e2.../`

### 4. Cleaned Prompt Guidance

**File**: `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py`

**Before**:
> "Do NOT prefix paths with `/workspace/` -- the tools handle path resolution automatically."

**After**:
> "Use the paths exactly as shown in the Available Skills and Input Files sections."

Removed mention of `/workspace` entirely, preventing LLM priming.

## Benefits

### 1. Reliability
- **Zero failed lookups**: Path normalization ensures correct resolution regardless of agent path construction
- **No exploratory tool calls**: Agents find skills immediately on first read
- **Spec-compliant**: Follows Agent Skills specification's progressive disclosure model

### 2. Performance
- **Context window savings**: ~300+ lines saved per skill (358 → ~4 lines)
- **Faster skill activation**: Agents load SKILL.md only when needed
- **Reduced token costs**: Less prompt content = lower inference costs

### 3. Maintainability
- **Cleaner logs**: Human-readable paths (`skill-creator` vs 64-char hashes)
- **Easier debugging**: Clear directory names, less filesystem exploration in logs
- **Self-documenting paths**: `bin/skills/skill-creator/SKILL.md` is immediately understandable

### 4. Developer Experience
- **Transparent fix**: `WorkspaceNormalizingBackend` wraps external library without modification
- **Backward compatible**: Falls back to version_hash if metadata.name is missing
- **Comprehensive tests**: 15 new tests for path normalization, full test suite updated

## Impact

### Affected Components
- **Graphton Core** (`backend/libs/python/graphton/`):
  - `backends/daytona.py`: Added `WorkspaceNormalizingBackend`
  - `prompt_enhancement.py`: Updated `FILESYSTEM_CAPABILITY` text
  - New test file: `tests/core/test_daytona_backend.py` (15 tests)

- **Agent Runner** (`backend/services/agent-runner/`):
  - `worker/activities/execute_graphton.py`: Updated skill injection comment
  - `worker/activities/graphton/skill_writer.py`: Rewrote `generate_prompt_section()`, renamed `_resolve_version_hash()` to `_resolve_skill_dir_name()`
  - `tests/conftest.py`: Added `spec.description` and `mock_skill_no_name` fixture
  - `tests/test_skill_writer.py`: 31 test updates for name-based paths and progressive disclosure
  - `tests/test_integration_skill_pipeline.py`: 8 test updates including renamed `TestSpecCompliance` class

### Files Changed
10 files modified, 1 new test file created:
- **+214 insertions, -276 deletions** (net -62 lines, but adds significant functionality)
- **15 new tests** for `WorkspaceNormalizingBackend`
- **46 test assertions updated** for new behavior

### User Impact
- **Agents**: Faster skill access, no more exploratory tool calls, smaller prompts
- **Platform**: Reduced token costs, cleaner execution logs
- **Developers**: Easier debugging with human-readable paths

## Related Work

### Historical Context
This builds on [2026-02-15 skill injection path mismatch fix](2026-02-15-154629-fix-skill-injection-path-mismatch.md) which made `SkillWriter` workspace-root-aware and used workspace-relative paths. That fix resolved the write-side mismatch but left the read-side vulnerability (external `DaytonaBackend` double-prefixing).

### Architecture Pattern
The `WorkspaceNormalizingBackend` wrapper follows the same pattern as `FilesystemBackend._resolve_sandbox_path()` but applies it at the backend interface boundary, making it reusable for any backend that doesn't handle workspace-root prefixes correctly.

### Specification Compliance
Aligns with:
- [Agent Skills Specification](https://agentskills.io/specification) - Progressive disclosure model
- Conventional skill directory structure: `bin/skills/{name}/SKILL.md`
- Workspace-relative path conventions

## Testing

### Coverage Added
- **15 new tests** for `WorkspaceNormalizingBackend`:
  - Path normalization edge cases (empty, dot, partial matches, custom roots)
  - File operation delegation (read, write, list_files)
  - Transparent attribute forwarding (`__getattr__`)
- **46 test assertions updated** across unit and integration tests
- All tests passing with no linter errors

### Validation
- Path normalization verified for all edge cases
- Progressive disclosure prompt format validated
- Name-based directory resolution tested with full fallback chain
- End-to-end workflow confirmed: write → read → execute

---

**Status**: ✅ Production Ready
**Timeline**: Implemented in single session (~4 hours)
