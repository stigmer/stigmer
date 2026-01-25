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
**Current Task**: T01 - Design & Implementation Plan
**Status**: PENDING REVIEW

### Open Questions Requiring Decision:
1. **Versioning Model**: Mutable vs Immutable + Tags?
2. **Published/Draft State**: Review workflow for platform MCP servers?
3. **Tool Discovery**: Active probing vs lazy discovery?

---

## Implementation Phases Overview

| Phase | Description | Repo | Status |
|-------|-------------|------|--------|
| 1 | Proto definitions (mcpserver/v1/*.proto) | stigmer | Not Started |
| 2 | AgentSpec migration (mcp_server_usages) | stigmer | Not Started |
| 3 | FGA model (mcp_server.fga) | stigmer-cloud | Not Started |
| 4 | Backend handlers (CRUD operations) | stigmer-cloud | Not Started |
| 5 | Agent runner integration | stigmer-cloud | Not Started |
| 6 | CLI commands | stigmer | Not Started |

---

## Quick Commands

After loading context:
- "Review the plan and let me know your feedback" - Start plan review
- "Let's start Phase 1" - Begin proto definitions
- "Show me the design decisions" - Review architectural choices
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
