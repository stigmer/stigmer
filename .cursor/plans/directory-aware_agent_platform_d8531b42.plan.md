---
name: Directory-Aware Agent Platform
overview: "Replace the fragile prompt-level directory hints with two platform-level fixes: make the `read` tool handle directories gracefully (returning a listing instead of an error), and expand directory workspace references into full tree views in the prompt section."
todos:
  - id: fix1-read-tool
    content: Modify FilesystemBackend.read_file() to return a formatted directory listing instead of raising IsADirectoryError. Add _format_directory_listing() helper.
    status: completed
  - id: fix2-tree-expansion
    content: Enhance build_referenced_files_prompt_section() with _build_directory_tree() helper that recursively walks directory refs and produces a file manifest with sizes and structure.
    status: completed
  - id: fix3-backend-tests
    content: Add tests in test_filesystem_backend.py for read_file() on directories (listing, sizes, hidden skip, truncation, file still works).
    status: completed
  - id: fix4-prompt-tests
    content: Add/update tests in test_workspace_prompt_section.py for directory tree expansion (tree structure, sizes, depth limit, hidden skip, truncation).
    status: completed
isProject: false
---

# Directory-Aware Agent Platform

## Domain Analysis

### The Critique

The current directory handling has three architectural problems:

1. **Error as information flow** -- When `read` is called on a directory, `FilesystemBackend.read_file()` raises `IsADirectoryError`. The wrapper catches it and returns a string like `"Error: Path 'x' is a directory... Contents: [...]. Use list_files()..."`. The actual useful information (directory contents) is buried inside an *error message*. The agent wastes a full LLM turn on the error, then has to parse the suggestion, switch tools, and retry. For nested directories (like `docs/` inside `apis/ai/stigmer/agentic/agent/`), this repeats at every level.
2. **Shallow prompt metadata** -- `build_referenced_files_prompt_section()` tags top-level directories as `(directory)` but provides zero information about what's inside. The agent gets:

```
   - `apis/ai/stigmer/agentic/agent/` (directory)
   

```

   ...and has no idea what files exist, how deep the tree goes, or what to read first. It must blindly explore with `ls` at every level.

1. **Prompt-engineering as architecture** -- The recent fix changed the instruction text from "use `read`" to "use `read` for files and `ls` for directories". This relies on the LLM correctly interpreting and following a natural-language hint. It is fragile, does not scale to nested structures, and is fundamentally the wrong layer for this concern.

### The Fix

Two platform-level changes that make directories first-class citizens. Neither relies on the LLM interpreting hints.

---

## Fix 1: Graceful `read` on directories (tool-level)

**File:** `[backend/libs/python/graphton/src/graphton/core/backends/filesystem.py](backend/libs/python/graphton/src/graphton/core/backends/filesystem.py)`

**Current behavior** (lines 234-241):

```python
if file_path.is_dir():
    contents = sorted(item.name for item in file_path.iterdir())
    msg = (
        f"Path '{path}' is a directory, not a file. "
        f"Contents: {contents}. Use list_files() to list directories."
    )
    raise IsADirectoryError(msg)
```

**New behavior:** Return a structured, useful directory listing instead of raising an error. The listing should:

- Clearly indicate the path is a directory (header line)
- Sort directories before files (natural exploration order)
- Show file sizes and directory item counts
- Annotate directories with trailing `/`
- Skip hidden entries (`.git`, `.stigmer`, `__pycache__`) to reduce noise
- Cap at a reasonable entry limit (e.g., 100 entries) with truncation notice

```python
if file_path.is_dir():
    return self._format_directory_listing(file_path, path)
```

Add a private helper `_format_directory_listing(self, dir_path, display_path)` that produces output like:

```
[Directory: apis/ai/stigmer/agentic/agent]

  v1/                        (3 files)
  docs/                      (5 files)
```

**Why this is sound:** The `read` tool's purpose is "give the agent the content of this path." For a file, content is text. For a directory, content is its structure. Returning a listing is not a semantic violation -- it is the *correct* answer for directories. The alternative (raising an error) forces the agent to waste a turn and switch tools, which is a platform failure, not an agent mistake.

