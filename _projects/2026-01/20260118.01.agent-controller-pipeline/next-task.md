# Next Task - Agent Controller Pipeline

**Project:** Agent Controller Pipeline Framework  
**Location:** `_projects/2026-01/20260118.01.agent-controller-pipeline/`  
**Last Updated:** 2026-01-18

## Current Status

✅ **All Core Tasks Complete** - Pipeline framework with agent instance creation  
✅ **In-Process gRPC Implemented** - Downstream client pattern for cross-domain calls  
✅ **Agent Creation Complete** - Steps 1-7 fully implemented and building  
✅ **Framework Enhanced** - Auto-extract API resource kind from proto (zero boilerplate)  
✅ **Architecture Documented** - OSS vs Cloud pipeline differences clarified  
✅ **Query Handlers Refactored** - Generic pipeline steps for Get/GetByReference

## Project Status

🎉 **PHASE 1-9.2 COMPLETE** 🎉

**Latest:** Generic query handler pipeline steps - reusable LoadTargetStep and LoadByReferenceStep  
**Next:** Apply pattern to Workflow, Task, and other resources

## What Was Accomplished (Phase 9.2)

### ✅ Generic Query Handler Pipeline Steps

**Location**: `backend/libs/go/grpc/request/pipeline/steps/`, `backend/services/stigmer-server/pkg/controllers/agent/`

**What changed**:
- Deleted monolithic `query.go` (75 lines with both Get and GetByReference)
- Created separate handler files: `get.go` (44 lines) and `get_by_reference.go` (47 lines)
- Created generic `LoadTargetStep` pipeline step - loads resource by ID
- Created generic `LoadByReferenceStep` pipeline step - loads resource by slug/reference
- Comprehensive unit tests for both new pipeline steps
- Created `README.md` documenting patterns and migration guide

**Why it matters**:
- **100% Reusable**: Works for ANY resource - just change type parameters
- **Zero Duplication**: Future resources (Workflow, Task) use same pipeline steps
- **Consistent Architecture**: All handlers (create, update, delete, apply, get, getByReference) use pipelines
- **Better Organization**: Each file handles ONE operation (< 50 lines)

**Generic Pattern** (works for all resources):
```go
// Agent
LoadTargetStep[*AgentId, *Agent]
LoadByReferenceStep[*Agent]

// Workflow (future)
LoadTargetStep[*WorkflowId, *Workflow]
LoadByReferenceStep[*Workflow]
```

**Bug Fixes**:
- Fixed `grpclib.InternalError` calls in apply.go and delete.go
- Updated delete.go to use proper `store.Store` interface

**See**: `@checkpoints/2026-01-18-generic-query-handler-pipeline-steps.md`

## Previous Accomplishments (Phase 9.1)

### ✅ OSS Pipeline Architecture Documentation

