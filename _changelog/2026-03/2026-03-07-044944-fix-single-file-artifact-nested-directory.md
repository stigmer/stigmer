# Fix Single-File Artifact Nested Directory Bug

**Date**: March 7, 2026

## Summary

Fixed the auto-publish logic in the agent-runner so that a single written file is always published as a FILE artifact (named after the file itself), rather than being wrapped in a DIRECTORY artifact named after its parent directory. This eliminates a nested-directory collision when the CLI downloads artifacts to an `--output` directory that already matches the parent.

## Problem Statement

When `stigmer draft mcp-server --output mcp-servers/ --workspace .` was run, the generated YAML ended up at `mcp-servers/mcp-servers/planton.yaml` instead of `mcp-servers/planton.yaml`.

### Pain Points

- Running the onboarding script for the agent-fleet repo created a spurious nested `mcp-servers/mcp-servers/` directory
- Users had to manually move files out of the nested directory
- The artifact metadata displayed an incorrect name (`"mcp-servers"` instead of `"planton.yaml"`) in execution history and API responses

## Solution

Changed the `_auto_publish_written_files` function in `execute_graphton.py` to handle the single-file case as an early return that publishes the file directly — the same way root-level files are already published. This bypasses both the `common_dir` directory-artifact path and the grouping logic that had the same directory-artifact behaviour.

## Implementation Details

**Before**: When the agent wrote a single file in a subdirectory (e.g., `mcp-servers/planton.yaml`), the auto-publish logic extracted `common_dir = "mcp-servers"` (the parent) and published a DIRECTORY artifact named `"mcp-servers"`. On the CLI side, `downloadDirectoryArtifact` computed `filepath.Join(outputDir, "mcp-servers")`, doubling the path when `outputDir` was already `mcp-servers/`.

**After**: When exactly one file is written, it is published as a FILE artifact with `name = "planton.yaml"` and `path = "mcp-servers/planton.yaml"`. The CLI downloads to `filepath.Join(outputDir, "planton.yaml")` — correct, no nesting.

The multi-file case (2+ files sharing a parent directory) is completely unaffected and still uses the common-ancestor directory-artifact strategy.

### Files Changed

- `backend/services/agent-runner/worker/activities/execute_graphton.py` — replaced the single-file `common_dir` heuristic with a direct file-artifact publish and early return
- `backend/services/agent-runner/tests/test_auto_publish.py` — updated 5 tests to expect file-artifact semantics for single-file-in-subdirectory cases; updated module docstring

## Benefits

- Eliminates the nested `mcp-servers/mcp-servers/` directory bug for all single-file draft commands
- Produces correct artifact names in the execution API, UI, and history
- Works consistently across local and cloud execution modes
- Zero impact on multi-file artifact publishing (skills, agents with multiple files)

## Impact

All `stigmer draft` commands that produce a single output file (e.g., `draft mcp-server`, `draft skill` for single-file skills) will now place the file directly in the `--output` directory without nesting. Existing multi-file artifacts are unaffected.

## Related Work

Discovered while investigating the agent-fleet onboarding script (`tools/00_onboard-planton-mcp-server.sh`) which passes `--output "${REPO_ROOT}/mcp-servers"` to `stigmer draft mcp-server`.

---

**Status**: Production Ready
