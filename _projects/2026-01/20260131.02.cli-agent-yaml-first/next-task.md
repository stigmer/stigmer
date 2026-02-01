# Next Task: 20260131.02.cli-agent-yaml-first

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: CLI Agent YAML-First

**Description**: Restructure CLI to make Agent a YAML-first resource, remove Agent from SDK (keeping only Workflow), and add agentic creation commands where users describe what they want and agents create the resources.

**Goal**: Enable agent-assisted resource creation - users describe what they want (an agent, skill, workflow) and our platform creates it agentically. Simplify Agent to YAML-based configuration, keep only Workflow in SDK for complex orchestration.

**Tech Stack**: Go (CLI), Proto definitions, gRPC APIs

**Components**: 
- CLI commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli`
- Go SDK: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go`
- Backend APIs: `/Users/suresh/scm/github.com/stigmer/stigmer-cloud`

---

## Current Status

**Phase**: Phase 1 - Agent YAML-First Foundation (IN PROGRESS)
**Current Task**: Sub-task 2 - Agent Schema Validator
**Status**: Sub-task 1 COMPLETED ✅

**Latest Session** (2026-02-01):
- ✅ Completed Sub-task 1: Agent YAML Loader
- Implemented loader.go with protovalidate as single source of truth
- Created comprehensive test suite (12 test cases, all passing)
- Updated BUILD.bazel with dependencies
- Created changelog: `_changelog/2026-02/2026-02-01-075912-agent-yaml-loader-foundation.md`

