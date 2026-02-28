---
name: Workspace-Aware File Referencing
overview: When users attach files that already exist inside a local workspace, the CLI should detect this and skip the upload/injection flow -- instead, it sends workspace-relative paths as "file references" that the backend uses to build a focused prompt section. This eliminates redundant uploads, copies, and semantic lies in the agent's context.
todos:
  - id: proto-field
    content: Add workspace_file_refs field to AgentExecutionSpec proto and regenerate stubs
    status: completed
  - id: cli-containment
    content: Implement workspace containment detection in AttachmentProcessor (split workspace refs from uploads)
    status: completed
  - id: cli-wiring
    content: Wire workspace_file_refs through run.go, run_handlers.go, and run_create.go to AgentExecutionSpec
    status: completed
  - id: backend-prompt
    content: Add Referenced Files prompt section in execute_graphton.py when workspace_file_refs is present
    status: completed
  - id: cli-tests
    content: "Tests for containment detection: inside workspace, outside workspace, mixed, symlinks, no workspace"
    status: completed
  - id: backend-tests
    content: Test for Referenced Files prompt section construction
    status: completed
isProject: false
---

# Workspace-Aware File Referencing

## Problem Statement

When a user runs:

```bash
stigmer run agent reviewer --workspace . --attach ./src/config.yaml -m "Review this"
```

The file `src/config.yaml` is **inside the workspace**. Today, the system:

1. Uploads it to R2 (wasteful -- file is already accessible)
2. Copies it to `.stigmer/inputs/config.yaml` (creates a confusing duplicate)
3. Tells the agent it's "NOT part of the project source tree" (semantic lie)
4. Agent reads the copy at `.stigmer/inputs/config.yaml` instead of the real file at `src/config.yaml`

## Design

### Core Principle

`--attach` serves two purposes: **transport** (make file available) and **attention** (focus the agent on it). For files inside the workspace, transport is already satisfied -- only attention is needed.

### Proto Change

Add a single field to `AgentExecutionSpec` in [spec.proto](apis/ai/stigmer/agentic/agentexecution/v1/spec.proto):

```protobuf
message AgentExecutionSpec {
  // ... existing fields through attachments = 9 ...

  // Workspace-relative file paths the user wants the agent to focus on.
  // Valid only when the session has a workspace_source.
  // These files already exist in the workspace -- no upload or injection occurs.
  // The agent accesses them directly via the workspace filesystem.
  repeated string workspace_file_refs = 10;
}
```

**Why simple strings, not a rich message?** The backend can `stat()` the files from the workspace to get size info for the prompt. No metadata bloat needed on the proto.

### CLI Change: Workspace-Aware `--attach` Processing

In [run_attachments.go](client-apps/cli/cmd/stigmer/root/run_attachments.go), split processing based on workspace containment:

```
For each --attach path:
  1. Resolve to absolute
  2. Is workspace set AND is this path inside the workspace directory?
     YES -> Compute workspace-relative path, add to workspace_file_refs list. Skip upload.
     NO  -> Normal attachment flow (upload to R2, create Attachment proto)
```

Key details:

- Use `filepath.EvalSymlinks` before containment check (symlinks that escape workspace)
- Normalize both paths before `strings.HasPrefix` comparison
- For directories inside workspace: compute relative path for the directory (no zip, no upload)

No new flags. `--attach` just works -- the system is smart about it. The user doesn't need to know whether a file is inside the workspace or not.

### Backend Change: New System Prompt Section

In [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) (around line 1704), add a new prompt section when `workspace_file_refs` is present:

```python
if workspace_file_refs:
    section = "\n\n## Referenced Files\n\n"
    section += (
        "The user has highlighted the following workspace files for your "
        "attention. Read them directly at their workspace-relative paths "
        "using the `read` tool.\n\n"
    )
    for ref_path in workspace_file_refs:
        size = workspace_backend.get_file_size(ref_path)  # stat from workspace
        section += f"- `{ref_path}` ({size} bytes)\n"
    enhanced_system_prompt += section
```

This section goes AFTER `## Workspace` and BEFORE `## Input Files` (which remains for files outside the workspace).

### What This Looks Like End-to-End

**Before (current):**

```
## Input Files

The following files have been provided as read-only reference material
for your task. They live under `.stigmer/inputs/` and are NOT part of
the project source tree.

- `.stigmer/inputs/config.yaml` (2048 bytes)
```

**After (with this change):**

```
## Referenced Files

The user has highlighted the following workspace files for your
attention. Read them directly at their workspace-relative paths.

- `src/config.yaml` (2048 bytes)
```

The agent reads the REAL file at its REAL location. No copies, no lies.

### Mixed Scenario

```bash
stigmer run agent migrator \
  --workspace ./myproject \
  --attach ./myproject/src/schema.sql \    # INSIDE workspace -> workspace_file_ref
  --attach /tmp/external-data.csv \        # OUTSIDE workspace -> normal attachment
  -m "Migrate the schema using external data"
```

Result:

- `src/schema.sql` -> `workspace_file_refs = ["src/schema.sql"]`
- `/tmp/external-data.csv` -> normal Attachment (uploaded, injected at `.stigmer/inputs/external-data.csv`)

Agent sees both sections in system prompt.

### Scope: Output Optimization (Deferred)

For outputs, the local workspace already provides the right behavior: the agent writes directly to the user's filesystem. Files are already there. The `publish_artifact` + `--download` round-trip through R2 is redundant but not harmful.

**Recommendation**: Defer output optimization to a separate task. The input side is the clear, high-value win. Output optimization requires changes across more layers (publish_artifact tool, CLI download logic, ExecutionArtifact proto) and has more edge cases.

### Edge Cases and Guardrails

- **No workspace**: `workspace_file_refs` is rejected with a clear error ("workspace file refs require --workspace")
- **File not found**: CLI validates file existence before adding to refs (same as current `--attach` behavior)
- **Cloud mode**: This optimization only applies when the workspace is a local path. For git workspaces, files are cloned into a remote sandbox -- the CLI can't check containment pre-clone. All attachments go through the normal flow.
- **Backward compatibility**: Zero breaking changes. The new field is additive. Existing behavior is unchanged when `workspace_file_refs` is empty.

### Key Files to Modify

**Proto** (1 file):

- [apis/ai/stigmer/agentic/agentexecution/v1/spec.proto](apis/ai/stigmer/agentic/agentexecution/v1/spec.proto) -- add `workspace_file_refs` field

**CLI** (3 files):

- [run_attachments.go](client-apps/cli/cmd/stigmer/root/run_attachments.go) -- workspace containment check, split processing
- [run.go](client-apps/cli/cmd/stigmer/root/run.go) -- pass workspace path to attachment processor, wire `workspace_file_refs` to spec
- [run_handlers.go](client-apps/cli/cmd/stigmer/root/run_handlers.go) -- thread `workspace_file_refs` through to execution creation

**Backend** (1 file):

- [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) -- new `## Referenced Files` prompt section

**Tests** (2+ files):

- [run_attachments_test.go or new](client-apps/cli/cmd/stigmer/root/) -- test containment detection, mixed scenarios
- Backend test for the new prompt section

