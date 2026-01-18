# Next Task

**Last Updated**: January 19, 2026: 20260118.03.open-source-stigmer

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260118.03.open-source-stigmer

**Description**: Transition Stigmer from proprietary to Open Core architecture by open sourcing the execution plane (CLI, Runners, SDK) under Apache 2.0 while keeping the control plane proprietary. Includes migration from leftbin/stigmer to stigmer/stigmer organization.
**Goal**: Implement Backend Abstraction Layer with Protobuf interfaces, create BadgerDB-based local backend, refactor all execution components to work with both local and cloud backends seamlessly, and migrate codebase to new stigmer/stigmer repository.
**Tech Stack**: Go (CLI, Workflow Runner), Python (Agent Runner), Protocol Buffers, BadgerDB, Temporal
**Components**: CLI (stigmer-sdk/go/stigmer/), Workflow Runner (stigmer-sdk/go/workflow/), Agent Runner (stigmer-sdk/go/agent/), Backend interfaces (new protobuf), Storage layer (BadgerDB), Repository migration (leftbin/* → stigmer/stigmer)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/wrong-assumptions/` and `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/_projects/2026-01/20260118.03.open-source-stigmer/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-01-18 03:35
**Phase**: Phase 3 - CLI Implementation In Progress  
**Status**: ✅ Build infrastructure complete, ready for feature migration
**Last Updated**: 2026-01-19 04:04

## Latest Accomplishment

✅ **CLI Build Infrastructure** (2026-01-19 04:04)
- Fixed proto import paths (`apis/stubs/go/`)
- Configured module dependencies (SDK, protobuf stubs)
- Enhanced cliprint with colored output and progress display
- Fixed API mismatches (AgentId.Value, Description in Spec)
- CLI builds successfully
- Ready for Cloud CLI feature migration
- Blocker resolved: proto imports now correct

Previous: ✅ **Cursor Rules Infrastructure** (2026-01-18)
- Renamed 15 Cloud rules to include "cloud" suffix
- Created 15 OSS rules with "oss" suffix
- Completely rewrote backend handler rule for Go patterns
- Updated all internal references in both repositories
- Established clear naming convention for multi-workspace development
- Enables independent Cloud and OSS workflow evolution

Previous: ✅ **Resource Tier ADR Implementation** (2026-01-18)
- Implemented ADR-003: Unified API Resource Registry & Tiering
- Removed org/owner_scope from ApiResourceMetadata
- Added ResourceTier enum (TIER_OPEN_SOURCE, TIER_CLOUD_ONLY)
- Applied tier annotations to all 19 resource kinds
- Enables Open Core model with zero migration friction

Previous: ✅ **Backend Services Implementation** (2026-01-19)
- Created stigmer-server (Go gRPC API server)
- Implemented SQLite generic resource storage (ADR-007)
- Built gRPC server utilities library
- Copied agent-runner and workflow-runner from cloud
- Implemented Agent controller with full CRUD
- Updated architecture documentation

## Phase 3: Next Priorities

**1. Proto Regeneration and Validation**
- Run `make protos` in stigmer repo to regenerate bindings
- Verify generated Go code compiles without errors
- Update backend controllers for new metadata schema
- Test resource CRUD operations

**2. CLI Integration with stigmer-server**
- Update CLI to use stigmer-server instead of internal/backend
- Implement in-process gRPC adapter
- Add tier-based resource filtering (local vs cloud mode)
- Add local mode initialization
- Test end-to-end agent creation

**3. Additional Resource Controllers**
- Workflow controller (create, update, delete, get, list)
- Skill controller
- Environment controller
- Session controller

**4. Import Path Updates**
- Update agent-runner imports to use stigmer repo paths
- Update workflow-runner imports to use stigmer repo paths
- Remove stigmer-cloud references

**5. Integration Testing**
- End-to-end tests with all three services
- Agent execution flow test
- Workflow execution flow test
- Tier filtering validation

**Phase 2 Complete**: ✅  
**ADR-003 Implementation**: ✅

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