**Location**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`, `_rules/implement-stigmer-oss-handlers/`

**What changed**:
- Updated Agent create handler documentation (12 steps → 7 steps)
- Removed TODOs for steps that won't be implemented in OSS
- Added explicit architectural comparison note
- Enhanced implementation rule with "Pipeline Steps: Cloud vs OSS" section

**Why it matters**:
- **Prevents confusion**: No more wondering when auth/IAM will be added (answer: never in OSS)
- **Clear template**: All future controllers know exactly which steps to implement
- **Architectural clarity**: OSS = local/single-user (7 steps), Cloud = enterprise (12 steps)

**OSS Pipeline Template** (for all controllers):
1. ValidateFieldConstraints
2. ResolveSlug
3. CheckDuplicate
4. BuildNewState
5. Persist
6. Custom business logic steps (if needed)

**Excluded from OSS** (with rationale):
- Authorize (no multi-tenant auth)
- CreateIamPolicies (no IAM/FGA)
- Publish (no event publishing)
- TransformResponse (no response filtering)

**See**: `@checkpoints/2026-01-18-document-oss-pipeline-differences.md`

## Previous Accomplishments (Phase 9)

### ✅ Automatic API Resource Kind Extraction

**Location**: `backend/libs/go/grpc/interceptors/apiresource/`

**What it does**:
- gRPC interceptor extracts `api_resource_kind` from proto service descriptors
- Injects kind into request context automatically
- Eliminates manual kind specification in controllers

**Benefits**:
- **Zero boilerplate**: Controllers no longer specify kind manually
- **Framework-level**: Works for all controllers automatically
- **Aligned with Java**: Mirrors `RequestMethodMetadataRegistry` approach
- **5-7 lines eliminated** per controller

**Before**:
```go
kind := apiresourcekind.ApiResourceKind_agent
steps.NewPersistStep[*agentv1.Agent](c.store, kind)
```

**After**:
```go
// Kind extracted automatically from proto!
steps.NewPersistStep[*agentv1.Agent](c.store)
```

**Controllers simplified**:
- Agent controller (`create.go`, `update.go`)
- AgentInstance controller (`create.go`)

## Latest Checkpoint

**See**: `@checkpoints/2026-01-18-generic-query-handler-pipeline-steps.md`

## Previous Accomplishments (Phase 8)

### ✅ Agent Instance Controller Created

**Location**: `backend/services/stigmer-server/pkg/controllers/agentinstance/`

- Complete gRPC controller with create pipeline
- Standard 5-step pipeline (Validate → ResolveSlug → CheckDuplicate → SetDefaults → Persist)
- Comprehensive documentation

### ✅ In-Process gRPC Client Implemented

**Location**: `backend/services/stigmer-server/pkg/downstream/agentinstance/`

- Downstream client for cross-domain calls
- Zero-overhead direct controller invocation
- Aligned with Java's `AgentInstanceGrpcRepoImpl` pattern (adapted for Go)

### ✅ Agent Pipeline Steps 8-9 Complete

**Location**: `backend/services/stigmer-server/pkg/controllers/agent/create.go`

- **Step 8**: CreateDefaultInstance - Automatic instance creation via downstream client
- **Step 9**: UpdateAgentStatusWithDefaultInstance - Status update and persistence

### ✅ Store Interface Updated

**Location**: `backend/libs/go/store/interface.go`

- Updated for BadgerDB "Kind/ID" key pattern
- Added `kind` parameter to GetResource and DeleteResource
- Fixed all agent controller methods (delete.go, query.go)

### ✅ Integration Complete

**Location**: `backend/services/stigmer-server/cmd/server/main.go`

- Wired AgentInstance controller
- Created and injected downstream client
- All components integrated and building successfully

**See**: `@checkpoints/2026-01-18-in-process-grpc-agent-instance-creation.md`

## Agent Creation Flow (Now Complete)

```
User creates Agent
  ↓
Steps 1-5: Validate → ResolveSlug → CheckDuplicate → SetDefaults → Persist
  ↓
Step 8: CreateDefaultInstance
  ├─ Build default instance request
  ├─ Call downstream client (in-process)
  ├─ AgentInstance pipeline executes
  └─ Store instance ID in context
  ↓
Step 9: UpdateAgentStatusWithDefaultInstance
  ├─ Read instance ID from context
  ├─ Update agent.status.default_instance_id
  └─ Persist updated agent
  ↓
Return Agent with default_instance_id populated
```

## Next Tasks

### 1. Apply Query Handler Pattern to Other Resources 🎯 IMMEDIATE

**Goal**: Demonstrate pattern reusability

**Steps**:
1. Implement Workflow Get/GetByReference using the generic pattern
2. Implement Task Get/GetByReference using the same pattern
3. Verify no modifications needed to pipeline steps
4. Confirm pattern is truly reusable

**Pattern** (copy-paste for each resource):
```go
// get.go
pipeline.NewPipeline[*ResourceId]("resource-get").
    AddStep(steps.NewValidateProtoStep[*ResourceId]()).
    AddStep(steps.NewLoadTargetStep[*ResourceId, *Resource](c.store)).
    Build()

