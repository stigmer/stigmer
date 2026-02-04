---
name: Phase 4 Project Entity Revised
overview: Complete the Project entity as a true aggregate root - add resource fields to ProjectSpec (agents, workflows, mcp_servers, skills), then finish CLI tasks (T04.5-T04.7). Project contains all managed resources; backend handles orchestration and reconciliation.
todos:
  - id: T04.1a
    content: Project Command/Query Services - command.proto and query.proto
    status: completed
  - id: T04.1b
    content: Update ProjectSpec - Add agents, workflows, mcp_servers, skills repeated fields
    status: completed
  - id: T04.5
    content: Track Detection Logic - Create detect.go with walk-up algorithm for stigmer.yaml discovery
    status: pending
  - id: T04.6
    content: Project Command Group - Create project.go with info and validate subcommands
    status: pending
  - id: T04.7
    content: Integration and Documentation - End-to-end testing, example stigmer.yaml
    status: pending
isProject: false
---

# Phase 4: Project Entity - Revised Plan

## Architectural Context

The Project entity is the **aggregate root** for resource lifecycle management. Based on DDD principles:

- **Spec = Desired State** - The resources (agents, workflows, etc.) ARE the Project's spec
- **Backend Orchestration** - ProjectCommandController.Apply handles all resource operations
- **CLI is Thin Adapter** - Loads YAML, runs SDK, calls Apply(Project), displays results

This follows the Terraform/Pulumi model where the Project is the "state manager" for its resources.

---

## Domain Model

```
Project (Aggregate Root)
├── metadata
│   ├── name
│   ├── org
│   └── ...
├── spec (Desired State)
│   ├── runtime (go, python, node)
│   ├── entry_point (main.go)
│   ├── description
│   ├── agents[]        ← Full Agent resources
│   ├── workflows[]     ← Full Workflow resources
│   ├── mcp_servers[]   ← Full McpServer resources
│   └── skills[]        ← Full Skill resources (code pushed separately)
└── status (System-managed)
    ├── audit
    └── reconciliation (summary of last apply)
```

---

## Resource Handling

### Agents, Workflows, MCP Servers

These are embedded directly in ProjectSpec:

```
CLI Flow:
  1. CLI loads stigmer.yaml → Project shell (name, runtime, entry_point)
  2. CLI runs entry_point → SDK populates project.spec.agents/workflows/mcp_servers
  3. CLI calls ProjectCommandController.Apply(Project)
  4. Backend reconciles all resources (create/update/delete)
  5. Backend returns Project with IDs populated
```

### Skills (Special Handling)

Skills have binary code that must be pushed separately:

```
CLI Flow:
  1. SDK defines skill (name, code path, etc.)
  2. CLI pushes skill code → SkillCommandController.Push(code) → returns Skill with ID
  3. CLI adds returned Skill to project.spec.skills
  4. CLI calls ProjectCommandController.Apply(Project)
  5. Backend reconciles (skill already exists, just validates reference)
```

**Why separate push?**
- Skill code is binary/archive, not YAML
- Code upload is a separate concern from manifest application
- Backend stores skill code in artifact storage, not in Project proto

---

## Reconciliation Algorithm (Backend)

When `ProjectCommandController.Apply(Project)` is called:

```
APPLY(project):
  # 1. Get current state
  existingResources = DB.getResourcesByProject(project.org, project.name)
  
  # 2. Compute dependency graph
  #    - MCP Servers first (no dependencies)
  #    - Agents second (may depend on MCP Servers)
  #    - Workflows third (may depend on Agents)
  #    - Skills are pre-pushed, just validate references
  
  # 3. Reconcile each resource type (in dependency order)
  for mcp_server in project.spec.mcp_servers:
    createOrUpdate(mcp_server)
  
  for agent in project.spec.agents:
    createOrUpdate(agent)
  
  for workflow in project.spec.workflows:
    createOrUpdate(workflow)
  
  # 4. Delete orphans (in reverse dependency order)
  for existing in existingResources:
    if not in project.spec.*:
      delete(existing)
  
  # 5. Update project status
  project.status.reconciliation = {
    last_reconciled_at: now(),
    result: SUCCESS,
    manifest_hash: hash(project.spec),
    resource_counts: {...}
  }
  
  # 6. Save and return
  save(project)
  return project  # With IDs populated
```

---

## Current Progress

| Task   | Description                                        | Status      |
|--------|---------------------------------------------------|-------------|
| T04.1  | Project Proto Schema (api, spec, status, enum, io) | COMPLETED   |
| T04.1a | Project Command/Query Services                     | COMPLETED   |
| T04.2  | Project Loader Foundation                          | COMPLETED   |
| T04.3  | Project Validator (Cross-Field)                    | COMPLETED   |
| T04.4  | Project Display                                    | COMPLETED   |

---

## Remaining Tasks

### T04.1b: Update ProjectSpec with Resource Fields (~45 min)

**Goal**: Add repeated resource fields to ProjectSpec so Project becomes the true aggregate root.

**File to Modify**: [apis/ai/stigmer/agentic/project/v1/spec.proto](apis/ai/stigmer/agentic/project/v1/spec.proto)

**Changes**:

