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
**Current Task**: Sub-task 4 - Agent Apply Command
**Status**: Sub-tasks 1-3 COMPLETED ✅

**Latest Session** (2026-02-01 - Session 3):
- ✅ Completed Sub-task 3: Agent Applier & Display
- Created applier.go (89 lines) for gRPC apply orchestration
- Created display.go (85 lines) for terminal output formatting
- Updated BUILD.bazel with cliprint, apiresource, and grpc dependencies
- Mirrors proven MCP Server pattern exactly
- All builds and tests pass (28 total tests)

**Previous Session** (2026-02-01 - Session 2):
- ✅ Completed Sub-task 2: Agent Schema Validator
- Enhanced proto validation (ApiResourceReference slug/org format rules)
- Implemented validator.go with cross-field validation (80 lines)
- Created comprehensive test suite (14 test functions, 28 total tests passing)
- Proto validation is single source of truth - Go only handles cross-field logic

**Session 1** (2026-02-01):
- ✅ Completed Sub-task 1: Agent YAML Loader
- Implemented loader.go with protovalidate as single source of truth
- Created comprehensive test suite (12 test cases, all passing)

**Key Achievement**: Strengthened proto validation at the source, minimal Go validation for cross-field business logic only

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
| **1** | Agent YAML-First Foundation | **IN PROGRESS** (Sub-tasks 1-3 of 7 complete) |
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
| 2 | Agent Schema Validator | 45-60 min | ✅ **COMPLETED** |
| 3 | Agent Applier & Display | 60-75 min | ✅ **COMPLETED** |
| 4 | Agent Apply Command | 45-60 min | **NEXT** |
| 5 | Validate + Get Commands | 60-75 min | Pending |
| 6 | List + Delete Commands | 45-60 min | Pending |
| 7 | Run Command | 75-90 min | Pending |

---

## Session Progress (2026-02-01 Session 3)

### Completed
- ✅ Created `applier.go` with ApplyOptions, ApplyResult types and Apply function
- ✅ Created `display.go` with DisplayApplyResult, DisplayAgentPreview, and display helpers
- ✅ Updated BUILD.bazel with new source files and dependencies
- ✅ Bazel build successful
- ✅ All 28 tests passing
- ✅ Changelog created: `2026-02-01-091708-agent-applier-display-foundation.md`
- ✅ Committed: `feat(cli/agent): add applier and display components`

### Key Implementation
- **applier.go** (89 lines): Mirrors MCP Server pattern
  - Input validation, metadata initialization
  - Dry-run handling with preview
  - Create vs update detection
  - gRPC call via AgentCommandControllerClient.Apply()
  
- **display.go** (85 lines): Agent-specific output formatting
  - DisplayApplyResult() for success messages
  - DisplayAgentPreview() for dry-run mode
  - Shows name, description, instructions (truncated), counts for MCP servers/skills/sub-agents

### Files Created/Modified
```
client-apps/cli/internal/cli/agent/
├── applier.go        (NEW - 89 lines)
├── display.go        (NEW - 85 lines)
└── BUILD.bazel       (MODIFIED - added cliprint, apiresource, grpc deps)

_changelog/2026-02/
└── 2026-02-01-091708-agent-applier-display-foundation.md (NEW)
```

## Session Progress (2026-02-01 Session 2)

### Completed
- ✅ Enhanced `ApiResourceReference` proto with slug/org format validation
- ✅ Added pattern validation: `^[a-z][a-z0-9-]*$` (must start with letter)
- ✅ Added length constraints: 1-63 characters
- ✅ Removed reserved field (no backward compat needed)
- ✅ Agent validator implementation (`validator.go`, 180 lines)
- ✅ Cross-field validation: unique mcp_server_usages, SubAgent mcp_access references
- ✅ Comprehensive test suite (`validator_test.go`, 250 lines, 14 test functions)
- ✅ All 28 tests passing (14 loader + 14 validator)

### Key Decisions
- **Proto validations strengthened at source**: org/slug format rules belong in proto
- **No duplication of proto rules**: Go code only validates cross-field business logic
- **Actionable error messages**: Each error includes guidance on how to fix
- **SubAgent tool subset validation**: Enforces permission inheritance model

### Files Created/Modified
```
apis/ai/stigmer/commons/apiresource/
└── io.proto           (MODIFIED - added validation rules)

client-apps/cli/internal/cli/agent/
├── validator.go       (NEW - 180 lines)
├── validator_test.go  (NEW - 250 lines)
└── BUILD.bazel        (MODIFIED - added validator files)

apis/stubs/             (REGENERATED via make protos)
```

## Session Progress (2026-02-01 Session 1)

### Completed
- ✅ Agent YAML Loader implementation (`loader.go`, 168 lines)
- ✅ Comprehensive test suite (`loader_test.go`, 367 lines, 12 test cases)
- ✅ BUILD.bazel updated with protovalidate dependency
- ✅ All tests passing via Bazel
- ✅ Enum text values fixed in tests (`skill` vs `43`, `mcp_server` vs `44`)

### Key Decisions
- **Protovalidate as single source of truth**: No manual validation in Go code
- **Strict unknown field rejection**: Catches typos early
- **Auto-detection**: `agent.yaml` or `AGENT.yaml` in current directory
- **Human-readable enums**: YAML uses text values, not numeric codes

---

## Next Steps

**Immediate** (Sub-task 4):
1. Create `cmd/stigmer/root/agent.go` command group with aliases
2. Implement `newAgentApplyCommand()` subcommand
3. Create `executeAgentApply()` orchestration function
4. Wire up: loader → validator → applier → display flow
5. Add flags: `--org`, `--dry-run`
6. Register agent command in root.go

**Then** (Sub-task 5):
7. Add `stigmer agent validate` command (load + validate without backend)
8. Add `stigmer agent get` command (parse reference, fetch via gRPC)
9. Support output formats: table, yaml, json

---

## Context for Resume

**What works now**:
- Agent YAML files can be loaded and parsed (loader.go)
- Protovalidate enforces proto schema rules + Go validates cross-field logic (validator.go)
- gRPC apply flow ready (applier.go)
- Terminal output formatting complete (display.go)
- All building blocks ready for command layer

**What's needed next**:
- Agent command group in cmd/stigmer/root/
- Wire up loader → validator → applier flow in command handlers
- Add remaining CRUD commands (get, list, delete, run)

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

*Last updated: 2026-02-01 (Session 3)*
*Status: Phase 1 in progress - Sub-tasks 1-3 complete (43% done), Sub-task 4 next*