**Daytona backend:** `[backend/libs/python/graphton/src/graphton/core/backends/daytona.py](backend/libs/python/graphton/src/graphton/core/backends/daytona.py)` delegates to an inner backend via `self._inner.read_file()`. If the inner is a `FilesystemBackend`, this fix propagates automatically. If it's the Daytona SDK, its error handling is already different. No change needed in the wrapper layer.

---

## Fix 2: Directory tree expansion in prompt section (prompt-level)

**File:** `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`

**Current behavior** (lines 660-665):

```python
if os.path.isdir(full_path):
    section += f"- `{ref_path}/` (directory)\n"
```

**New behavior:** For directory refs, recursively walk the tree and produce a manifest with file metadata. Add a helper function `_build_directory_tree()` that:

- Walks the directory tree up to a configurable `max_depth` (default 3)
- Caps total entries at `max_entries` (default 200)
- Skips hidden directories (`.git`, `__pycache__`, `node_modules`, `.stigmer`)
- Shows file sizes in human-readable format
- Indents to show tree structure
- Adds a truncation notice if limits are hit

The prompt section for a directory ref would look like:

```
- `apis/ai/stigmer/agentic/agent/` (directory, 10 files)
    - `v1/io.proto` (214 bytes)
    - `v1/spec.proto` (5.2 KB)
    - `docs/README.md` (419 bytes)
    - `docs/agent-resource-guide.md` (7.1 KB)
    - `docs/examples.md` (6.6 KB)
    - `docs/sub-agents.md` (5.1 KB)
    - `docs/validation-checklist.md` (5.3 KB)
```

This gives the agent a complete map upfront. It knows every file, its size, and the directory structure -- zero discovery turns needed.

The section header instruction can be simplified from "Use `read` for files and `ls` for directories" to something more natural since the agent now has the full picture.

---

## Fix 3: Update tests

**File:** `[backend/libs/python/graphton/tests/core/test_filesystem_backend.py](backend/libs/python/graphton/tests/core/test_filesystem_backend.py)`

Add tests for the new `read_file()` behavior on directories:

- `test_read_file_on_directory_returns_listing` -- returns string (not raises)
- `test_read_file_directory_listing_contains_entries` -- child files/dirs appear
- `test_read_file_directory_listing_shows_sizes` -- file sizes present
- `test_read_file_directory_listing_skips_hidden` -- `.git` etc. excluded
- `test_read_file_directory_listing_truncates` -- entry limit respected
- `test_read_file_on_file_still_returns_content` -- existing behavior preserved

**File:** `[backend/services/agent-runner/tests/test_workspace_prompt_section.py](backend/services/agent-runner/tests/test_workspace_prompt_section.py)`

Add/update tests for directory tree expansion:

- `test_directory_ref_shows_tree` -- tree structure appears in section
- `test_directory_ref_shows_file_sizes` -- sizes in tree
- `test_directory_ref_respects_max_depth` -- depth limit works
- `test_directory_ref_skips_hidden` -- hidden dirs excluded
- `test_directory_ref_truncates_large_trees` -- entry limit + notice

---

## What this does NOT change

- **Proto schema** -- `workspace_file_refs` remains `repeated string`. The backend can determine file vs directory at runtime via `os.stat()`. A richer `WorkspaceReference` message would be cleaner from a DDD perspective, but the practical cost (new generated code, API version, downstream migration) is not justified for this fix. If we find ourselves needing more metadata fields on references in the future, we can introduce the message then.
- **CLI** -- No changes needed. The CLI's job is to record intent ("user wants the agent to focus on this path"). Whether it's a file or directory is the backend's concern. The separation of concerns is correct as-is.
- **Attachment flow** -- The upload/extract path for files *outside* the workspace already handles directories correctly (zip, upload, extract). Only the workspace-file-ref path needed fixing.

---

## Risk assessment

- **Fix 1 (read tool):** Low risk. The `read_file()` method is called from the tool wrapper which already catches all exceptions. Returning a listing instead of raising is strictly more useful. Any internal code that caught `IsADirectoryError` from this method would be rare and wrong (should use `os.path.isdir()` instead).
- **Fix 2 (tree expansion):** Low risk. Adds information to the prompt. Existing tests verify section ordering. The depth and entry limits prevent prompt bloat. The function is pure (stateless, filesystem read only).

