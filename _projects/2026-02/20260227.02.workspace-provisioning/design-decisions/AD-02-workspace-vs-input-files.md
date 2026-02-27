# AD-02: Workspace and Input Files Are Separate Domain Objects

**Date**: 2026-02-27
**Status**: Accepted
**Context**: Workspace provisioning architecture discussion

## Decision

Workspace (WHERE the agent works) and Input Files (WHAT the user gives the agent per-execution) are two distinct domain concepts with different lifecycles.

## The Two Concepts

| Aspect | Workspace | Input Files |
|--------|-----------|-------------|
| Lifecycle | Session-scoped (persists across executions) | Execution-scoped (per-execution) |
| Provisioning | Once, at session start | Per execution |
| Direction | Bidirectional (agent reads and writes) | User → Agent (read-only context) |
| Source | Git repo, local path, or empty | User-attached files |
| Analogy (Cursor) | Open project folder | Files attached to chat message |

## Rationale

Mixing them in the same directory without a clear domain boundary causes problems:
- What if the user's project already has an `/inputs/` directory?
- Workspace files are the agent's working state. Input files are reference material.
- Workspace provisioning is a one-time setup. Input injection happens every execution.

## Input File Placement (Revised)

**Original decision**: Input files at `.stigmer/inputs/` within the workspace.

**Revised decision**: Input files at `{session_root}/.stigmer-inputs/` -- a sibling directory OUTSIDE the workspace root.

**Why revised**: Placing inputs inside a git-backed workspace creates problems:
- The agent might accidentally `git add .stigmer/` and include input files in commits
- `.stigmer/` appears in `git diff` and `git status` output, polluting change detection
- The workspace `.gitignore` would need modification (which itself is a workspace change)
- If the project already has a `.stigmer/` directory, we have a collision

Placing inputs in a sibling directory avoids all of these problems. The system prompt tells the agent the absolute path to the inputs directory.

## Consequences

- `WorkspaceSource` lives on `SessionSpec` (session-level, provisioned once).
- `Attachment` lives on `AgentExecutionSpec` (execution-level, injected per run).
- Input files are placed at `{session_root}/.stigmer-inputs/` (sibling to workspace root, outside the git working tree).
- The system prompt has separate sections: `## Workspace` and `## Input Files`.
- The inputs directory path is included as an absolute path in the `## Input Files` system prompt section.
