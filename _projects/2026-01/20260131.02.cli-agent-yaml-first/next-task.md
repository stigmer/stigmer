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

**Phase**: Planning / Review
**Current Task**: T01 - Complete Implementation Plan
**Status**: PENDING DEVELOPER REVIEW

---

## Key Design Decision

**Agent becomes YAML-first** (like MCP Server):
- Agent is declarative configuration, not orchestration
- Enables agent-assisted creation (agents creating agents)
- SDK remains for Workflow only (requires implicit dependency tracking)

See: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md`

---

## Target CLI Structure

```
stigmer
├── skill
│   ├── push, get, list, delete
│   └── create                    # Agentic creation
├── mcpserver
│   ├── apply, get, list, delete
│   └── create                    # Agentic creation
├── agent                         # NEW resource commands
│   ├── apply <file>              # YAML-based (like mcpserver)
│   ├── get, list, delete
│   ├── create                    # Agentic creation
│   └── run <slug>                # Execute agent
├── workflow
│   ├── apply                     # SDK synthesis (renamed from root)
│   ├── get, list, delete
│   ├── create                    # Agentic creation
│   └── run <slug>                # Execute workflow
```

**Removed**: Root `apply`, `run`, `new` commands

---

## Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1** | Agent YAML-First Foundation | Pending |
| **2** | Workflow Command Restructuring | Pending |
| **3** | Remove Agent from SDK | Pending |
| **4** | Agentic Creation Commands | Pending |
| **5** | Cleanup and Documentation | Pending |

---

## Essential Files to Review

### 1. Current Task Plan (NEEDS REVIEW)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/tasks/T01_0_plan.md
```

### 2. Design Decision
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/design-decisions/001-agent-yaml-first-architecture.md
```

### 3. Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260131.02.cli-agent-yaml-first/README.md
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

1. [ ] Read the task plan: `tasks/T01_0_plan.md`
2. [ ] Review design decision: `design-decisions/001-agent-yaml-first-architecture.md`
3. [ ] Check if developer has provided feedback (look for `T01_1_review.md`)
4. [ ] If approved, check for `T01_2_revised_plan.md` or proceed to execution

---

## Quick Commands

After loading context:
- "Review the task plan" - I'll show T01_0_plan.md
- "Continue with Phase 1" - Start Agent YAML-First implementation
- "Show project status" - Overview of progress
- "Create checkpoint" - Save current progress

---

*Last updated: 2026-01-31*
*Status: Awaiting plan review*
