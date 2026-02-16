---
name: Fix HITL resume AttributeError
overview: Fix the `[AttributeError] size_bytes` crash that occurs on the HITL resume-after-approval path when the execution has attachments. The resume fast path incorrectly accesses `att.size_bytes` on the `Attachment` proto, which has no such field.
todos:
  - id: fix-resume-path
    content: Replace att.size_bytes with None on the resume fast path (line 1239)
    status: completed
  - id: fix-size-consumer
    content: Make the system prompt consumer (line 1547) handle None size gracefully
    status: completed
isProject: false
---

# Fix `[AttributeError] size_bytes` on HITL Resume Path

## Root Cause

The error occurs at **line 1239** of `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`:

```python
"size": att.size_bytes,  # <-- Attachment proto has no size_bytes field
```

The `Attachment` proto (`[spec.proto:355-377](apis/ai/stigmer/agentic/agentexecution/v1/spec.proto)`) only has: `filename`, `storage_key`, `mount_path`, `content_type`. It does **not** have `size_bytes` (that field exists on a different message, `ExecutionArtifact`, in `api.proto`).

### When does it crash?

This happens specifically on the **HITL resume path** -- the code path taken when the activity re-invokes after the user approves a tool call:

1. First invocation: `inject_attachments()` downloads content and computes `size` via `len(content)` -- works fine.
2. User approves the HITL write tool request.
3. Resume invocation: The resume fast path (line 1230-1245) skips re-downloading and tries to reconstruct `injected_files` from the `Attachment` proto. It accesses `att.size_bytes` which doesn't exist -- `AttributeError`.

The entire execution crashes during setup, before the agent even resumes.

### Who is affected?

Any execution that has **attachments AND uses HITL approval** (the default for write operations). If the execution has no attachments, this code path is skipped and everything works fine.

## Fix

### What `size` is used for

`size` appears in exactly two consumers:

1. **Logging** (line 354 in `inject_attachments()`) -- fresh path only, unaffected
2. **System prompt** (line 1547) -- both paths, shows input file info to the agent:
  ```python
   input_files_section += f"- `{f['path']}` ({f['size']} bytes)\n"
  ```

Size is **purely informational** -- it's cosmetic context in the system prompt. The agent can always inspect files directly.

### Change 1: Fix the resume fast path (line 1236-1240)

Replace the non-existent `att.size_bytes` with `None`. On resume, the content isn't re-downloaded, so the size is genuinely unavailable:

```python
for att in attachments:
    mount_path = att.mount_path if att.mount_path else f"inputs/{att.filename}"
    injected_files.append({
        "filename": att.filename,
        "path": mount_path,
        "size": None,  # Not available on resume (content not re-downloaded)
    })
```

### Change 2: Handle `None` size in the system prompt (line 1547)

Make the system prompt consumer resilient to missing size:

```python
for f in injected_files:
    size_info = f" ({f['size']} bytes)" if f.get('size') is not None else ""
    input_files_section += f"- `{f['path']}`{size_info}\n"
```

## Design Consideration (for your input)

The `Attachment` proto legitimately lacks `size_bytes` because its design is storage-key-first: you upload content beforehand, and the proto stores only the reference. The size lives in the storage layer, not the proto.

There's a separate question of whether `size_bytes` *should* be added to the `Attachment` proto as useful metadata. It would make the resume path (and any future consumer) able to show size without re-downloading. But that's an API schema change with broader implications (proto regen, upload flow changes, backward compat). Given that size here is purely cosmetic for the system prompt, I'd recommend **not** changing the proto for this -- the fix above is clean, minimal, and honest about what data is available on resume. But I want your input on this before proceeding.

## Files Changed

- `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` -- 2 small edits (resume fast path + system prompt consumer)

