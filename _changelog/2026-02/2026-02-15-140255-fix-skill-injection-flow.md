# Fix Skill Injection Flow: Agent Not Finding Skill Files

**Date**: February 15, 2026

## Summary

Fixed three interconnected issues in the skill injection pipeline that prevented agents from reliably accessing skill files. The agent would list a directory and see files, but then fail to read those same files. The root causes were: (1) a ZIP structure bug in the agent-bundled packager creating nested directories, (2) unclear prompt injection that didn't guide the agent to use provided LOCATION paths, and (3) poor error messages that made debugging path mismatches difficult.

## Problem Statement

An agent execution showed a critical failure mode where the agent could successfully list files in a skill directory (`ls /bin/skills/{hash}/scripts` showed `init_skill.py`) but immediately failed when trying to read that same file (`read /bin/skills/{hash}/scripts/init_skill.py` returned "not found"). This revealed fundamental issues in how skills are packaged, extracted, injected into prompts, and accessed by agents.

### Pain Points

- **Agent confusion**: Despite skill LOCATION being injected into the system prompt, the agent would manually explore the filesystem (`ls /`, `ls /bin`, `ls /bin/skills`) to discover skill locations rather than using the provided paths
- **List-then-read mismatch**: Files visible via `list_files()` were not readable via `read_file()` at the same path
- **Opaque errors**: When file reads failed, error messages gave no diagnostic information about what paths were resolved or what the directory actually contained
- **ZIP format inconsistency**: Three different tools created skills ZIPs in three different formats, with the agent-bundled `package_skill.py` creating a subtly broken nested structure

## Solution

### 1. Fixed ZIP Structure Bug

The `package_skill.py` script bundled inside the `skill-creator` skill had a bug on line 73:
```python
arcname = file_path.relative_to(skill_path.parent)  # Wrong!
```

This created ZIP entries relative to the skill's parent directory, resulting in a nested structure:
```
my-skill/SKILL.md         # Wrong - extra directory level
my-skill/scripts/init.py
```

Instead of the expected flat structure:
```
SKILL.md                  # Correct
scripts/init.py
```

**Fix**: Changed to `file_path.relative_to(skill_path)` to align with the CLI push (`artifact/skill.go`) and vendor script (`vendor_skill.sh`) formats.

### 2. Restructured Prompt Injection

The LOCATION header was buried inside large SKILL.md content (~358 lines for skill-creator) and treated as reference material rather than actionable instructions.

**Changes to `skill_writer.py:generate_prompt_section()`**:
- Added explicit preamble: "Use that path directly. Do NOT explore the filesystem to discover skill files."
- Single skill: Quick-reference block with inline command examples
- Multiple skills: Summary table of all skill directories
- Wrapped LOCATION paths in backticks for visual prominence
- Moved access instructions before the SKILL.md body content

### 3. Added Defensive Path Handling

`FilesystemBackend.read_file()` and `list_files()` now provide actionable diagnostics:

**Before**:
```
FileNotFoundError: [Errno 2] No such file or directory: '/workspace/bin/skills/.../init.py'
```

**After**:
```
FileNotFoundError: File not found: '/bin/skills/.../scripts/init.py' 
(resolved to '/workspace/bin/skills/.../scripts/init.py'). 
Parent directory 'scripts/' contains: ['helper.py', 'package.py']
```

Also added `IsADirectoryError` when trying to read a directory, and `NotADirectoryError` when trying to list a file.

### 4. Comprehensive End-to-End Tests

Added `TestZipFormatEndToEnd` test class with 7 tests covering:
- Flat ZIP format (CLI/vendor) → extract → list → read consistency
- Dot-prefix ZIP format (`./SKILL.md` entries)
- Nested ZIP format (documenting the pathological behavior)
- Script executability after extraction
- Diagnostic error message verification
- Clear error types for mismatched operations (read dir, list file)

## Implementation Details

### Files Changed

**Core fixes**:
- `backend/libs/go/seedpack/skills/skill-creator/scripts/package_skill.py`: Fixed ZIP arcname calculation
- `backend/services/agent-runner/worker/activities/graphton/skill_writer.py`: Restructured prompt with explicit LOCATION guidance
- `backend/libs/python/graphton/src/graphton/core/backends/filesystem.py`: Added diagnostic logging and clear error messages

**Test updates**:
- `backend/services/agent-runner/tests/test_skill_writer.py`: Updated 4 assertions for backtick-wrapped LOCATION format
- `backend/services/agent-runner/tests/test_integration_skill_pipeline.py`: Added 7 e2e tests + fixed 7 pre-existing path assertion failures

### Key Design Decisions

1. **ZIP format standardization**: All three packaging paths (CLI, vendor script, agent packager) now produce identical flat ZIP structures
2. **Prompt-first guidance**: The system prompt now actively teaches the agent how to access skills rather than assuming the agent will figure it out
3. **Defensive programming**: Path resolution failures now provide enough diagnostic information to understand the mismatch without needing to SSH into a container
4. **Test coverage**: End-to-end tests ensure that every file the agent can *list* is also *readable* at that path

### Test Results

All 56 tests pass:
- 28 existing tests (updated for new prompt format)
- 7 new e2e tests (ZIP format consistency)
- 21 existing tests (unchanged)

## Benefits

### Developer Experience
- **Faster debugging**: Clear error messages with resolved paths and directory contents eliminate guesswork
- **Test confidence**: E2e tests catch ZIP format regressions before they reach production
- **Consistent tooling**: All three skill packaging paths produce identical artifacts

### Agent Reliability
- **No more exploration**: Agents use provided LOCATION paths directly instead of filesystem discovery
- **Reliable file access**: List-then-read operations work consistently
- **Clear feedback**: When paths don't match, error messages guide the agent to the correct path

### Maintainability
- **Single source of truth**: ZIP format is now consistent across all tools
- **Defensive layer**: Path resolution catches mistakes early with actionable diagnostics
- **Test documentation**: The nested-ZIP test documents the pathological case so regressions are immediately visible

## Impact

### Users
- Agents can now reliably use skills with bundled scripts and references
- Skill creators (both humans and agents) produce correctly structured artifacts

### System
- Reduced agent execution failures from skill file access errors
- Clearer error paths when path mismatches do occur
- Foundation for more complex skills with multiple script files

### Codebase
- Tests now cover the full ZIP → extract → list → read pipeline
- Error handling provides diagnostic information for debugging
- Prompt engineering explicitly guides agent behavior

## Related Work

This fix addresses the root causes identified in the investigation captured in the plan file (`fix_skill_injection_flow_1739be77.plan.md`). The three issues discovered during investigation:

1. **Issue 1**: Agent manually exploring filesystem → Fixed via prompt restructuring
2. **Issue 2**: List shows file but read fails → Fixed via ZIP format bug + defensive errors
3. **Issue 3**: Hash folder names are opaque → Mitigated via clear LOCATION communication

## Future Improvements

Potential follow-ups:
- **Path normalization**: Add automatic normalization for paths with double-slashes or trailing slashes
- **Skill artifact validation**: Add a pre-flight check when skills are pushed to validate ZIP structure
- **Agent feedback loop**: Monitor agent skill access patterns to detect when agents still explore instead of using LOCATION

---

**Status**: ✅ Production Ready  
**Test Coverage**: 56 tests passing  
**Files Changed**: 5 core files + 2 test files  
**Lines Changed**: +475/-35
