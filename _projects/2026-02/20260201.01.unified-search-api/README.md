# Project: 20260201.01.unified-search-api

## Overview
Implement a unified Search bounded context with a single RPC for searching/discovering all API resources (agents, skills, MCP servers, workflows)

**Created**: 2026-02-01
**Status**: Active 🟢

## Project Information

### Primary Goal
Create a search domain with single 'search' RPC that handles list, search, and discover operations across all resource types using MongoDB (cloud) and SQLite (OSS) backends

### Timeline
**Target Completion**: 1 week

### Technology Stack
Protocol Buffers, Java/Spring, Go (CLI), MongoDB, SQLite

### Project Type
Feature Development

### Affected Components
APIs (protos under ai.stigmer.search.v1), Backend services (Java handlers), CLI commands (list, search, discover)

## Project Context

### Dependencies
None - standalone bounded context

### Success Criteria
- CLI can list
- search
- and discover resources via single search RPC; Backend handlers implemented for MongoDB; Proto stubs generated

### Known Risks & Mitigations
None significant - FGA integration is straightforward (get authorized IDs, apply filters)

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**📌 IMPORTANT**: Knowledge folders require developer permission. See [coding-guidelines/documentation-discipline.md](coding-guidelines/documentation-discipline.md)

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [ ] Initial analysis complete
- [ ] Core implementation
- [ ] Testing and validation
- [ ] Documentation finalized
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

The `next-task.md` file contains:
- Direct paths to all project folders
- Current status information
- Resume checklist
- Quick commands

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Key Design Decisions

### Single RPC Architecture
Instead of separate `listAgents`, `searchAgents`, `searchSkills`, etc., we use **one `search` RPC** with a `kinds` parameter:

```protobuf
service SearchQueryController {
  rpc search(SearchRequest) returns (SearchResponse);
}
```

### CLI Command Mapping

| CLI Command | RPC Request |
|-------------|-------------|
| `stigmer agent list` | `{kinds: [AGENT], org: "<user's org>"}` |
| `stigmer agent search "X"` | `{kinds: [AGENT], query: "X"}` |
| `stigmer discover "X"` | `{kinds: [], query: "X"}` |

### SearchResult: Display Attributes Only
Results contain only what's needed for display (name, slug, qualified_slug, org, description, tags, timestamps, score) - not the full resource.

### Authorization Flow
1. FGA call → get authorized IDs per kind
2. Apply filters (org, query, exclude_public)
3. Return paginated results

### Boolean Convention
Use `exclude_public` (default `false`) instead of `include_public` - follows proto best practice for boolean defaults.

## Related Files

- Proto: `apis/ai/stigmer/search/v1/query.proto`
- Proto: `apis/ai/stigmer/search/v1/io.proto`
- Backend: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/search/`
- CLI: `client-apps/cli/cmd/stigmer/root/` (list, search, discover commands)

## Notes

_Add any additional notes, links, or context here as the project evolves._