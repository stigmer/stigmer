# Group CLI Commands in Help Output (kubectl-style)

**Date**: February 25, 2026

## Summary

Organized the Stigmer CLI help output into labeled command groups using Cobra's native `AddGroup`/`GroupID` API, replacing the flat alphabetical list. Also updated the CLI tagline to reflect agent-first positioning and removed the outdated BadgerDB reference.

## Problem Statement

Running `stigmer help` listed all 17 commands in a single flat "Available Commands:" section, sorted alphabetically. As the CLI grows, this becomes harder to scan — users have to read through every command to find what they need.

### Pain Points

- No visual structure to guide new users toward the most common commands
- Resource management commands mixed with server infrastructure and configuration
- The flat list doesn't convey the CLI's conceptual model or intended workflows
- Tagline referenced "Workflow as Code" and "BadgerDB", both outdated positioning

## Solution

Used Cobra v1.10.2's built-in command grouping feature (`AddGroup` + `GroupID`) to organize commands into five labeled sections. All grouping logic is centralized in a single file (`root.go`) using a `withGroup` helper, keeping individual command files unaware of the grouping strategy.

## Implementation Details

**Single file changed**: `client-apps/cli/cmd/stigmer/root.go`

### Command Groups

| Group | Commands |
|---|---|
| Core Commands | `new`, `run` |
| Resource Management | `apply`, `get`, `list`, `delete`, `validate`, `search`, `draft` |
| Artifact Commands | `push`, `download` |
| Server Commands | `server`, `mcp-server` |
| Configuration | `backend`, `config`, `resources`, `completion` |

### Design Decisions

- **`draft` under Resource Management**: It produces resource configs (same output as `apply`). The AI mechanism is an implementation detail, not a user-facing category. A standalone "AI-Assisted" group for one command would add visual noise.
- **Centralized in `root.go`**: All grouping logic stays in one file via a `withGroup` helper. Commands don't import or know about group IDs. Reordering or regrouping requires editing only one file.
- **Hidden commands unchanged**: `internal-server` and `internal-workflow-runner` already use `Hidden: true` and are unaffected.
- **`help` in "Additional Commands:"**: Cobra auto-adds `help` without a `GroupID`; it naturally lands in the catch-all section, consistent with kubectl.

### Tagline Updates

- Short: "Stigmer - Workflow as Code" → "Stigmer - Agentic Automation Platform"
- Long line 1: "Build AI agents and workflows..." → "Build, run, and orchestrate AI agents..."
- Long line 2: Removed "BadgerDB" → "Run locally or scale to production with Stigmer Cloud"

## Benefits

- Users can scan grouped sections instead of reading a flat list of 17+ commands
- The help output now communicates the CLI's conceptual model at a glance
- New commands can be added to the appropriate group with a single `withGroup` call
- Agent-first positioning aligns the CLI tagline with the platform's direction

## Impact

- **End users**: Improved CLI discoverability and onboarding experience
- **Maintainers**: Single-file grouping logic makes reorganization trivial as the CLI grows

---

**Status**: Production Ready
