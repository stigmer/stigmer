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
**Last Session**: 2026-01-26 (Phase 1 Complete)
**Current Phase**: Phase 2 - AgentSpec Migration
**Status**: IN PROGRESS

---

## Session Progress (2026-01-26)

### ✅ Phase 1 Complete: Proto Definitions

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

**Key Design Decisions Applied:**
- All three scopes supported (platform, org, identity_account) - unlike Skill
- Reuses `EnvironmentSpec` for env var handling (consistent with Agent/Workflow)
- Validation-only status (tool discovery happens at runtime)
- Full buf.validate rules applied
- Kubernetes-style `apply` command for idempotent operations

**Quality Metrics:**
- 236 lines in spec.proto with comprehensive field documentation
- Every field documented with purpose, constraints, and examples
- All required fields have buf.validate rules
- Follows established Stigmer proto patterns (Skill, Environment)

---

## Implementation Phases Overview

| Phase | Description | Repo | Status |
|-------|-------------|------|--------|
| 1 | Proto definitions (mcpserver/v1/*.proto) | stigmer | ✅ **COMPLETE** |
| 2 | AgentSpec migration (mcp_server_usages) | stigmer | 🔄 **NEXT** |
| 3 | FGA model (mcp_server.fga) | stigmer-cloud | Not Started |
| 4 | Backend handlers (CRUD operations) | stigmer-cloud | Not Started |
| 5 | Agent runner integration | stigmer-cloud | Not Started |
| 6 | CLI commands | stigmer | Not Started |

---

## Next Steps (Phase 2: AgentSpec Migration)

1. **Add `McpServerUsage` to agent/v1/spec.proto**
   - Create `McpServerUsage` message with `mcp_server_ref`, `enabled_tools_override`, `alias`
   - Add `repeated McpServerUsage mcp_server_usages = 8` to `AgentSpec`
   - Mark existing `mcp_servers` field as deprecated
   - Add CEL validation for `mcp_server_ref.kind == 44` (mcp_server enum)

2. **Update InlineSubAgentSpec for McpServer references**
   - Add support for referencing McpServer resources in sub-agents
   - Maintain backward compatibility with inline MCP definitions

3. **Regenerate stubs**
   - Run `make build` in `apis/` directory
   - Verify Go/Python stubs updated correctly

4. **Update SDK (if needed)**
   - Check if Go SDK needs updates for new usage pattern
   - Update examples/documentation

---

## Context for Resume

**Where we left off:**
- Phase 1 proto definitions are complete and validated
- All stubs generated successfully
- Files are uncommitted (ready for review before commit)

**What's working:**
- Proto structure follows established patterns perfectly
- Buf validation passes
- Generated stubs compile cleanly

**Notes for next session:**
- The `mcp_server = 44` enum value already exists in ApiResourceKind
- Phase 2 is a simpler change (just adding usage pattern to AgentSpec)
- Backward compatibility is critical - keep deprecated field functional

---

## Uncommitted Work

⚠️ **Uncommitted changes preserved** - Phase 1 implementation

**New files to commit:**
- `apis/ai/stigmer/agentic/mcpserver/v1/*.proto` (6 files)
- Generated stubs in `apis/stubs/go/` and `apis/stubs/python/`
- BUILD.bazel files (auto-generated by Gazelle)

**Recommendation**: Commit Phase 1 as a complete unit before starting Phase 2

---

## Quick Commands

After loading context:
- "Continue with Phase 2" - Start AgentSpec migration
- "Show me the proto files" - Review what was created
- "Commit Phase 1 changes" - Create proper commit for proto definitions
- "Review design decisions" - Review architectural choices

---

*This file provides direct paths to all project resources for quick context loading.*
