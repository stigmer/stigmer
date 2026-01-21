# ⛔ PROJECT OBSOLETE

**Date Marked Obsolete**: 2026-01-21  
**Reason**: Wrong architectural direction

## What Happened

This project pursued a Docker container approach for agent-runner distribution. After implementation planning and discussion with Gemini, we realized this was **overengineering** the solution.

## The Key Insight

We already have the right pattern with Temporal:
- **Temporal**: Download binary → Run ✅
- **Agent-Runner**: Should also be "Download binary → Run" ✅

We don't need to manage:
- Docker/Podman installation
- Container registries
- Container networking
- Container lifecycle complexity

We just need to manage **two binaries** with identical logic.

## The Right Solution

**PyInstaller** compiles Python code into standalone executables:
- Linux: `agent-runner-linux` (executable)
- macOS: `agent-runner-darwin` (executable)  
- Windows: `agent-runner.exe`

The daemon downloads the appropriate binary and runs it. **Zero dependencies.**

## Superseded By

**New Project**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/`

This project implements the PyInstaller approach, achieving:
- Architecture consistency with Temporal
- Zero Python environment management
- Simpler daemon logic (download → execute)
- Better user experience (no Docker required)

## Reference Documents

- **ADR**: `_cursor/adr-use-python-binary.md` - Complete rationale from Gemini conversation
- **New Project**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/README.md`

## Lessons Learned

1. **Pattern Consistency Matters**: If you have an established pattern (Temporal binary), follow it
2. **Simpler is Better**: Containers add unnecessary complexity for this use case
3. **User Experience**: Requiring Docker is a higher barrier than downloading a binary
4. **Question Assumptions**: "Python = Docker" was a false assumption; PyInstaller solves the real problem

---

**DO NOT PROCEED WITH THIS PROJECT**

Use the PyInstaller approach instead.
