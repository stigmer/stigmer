# Next Task: 20260126.02.mcp-server-api-resource

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: McpServer API Resource

**Description**: Extract MCP server configuration from AgentSpec into a separate, reusable API resource with multi-scope support (platform, organization, identity_account)

**Goal**: Create McpServer as a first-class API resource that enables reusability across agents, proper FGA authorization, and marketplace discoverability for MCP server configurations

**Tech Stack**: Protobuf, Go, Java, FGA (Fine-Grained Authorization)

**Repos Affected**: 
- `stigmer` (proto definitions, CLI)
- `stigmer-cloud` (backend handlers, FGA model)

---

## Essential Reference Files (READ THESE FIRST)

### Current Implementation to Extract From
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agent/v1/spec.proto
```
Contains the current `McpServerDefinition`, `StdioServer`, `HttpServer`, `DockerServer` that need to be extracted.

### Pattern to Follow (Skill API Resource)
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/skill/v1/api.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/skill/v1/spec.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/agentic/skill/v1/status.proto
```

### Commons (Metadata, References, Enums)
```
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/commons/apiresource/metadata.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/commons/apiresource/enum.proto
/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/commons/apiresource/io.proto
```

---

## Project Documentation

### Task Plan (PENDING REVIEW)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/tasks/T01_0_plan.md
```
Comprehensive implementation plan with phases, proto structures, FGA model.

### Design Decisions (3 key decisions documented)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/design-decisions/001-scope-model.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/design-decisions/002-reference-pattern.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/design-decisions/003-env-var-handling.md
```

### Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/README.md
```

---

## Knowledge Folders

### Checkpoints (Progress Snapshots)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/checkpoints/
```

### Coding Guidelines (Project-Specific Patterns)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/coding-guidelines/
```

### Wrong Assumptions (Lessons Learned)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/wrong-assumptions/
```

