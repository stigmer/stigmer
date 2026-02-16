# Fix HITL Resume Crash on Attachment size_bytes AttributeError

**Date**: February 16, 2026

## Summary

Fixed an `AttributeError` that crashed executions with attachments when resuming after HITL approval. The resume fast path in `execute_graphton.py` accessed `att.size_bytes` on the `Attachment` proto, which does not have that field. This caused the entire execution to fail during setup before the agent could resume.

## Problem Statement

When an execution with attachments (e.g., input files provided by the user) required HITL approval for a write tool, the user would approve the tool, and then the resume invocation would immediately crash with:

```
Execution failed: [AttributeError] size_bytes
```

The error was non-obvious because `size_bytes` exists on the `ExecutionArtifact` proto but not on `Attachment`. The enhanced error logging from the earlier race condition fix (which added exception type to the error message) made this diagnosable.

### Pain Points

- **Broken resume flow**: Any execution with attachments that hit HITL approval would crash on resume, making HITL unusable for attachment-based workflows
- **Wasted user effort**: The user would review and approve the tool call, only to have the execution fail immediately afterward
- **Confusing error**: "size_bytes" gave no indication that it was a proto field mismatch on the `Attachment` message

## Solution

The `Attachment` proto has four fields: `filename`, `storage_key`, `mount_path`, `content_type`. It does not have `size_bytes` -- that field lives on `ExecutionArtifact`, a separate message.

On the fresh execution path, `inject_attachments()` downloads content and computes size via `len(content)`. On the resume path, content isn't re-downloaded (attachments are already in the sandbox), so the size is genuinely unavailable.

### Change 1: Fix the resume fast path

Replaced the non-existent `att.size_bytes` with `None`, which honestly represents that the size is not available on the resume path:

```python
injected_files.append({
    "filename": att.filename,
    "path": mount_path,
    "size": None,  # Not available on resume (content not re-downloaded)
})
```

### Change 2: Resilient system prompt consumer

The `size` field is consumed only for the system prompt (informational context for the agent). Updated the consumer to handle `None` gracefully:

```python
size_info = f" ({f['size']} bytes)" if f.get('size') is not None else ""
input_files_section += f"- `{f['path']}`{size_info}\n"
```

On fresh execution: `- \`inputs/data.csv\` (1024 bytes)`. On resume: `- \`inputs/data.csv\``.

## Benefits

- **HITL resume works with attachments**: Executions no longer crash when resuming after approval
- **Honest data representation**: `None` accurately reflects that size is unavailable on the resume path, rather than using a sentinel value like `0`
- **No proto changes needed**: The fix is contained in one file with no API contract changes

## Impact

### Who is Affected

- **All users** with attachment-based executions that trigger HITL approval (write/edit tools)
- Previously these executions would crash silently on resume; now they complete as expected

### Changed Components

- **Agent Runner** (`execute_graphton.py`): Resume fast path and system prompt consumer

---

**Status**: Production Ready
**Files Changed**: 1 source file (`execute_graphton.py`)
**Lines Changed**: ~4 lines of functional code