```protobuf
syntax = "proto3";

package ai.stigmer.agentic.project.v1;

import "ai/stigmer/agentic/project/v1/enum.proto";
import "ai/stigmer/agentic/agent/v1/api.proto";
import "ai/stigmer/agentic/workflow/v1/api.proto";
import "ai/stigmer/agentic/mcpserver/v1/api.proto";
import "ai/stigmer/agentic/skill/v1/api.proto";
import "buf/validate/validate.proto";

message ProjectSpec {
  // SDK runtime for resource synthesis.
  ProjectRuntime runtime = 1 [
    (buf.validate.field).required = true,
    (buf.validate.field).enum = {defined_only: true, not_in: [0]}
  ];

  // Entry point file for SDK synthesis.
  string entry_point = 2;

  // Human-readable description of the project.
  string description = 3;

  // ============================================================
  // Managed Resources
  // These are the resources that will be reconciled on apply.
  // ============================================================

  // Agents managed by this project.
  // On apply, backend creates/updates/deletes agents to match this list.
  repeated ai.stigmer.agentic.agent.v1.Agent agents = 10;

  // Workflows managed by this project.
  // On apply, backend creates/updates/deletes workflows to match this list.
  repeated ai.stigmer.agentic.workflow.v1.Workflow workflows = 11;

  // MCP Servers managed by this project.
  // On apply, backend creates/updates/deletes MCP servers to match this list.
  repeated ai.stigmer.agentic.mcpserver.v1.McpServer mcp_servers = 12;

  // Skills managed by this project.
  // Skills require code push before apply (handled by CLI).
  // On apply, backend validates skill references exist.
  repeated ai.stigmer.agentic.skill.v1.Skill skills = 13;
}
```

**Steps**:

1. Add imports for Agent, Workflow, McpServer, Skill protos
2. Add repeated fields for each resource type (field numbers 10-13)
3. Add clear documentation explaining reconciliation behavior
4. Run `make protos` to regenerate stubs
5. Verify Go/Python stubs include new fields

**Note**: This may require updating the project loader/validator to handle the new fields.

---

### T04.5: Track Detection Logic (~60 min)

**Goal**: Determine whether CLI operates in Atomic Track or Project Track.

**Files to Create**:

- [client-apps/cli/internal/cli/project/detect.go](client-apps/cli/internal/cli/project/detect.go) (~120 lines)
- [client-apps/cli/internal/cli/project/detect_test.go](client-apps/cli/internal/cli/project/detect_test.go) (~220 lines)

**Two Tracks Only** (no legacy):

| Track | Condition | CLI Behavior |
|-------|-----------|--------------|
| Atomic | No stigmer.yaml found | `stigmer agent apply agent.yaml` → direct resource apply |
| Project | Valid stigmer.yaml found | `stigmer apply` → SDK synthesis → Project apply |

**Types**:

```go
type Track string

const (
    TrackAtomic  Track = "atomic"   // No stigmer.yaml, apply resources directly
    TrackProject Track = "project"  // Valid stigmer.yaml, use Project workflow
)

type DetectOptions struct {
    StartDir     string  // Directory to start detection (default: cwd)
    ResourceFile string  // Optional resource file (detection starts from its dir)
    MaxDepth     int     // Max levels to walk up (default: 10)
}

type DetectResult struct {
    Track      Track
    ConfigPath string  // Path to stigmer.yaml (empty for Atomic)
    ConfigDir  string  // Directory containing stigmer.yaml (empty for Atomic)
}

func DetectTrack(opts *DetectOptions) (*DetectResult, error)
```

**Walk-Up Algorithm**:

1. Start from StartDir or ResourceFile's parent directory
2. Check for `stigmer.yaml` (lowercase only)
3. If found, validate it has correct `apiVersion` and `kind`
4. If valid → TrackProject; if invalid → error with clear message
5. If not found, walk up to parent (max 10 levels)
6. If root reached without finding → TrackAtomic

---

### T04.6: Project Command Group (~75 min)

**Goal**: CLI commands for local and remote project management.

**Files to Create/Modify**:

- [client-apps/cli/cmd/stigmer/root/project.go](client-apps/cli/cmd/stigmer/root/project.go) (~250 lines)
- Update [root.go](client-apps/cli/cmd/stigmer/root/root.go) to register project command

**Command Structure**:

```
stigmer project (alias: proj)
  info       Display project configuration (local - reads stigmer.yaml)
  validate   Validate stigmer.yaml without deploying (local)
  get        Get project from backend (remote)
  apply      Apply project to backend (remote - requires SDK execution)
  delete     Delete project from backend (remote)
```

**Local Commands** (T04.6):
- `info` - Reads stigmer.yaml, displays configuration
- `validate` - Validates stigmer.yaml structure

**Remote Commands** (Phase 5):
- `get`, `apply`, `delete` - Communicate with backend

---

### T04.7: Integration and Documentation (~60 min)

**Goal**: End-to-end validation and documentation.

**Tasks**:

1. Create `examples/project/stigmer.yaml` with valid Project format
2. Test `stigmer project info` and `stigmer project validate`
3. Test track detection with various directory structures
4. Update `next-task.md` for Phase 5
5. Create changelog entry

---

## Architecture After This Phase

```
apis/ai/stigmer/agentic/project/v1/
  api.proto       # Project message
  spec.proto      # ProjectSpec with agents/workflows/mcp_servers/skills
  status.proto    # ProjectStatus (reconciliation state)
  enum.proto      # ProjectRuntime enum
  io.proto        # ProjectId wrapper
  command.proto   # ProjectCommandController (apply/create/update/delete)
  query.proto     # ProjectQueryController (get/getByReference)
```

---

## Phase 5 Preview (Backend + Full CLI Integration)

After Phase 4 completes, Phase 5 will:

1. Implement `ProjectCommandController` in backend (orchestration logic)
2. Implement `ProjectQueryController` in backend
3. Implement CLI `stigmer apply` command (run SDK, call backend)
4. Implement CLI `stigmer project get/delete` commands
5. Implement skill push flow in CLI

---

## Engineering Standards

- ProjectSpec.resources use field numbers 10+ (reserved for future expansion)
- No legacy/backward compatibility - invalid configs are errors
- Backend handles all orchestration (CLI is thin adapter)
- Skills require code push before project apply
- All proto files follow existing patterns exactly