### Don't Dos (Anti-Patterns to Avoid)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260126.02.mcp-server-api-resource/dont-dos/
```

---

## Current Status

**Created**: 2026-01-26
**Last Session**: 2026-01-26 Session 3 (SDK Migration + Codegen Fix)
**Current Phase**: Phase 3 - FGA Model
**Status**: READY TO START

---

## Session Progress

### ✅ Phase 1 Complete: Proto Definitions (Session 1 - 2026-01-26)

**Accomplishments:**
- Created complete proto structure for McpServer API resource
- All 6 proto files implemented with comprehensive documentation
- Generated Go and Python stubs successfully
- Passed buf lint validation
- User formatting refinements applied

**Files Created:**
1. `apis/ai/stigmer/agentic/mcpserver/v1/api.proto` - McpServer resource, McpServerList
2. `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto` - McpServerSpec with StdioServerConfig, HttpServerConfig, DockerServerConfig, VolumeMount, PortMapping
3. `apis/ai/stigmer/agentic/mcpserver/v1/status.proto` - McpServerStatus with ValidationState enum
4. `apis/ai/stigmer/agentic/mcpserver/v1/io.proto` - McpServerId wrapper
5. `apis/ai/stigmer/agentic/mcpserver/v1/query.proto` - McpServerQueryController (get, getByReference)
6. `apis/ai/stigmer/agentic/mcpserver/v1/command.proto` - McpServerCommandController (apply, create, update, delete)

**Generated Stubs:**
- ✅ Go stubs: `apis/stubs/go/ai/stigmer/agentic/mcpserver/v1/*.go` (8 files)
- ✅ Python stubs: `apis/stubs/python/stigmer/ai/stigmer/agentic/mcpserver/v1/*_pb2.py` (18 files)

### ✅ Phase 2 Complete: AgentSpec Migration (Sessions 2-3 - 2026-01-26)

**Proto Changes (Session 2):**
- Implemented simplified, user-friendly reference model for McpServer resources
- Deleted 7 inline message definitions (~614 lines net reduction)
- Added 2 new messages: `McpServerUsage` and `McpAccess`
- Rewrote `AgentSpec` and `SubAgent` with clean field numbering
- Regenerated all Go and Python stubs successfully
- Passed buf lint validation

**SDK Changes (Session 3):**
- Created `mcpserverref` package (parallel to `skillref`)
- Updated `agent` package with new builder methods (`AddMcpServerUsage`, `UseMCPServer`)
- Updated `subagent` package with `GrantMcpAccess()` and skill methods
- Deleted obsolete `mcpserver` package (890 lines removed)
- Updated all SDK examples (4 files)
- Updated all SDK tests (4 files)
- Regenerated all SDK types
- Fixed codegen tool to read from namespace directories

**Key Design Decisions:**
1. **Single Slug Identifier** - One slug flows through entire system (McpServer.slug → Agent → SubAgent)
2. **McpAccess Message** - Single field for access grants (no two-field coordination)
3. **No Version in McpServerRef** - McpServer references don't support versioning
4. **No Backward Compatibility** - Clean slate, foundation-quality code

**Files Modified:**
1. **Proto (Session 2):**
   - `apis/ai/stigmer/agentic/agent/v1/spec.proto` - Complete rewrite
   - Generated stubs in `apis/stubs/go/` and `apis/stubs/python/`

2. **SDK (Session 3):**
   - Created: `sdk/go/mcpserverref/` (3 files)
   - Modified: `sdk/go/agent/` (3 files)
   - Modified: `sdk/go/subagent/` (2 files)
   - Deleted: `sdk/go/mcpserver/` (6 files, 890 lines)
   - Updated: `sdk/go/examples/` (4 files)
   - Regenerated: `sdk/go/gen/` (38 files)

3. **Tooling (Session 3):**
   - Modified: `tools/codegen/generator/main.go` (namespace directory support)
   - Cleaned: 111 obsolete schema files

**Permission Model:**
- SubAgent can ONLY access parent's MCP servers
- SubAgent can ONLY restrict tools (not expand)
- Clean permission hierarchy enforced by structure

**Quality Metrics:**
- Proto: 4 messages (down from 11), -85 lines, -614 lines in stubs
- SDK: -890 lines (mcpserver deleted), +150 lines (mcpserverref)
- Net: -3,417 lines across 111 files
- ✅ All tests pass, no linter errors

---

## Implementation Phases Overview

| Phase | Description | Repo | Status |
|-------|-------------|------|--------|
| 1 | Proto definitions (mcpserver/v1/*.proto) | stigmer | ✅ **COMPLETE** |
| 2 | AgentSpec migration (mcp_server_usages) | stigmer | ✅ **COMPLETE** |
| 3 | FGA model (mcp_server.fga) | stigmer-cloud | 🔄 **NEXT** |
| 4 | Backend handlers (CRUD operations) | stigmer-cloud | Not Started |
| 5 | Agent runner integration | stigmer-cloud | Not Started |
| 6 | CLI commands | stigmer | Not Started |

---

## Next Steps (Phase 3: FGA Model)

Switch to `stigmer-cloud` repo for backend implementation.

1. **Create FGA model for McpServer**
   - Create `apis/ai/stigmer/iam/fga/mcp_server.fga`
   - Define relations: `owner`, `viewer`, `user`
   - Add permission checks for operations: `can_view`, `can_update`, `can_delete`, `can_use`
   - Follow pattern from existing FGA models (skill, agent, environment)

2. **Update FGA initialization**
   - Add McpServer type to FGA store initialization
   - Register relation definitions
   - Add to authorization middleware

3. **Test FGA model**
   - Unit tests for permission checks
   - Test scope-based access (platform, org, identity_account)
   - Verify inheritance patterns

---

## Context for Resume

**Where we left off (Session 3):**
- Phase 1 complete: McpServer proto definitions (6 files)
- Phase 2 complete: AgentSpec proto migration + full SDK implementation
- All changes in `stigmer` repo complete and ready for commit
- SDK fully migrated with new patterns, all tests passing
- Codegen tool fixed to work with namespace directories

**What's working:**
- ✅ McpServer API resource fully defined (6 proto files)
- ✅ AgentSpec proto migration complete with simplified reference model
- ✅ SDK completely migrated:
  - `mcpserverref` package for creating references
  - `agent` package with new builder methods
  - `subagent` package with McpAccess pattern
  - Old `mcpserver` package deleted
  - All examples and tests updated
- ✅ Codegen tool fixed (reads from namespace directories)
- ✅ Single slug identifier flows through entire system
- ✅ Clean permission hierarchy (SubAgent ⊂ Agent)
- ✅ No linter errors, all tests pass

**Key Design Patterns Applied:**
- **Single Slug Pattern**: McpServer.slug used everywhere (no extra naming)
- **McpAccess Pattern**: Single field for access grants (no coordination)
- **No Versioning**: McpServerRef doesn't support version parameter
- **Permission Hierarchy**: SubAgent can only restrict, not expand
- **Reference-Based SDK**: Using `mcpserverref` instead of inline definitions
- **Namespace Codegen**: Tool reads from `agentic/agent/` structure

**Technical Improvements:**
- Codegen now supports namespace directories (no symlinks needed)
- Cleaned up 111 obsolete schema files
- Net reduction of 3,417 lines across codebase

**Notes for next session:**
- Switch to `stigmer-cloud` repo for Phase 3 (FGA model)
- All stigmer repo work complete - ready for commit
- Follow existing FGA patterns from skill/agent/environment
- The `mcp_server = 44` enum value already exists in ApiResourceKind
- Backend implementation can start immediately

---

## Uncommitted Work

⚠️ **Uncommitted changes preserved** - Phase 1 + Phase 2 + SDK migration complete

**Files to commit (stigmer repo):**

**Phase 1 (McpServer proto definitions - Session 1):**
- `apis/ai/stigmer/agentic/mcpserver/v1/*.proto` (6 files - NEW)
- Generated stubs for mcpserver (NEW)

**Phase 2 Proto (AgentSpec migration - Session 2):**
- `apis/ai/stigmer/agentic/agent/v1/spec.proto` (MODIFIED - complete rewrite)
- Generated stubs for agent (MODIFIED)

**Phase 2 SDK (SDK migration - Session 3):**
- `sdk/go/mcpserverref/` (NEW - 3 files)
- `sdk/go/agent/` (MODIFIED - 3 files)
- `sdk/go/subagent/` (MODIFIED - 2 files)
- `sdk/go/mcpserver/` (DELETED - 6 files, 890 lines)
- `sdk/go/examples/` (MODIFIED - 4 files)
- `sdk/go/gen/` (REGENERATED - 38 files)
- `tools/codegen/generator/main.go` (MODIFIED - namespace support)
- Old schema files (DELETED - 111 files)

**Total Impact:**
- Proto: +6 files, -85 lines, -614 lines in stubs
- SDK: +3 files, -890 lines (mcpserver), +650 lines (updates)
- Schemas: -111 obsolete files
- Net: -3,417 lines across 111 files

**Commit Strategy Options:**

**Option 1: Single Commit (Recommended)**
```
feat: add McpServer API resource with complete SDK migration

- Add McpServer proto definitions (6 files)
- Migrate AgentSpec to reference-based pattern
- Implement complete SDK migration:
  - New mcpserverref package
  - Updated agent/subagent packages
  - Deleted obsolete mcpserver package
  - Updated all examples and tests
- Fix codegen to support namespace directories
- Clean up 111 obsolete schema files

BREAKING CHANGE: sdk/go/mcpserver package removed,
use mcpserverref for creating references
```

**Option 2: Three Separate Commits (Better Git History)**
1. `feat(proto): add McpServer API resource definitions`
2. `refactor(proto): migrate AgentSpec to reference-based McpServer`
3. `feat(sdk): implement complete AgentSpec SDK migration`

**Option 3: Two Commits (Balanced)**
1. `feat(proto): add McpServer API resource and AgentSpec migration`
2. `feat(sdk): implement complete SDK migration and codegen improvements`

---

## Quick Commands

After loading context:
- "Continue with Phase 3" - Start FGA model in stigmer-cloud repo
- "Show me the proto files" - Review what was created/modified
- "Commit changes" - Create proper commit(s) for Phase 1 + Phase 2
- "Review design decisions" - Review architectural choices
- "Show session notes" - See detailed progress from Session 2

---

*This file provides direct paths to all project resources for quick context loading.*
