# Checkpoint: Agent-Runner Skill Injection Complete

**Date**: 2026-01-25
**Task**: T01.5 - Python Agent-Runner Skill Injection
**Status**: ✅ Complete

---

## Summary

Implemented skill injection in the Python agent-runner following ADR 001: Skill Injection & Sandbox Mounting Strategy. Skills are now properly written to `/bin/skills/{version_hash}/` and full SKILL.md content is injected into the system prompt with LOCATION headers.

---

## What Was Accomplished

### 1. skill_writer.py - Complete Rewrite

**Before (broken):**
- Used non-existent proto fields (`skill.spec.description`, `skill.spec.markdown_content`)
- Wrote to `/workspace/skills/`
- Generated metadata-only prompt (name, description, file path)
- No local mode support

**After (following ADR 001):**
- Uses correct proto fields (`skill.spec.skill_md`, `skill.status.version_hash`)
- Writes to `/bin/skills/{version_hash}/` per ADR
- Injects **full SKILL.md content** into prompt with LOCATION header
- Supports both **local mode** (filesystem) and **cloud mode** (Daytona)

### 2. execute_graphton.py - Updated Skill Handling

**Before:**
- Skipped skills entirely in local mode with warning

**After:**
- Local mode: Writes skills to `{local_root}/bin/skills/{version_hash}/`
- Cloud mode: Uploads to Daytona sandbox at `/bin/skills/{version_hash}/`
- Both modes inject full skill content into system prompt

---

## System Prompt Format

Following ADR 001 pattern:

```text
## Available Skills

The following skills provide specialized capabilities.
Each skill includes instructions and executable tools.

### SKILL: calculator
LOCATION: /bin/skills/abc123def456.../

(Full content of SKILL.md here - the entire interface definition)

### SKILL: web-search
LOCATION: /bin/skills/789xyz.../

(Full content of SKILL.md here...)
```

---

## Key Design Decisions

### 1. Version Hash as Directory Name
Uses `skill.status.version_hash` (SHA256) as the directory name. This ensures:
- Immutable paths for specific versions
- Content-addressable filesystem structure
- Matches R2 storage pattern

### 2. Full Content Injection
The complete SKILL.md content is injected into the prompt, not just metadata. This means:
- Agents know how to use tools without reading files
- Reduces tool calls during execution
- Consistent with ADR 001 "Split-Brain" architecture

### 3. LOCATION Header
Each skill includes a `LOCATION: /bin/skills/{hash}/` header telling agents where executable files are located.

### 4. Both Modes Supported
- **Local mode**: Uses `local_root` parameter, writes to filesystem
- **Cloud mode**: Uses Daytona sandbox, uploads via SDK

---

## Files Modified

```
backend/services/agent-runner/worker/activities/
├── execute_graphton.py                    # +34/-34 lines (skill handling update)
└── graphton/
    └── skill_writer.py                    # +202/-88 lines (complete rewrite)
```

---

## What's NOT Implemented

Per ADR 001, there's also an **artifact mounting** component (downloading ZIP files and extracting). The current implementation only writes SKILL.md content. If skills have executable implementations:

1. Download artifact from R2/storage using `skill.status.artifact_storage_key`
2. Extract ZIP to `/bin/skills/{version_hash}/`

This is deferred to a future task.

---

## Test Verification

No automated tests exist yet. Manual verification approach:

1. Start agent-runner in local mode
2. Configure agent with skill_refs
3. Execute agent and verify:
   - Skills written to `/tmp/stigmer-sandbox/bin/skills/{hash}/SKILL.md`
   - System prompt contains full SKILL.md content with LOCATION headers
   - Agent can reference skill instructions

---

## Related Documentation

- **ADR 001**: `stigmer/_cursor/adr-doc.md` - Skill Injection & Sandbox Mounting Strategy
- **Design Decision**: `design-decisions/01-skill-proto-structure.md`
- **Skill Proto**: `apis/ai/stigmer/agentic/skill/v1/spec.proto`
- **Task Execution**: `tasks/T01_4_execution.md`

---

## Next Steps

1. **Artifact Download & Extraction**: Implement ZIP download and extraction
2. **Unit Tests**: Test skill_writer.py with mock sandbox
3. **Integration Test**: End-to-end skill injection flow
4. **Documentation**: Update agent-runner docs

---

**Status**: Agent-runner skill injection complete ✅
**Duration**: ~30 minutes
**Next**: Artifact extraction or testing