// get_by_reference.go
pipeline.NewPipeline[*ApiResourceReference]("resource-get-by-reference").
    AddStep(steps.NewValidateProtoStep[*ApiResourceReference]()).
    AddStep(steps.NewLoadByReferenceStep[*Resource](c.store)).
    Build()
```

### 2. Integration Testing

**Goal**: Verify agent creation works end-to-end

**Test Steps**:
1. Start stigmer-server
2. Create agent via gRPC: `stigmer agent create --name test-agent`
3. Verify default instance created in BadgerDB
4. Verify agent.status.default_instance_id populated
5. Query default instance: should be `test-agent-default`

### 3. Implement Remaining AgentInstance Operations

**Goal**: Complete CRUD operations

**Operations Needed**:
- Get (by ID) - Query single instance
- GetByAgent (all instances for an agent) - List instances
- GetByReference (by slug) - Friendly lookup
- Update (full state replacement) - Modify instance
- Delete - Remove instance

**Reference**: 
- `apis/ai/stigmer/agentic/agentinstance/v1/query.proto`
- `apis/ai/stigmer/agentic/agentinstance/v1/command.proto`

### 4. Add Agent Query Methods (Future)

**Goal**: Support advanced queries

**Methods**:
- ListByOrg (when org support added)
- GetBySlug (for friendly lookups)
- Advanced filtering (when needed)

## Documentation Created

- `docs/adr/20260118-214000-in-process-grpc-calls-and-agent-instance-creation.md`
- `pkg/controllers/agentinstance/README.md`
- `pkg/downstream/agentinstance/README.md`
- `backend/libs/go/grpc/interceptors/apiresource/` (with comprehensive documentation)
- `_rules/implement-stigmer-oss-handlers/` - Enhanced with OSS vs Cloud pipeline comparison

## Build Status

✅ `go build ./...` - All code compiles successfully

---

**Previous work documented below...**

## Previous Accomplishments

### Phase 7.3: BadgerDB Schema Cleanup ✅
**See**: `@checkpoints/2026-01-18-badger-schema-cleanup.md`

### Phase 7.2: Inline Agent Pipeline Steps ✅
**See**: `@checkpoints/2026-01-18-inline-agent-pipeline-steps.md`

### Phase 7.1: Validation Step Integration ✅
**See**: `@checkpoints/2026-01-18-validation-step-added.md`

### Phase 7: Go Package Structure Refactoring ✅
**See**: `@checkpoints/2026-01-18-go-package-structure-refactoring.md`

### Phase 6: BadgerDB Migration & Cloud Alignment ✅
**See**: `@checkpoints/2026-01-18-badgerdb-migration-complete.md`

## Project Documentation

- **Latest Checkpoint:** `@checkpoints/2026-01-18-generic-query-handler-pipeline-steps.md`
- **Latest Changelog:** `@_changelog/2026-01/2026-01-18-224250-refactor-agent-query-handlers-generic-pipeline-steps.md`
- **Previous Checkpoint:** `@checkpoints/2026-01-18-document-oss-pipeline-differences.md`
- **Previous Changelog:** `@_changelog/2026-01/2026-01-18-211338-document-oss-pipeline-differences.md`
- **API Resource Interceptor:** `@backend/libs/go/grpc/interceptors/apiresource/`
- **Latest ADR:** `@docs/adr/20260118-214000-in-process-grpc-calls-and-agent-instance-creation.md`
- **AgentInstance Controller:** `@backend/services/stigmer-server/pkg/controllers/agentinstance/README.md`
- **Downstream Client:** `@backend/services/stigmer-server/pkg/downstream/agentinstance/README.md`
- **Agent Controller:** `@backend/services/stigmer-server/pkg/controllers/agent/README.md`
- **Pipeline Framework:** `@backend/libs/go/grpc/request/pipeline/README.md`
- **Project README:** `@_projects/2026-01/20260118.01.agent-controller-pipeline/README.md`