**Key Achievement**: Established clean architectural pattern using protovalidate instead of duplicating validation (avoiding MCP Server loader's technical debt)

---

## Key Design Decisions

**1. Agent becomes YAML-first** (like MCP Server):
- Agent is declarative configuration, not orchestration
- SDK remains for Workflow only (requires implicit dependency tracking)

**2. `draft` for agent-assisted authoring**:
- Replaces `create` (CRUD-speak) with domain-accurate term
- Conveys collaborative, iterative nature

**3. Platform Capabilities embedded in CLI**:
- Drafting capabilities are platform functions, not user skills
- Embedded via `go:embed` (~100KB, works offline)
- Not visible in `stigmer skill list`

**4. Search + Discover separation**:
- Per-resource `search` for typed queries
- Root `discover` for cross-cutting exploration

See: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md`

---

## Target CLI Structure

```
stigmer
├── skill
│   ├── push, get, list, delete
│   ├── search <query>            # Search skills
│   └── draft                     # Agent-assisted authoring
├── mcpserver
│   ├── apply, get, list, delete
│   ├── search <query>            # Search MCP servers
│   └── draft                     # Agent-assisted authoring
├── agent                         # NEW resource commands
│   ├── apply <file>              # YAML-based (like mcpserver)
│   ├── get, list, delete
│   ├── search <query>            # Search agents
│   ├── run <slug>                # Execute agent
│   └── draft                     # Agent-assisted authoring
├── workflow
│   ├── apply                     # SDK synthesis (renamed from root)
│   ├── get, list, delete
│   ├── search <query>            # Search workflows
│   ├── run <slug>                # Execute workflow
│   └── draft                     # Agent-assisted authoring
└── discover <query>              # Cross-cutting discovery
```

**Removed**: Root `apply`, `run`, `new` commands

---

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Agent YAML-First Foundation | **IN PROGRESS** (Sub-task 1 of 7 complete) |
| **2** | Workflow Command Restructuring | Pending |
| **3** | Search and Discovery | Pending |
| **4** | Remove Agent from SDK | Pending |
| **5** | Platform Capabilities (Draft Commands) | Pending |
| **6** | Cleanup and Documentation | Pending |

### Phase 1 Progress

**Sub-tasks** (from `/Users/suresh/.cursor/plans/phase_1_agent_yaml-first_8df4f33f.plan.md`):

| Sub-task | Description | Duration | Status |
|----------|-------------|----------|--------|
| 1 | Agent YAML Loader | 60-75 min | ✅ **COMPLETED** |
| 2 | Agent Schema Validator | 45-60 min | **NEXT** |
| 3 | Agent Applier & Display | 60-75 min | Pending |
| 4 | Agent Apply Command | 45-60 min | Pending |
| 5 | Validate + Get Commands | 60-75 min | Pending |
| 6 | List + Delete Commands | 45-60 min | Pending |
| 7 | Run Command | 75-90 min | Pending |

---

## Session Progress (2026-02-01)

### Completed
- ✅ Agent YAML Loader implementation (`loader.go`, 168 lines)
- ✅ Comprehensive test suite (`loader_test.go`, 367 lines, 12 test cases)
- ✅ BUILD.bazel updated with protovalidate dependency
- ✅ All tests passing via Bazel
- ✅ Changelog created documenting the work
- ✅ Enum text values fixed in tests (`skill` vs `43`, `mcp_server` vs `44`)

### Key Decisions
- **Protovalidate as single source of truth**: No manual validation in Go code
- **Strict unknown field rejection**: Catches typos early
- **Auto-detection**: `agent.yaml` or `AGENT.yaml` in current directory
- **Human-readable enums**: YAML uses text values, not numeric codes

### Files Created
```
client-apps/cli/internal/cli/agent/
├── loader.go          (NEW - 168 lines)
├── loader_test.go     (NEW - 367 lines)
└── BUILD.bazel        (MODIFIED)

_changelog/2026-02/
└── 2026-02-01-075912-agent-yaml-loader-foundation.md
```

---

## Next Steps

**Immediate** (Sub-task 2):
1. Create `validator.go` for cross-resource validation
2. Add reference validation (does skill/MCP server exist?)
3. Implement business logic checks beyond schema
4. Create comprehensive tests for validator

**Then** (Sub-task 3):
5. Create `applier.go` for gRPC apply flow
6. Create `display.go` for output formatting

---

## Context for Resume

**What works now**:
- Agent YAML files can be loaded and parsed
- Protovalidate automatically enforces all proto schema rules
- Tests verify file resolution, parsing, and validation

**What's needed next**:
- Cross-resource validation (does referenced skill exist?)
- Business logic validation beyond schema
- Integration with backend for apply operations

**Technical context**:
- Using `@build_buf_go_protovalidate//:protovalidate` dependency
- Pattern follows SDK's `agent/proto.go` validation approach
- Intentionally avoiding MCP Server loader's validation duplication

---

## Essential Files to Review

### 1. Revised Plan (AWAITING APPROVAL)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_2_revised_plan.md
```

### 2. Review Feedback (Completed)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_1_review.md
```

### 3. Original Plan (Superseded)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_0_plan.md
```

### 4. Design Decision
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md
```

---

## Reference Code

### MCP Server Apply Pattern (to mirror for Agent)
```
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root/mcpserver.go
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver/loader.go
/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver/apply.go
```

### Current SDK Agent (to be removed)
```
/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go/agent/agent.go
```

### Agent Proto Definition
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/apis/ai/stigmer/agentic/agent/v1/api.proto
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/apis/ai/stigmer/agentic/agent/v1/spec.proto
```

---

## Knowledge Folders

| Folder | Purpose |
|--------|---------|
| `design-decisions/` | Architectural choices (1 decision documented) |
| `coding-guidelines/` | Project-specific patterns |
| `wrong-assumptions/` | Corrected misconceptions |
| `dont-dos/` | Anti-patterns to avoid |
| `checkpoints/` | Milestone summaries |

---

## Resume Checklist

When starting a new session:

1. [ ] Read the revised plan: `tasks/T01_2_revised_plan.md`
2. [ ] Check if developer has approved (look for approval in conversation or `T01_3_approved.md`)
3. [ ] If approved, start execution from Phase 1
4. [ ] Review feedback if needed: `tasks/T01_1_review.md`

---

## Quick Commands

After loading context:
- "Approved" or "Start Phase 1" - Begin Agent YAML-First implementation
- "Show revised plan" - I'll show T01_2_revised_plan.md
- "Show project status" - Overview of progress
- "Create checkpoint" - Save current progress

---

*Last updated: 2026-02-01 07:59 PST*
*Status: Phase 1 in progress - Sub-task 1 complete, Sub-task 2 next*
