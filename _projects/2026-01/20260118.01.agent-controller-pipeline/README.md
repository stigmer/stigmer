# Agent Controller Pipeline Framework

**Created:** 2026-01-18  
**Status:** Phase 7.2 Complete - Inline Steps Refactoring (58% Cloud Parity, Java Pattern Aligned)  
**Timeline:** Multi-day iterative implementation

## Project Description

Implement a comprehensive pipeline framework for the Stigmer OSS agent controller, bringing feature parity with the Java-based Stigmer Cloud implementation. This includes request processing pipelines, OpenTelemetry integration, proto validation, slug resolution, audit tracking, and automated default instance creation.

## Primary Goal

Transform the current monolithic Go agent controller into a robust, maintainable pipeline-based architecture that matches the enterprise-grade patterns used in Stigmer Cloud, while keeping it suitable for local/OSS deployment.

## Technology Stack

- **Language:** Go
- **Framework:** gRPC, Protobuf
- **Observability:** OpenTelemetry (placeholder/no-op initially)
- **Storage:** SQLite with JSON
- **Validation:** protovalidate-go (buf.build/validate)

## Project Type

- Feature Development (60%)
- Refactoring (40%)

## Affected Components

Primary:
- `backend/services/stigmer-server/pkg/controllers/agent_controller.go`

New Components to Create:
- `backend/services/stigmer-server/pkg/pipeline/` - Pipeline framework
- `backend/services/stigmer-server/pkg/pipeline/steps/` - Common pipeline steps
- `backend/services/stigmer-server/pkg/controllers/steps/` - Agent-specific steps
- `backend/libs/go/telemetry/` - OpenTelemetry wrappers (no-op initially)

## Success Criteria

1. **Pipeline Framework Implemented**
   - Generic pipeline builder with step execution
   - Context passing between steps
   - Error handling and rollback support
   - OpenTelemetry span tracking (even if no-op)

2. **Agent Create Handler Feature Complete**
   - Proto validation using buf.build/validate
   - Slug resolution from name
   - Duplicate checking by slug (not just ID)
   - Audit fields (created_at, updated_at, version)
   - Default agent instance creation
   - Agent status update with default_instance_id
   - All steps traceable via telemetry

3. **Code Quality**
   - Single Responsibility Principle enforced
   - Files under 250 lines
   - Functions under 50 lines
   - Proper error wrapping with context
   - Interface-based abstractions

4. **Testing**
   - Unit tests for pipeline framework
   - Integration tests for agent creation flow
   - Error case handling verified

## Implementation Phases

### Phase 1: Pipeline Framework Foundation ✅ COMPLETE
- ✅ Generic pipeline builder with fluent API
- ✅ PipelineStep[T] interface and execution
- ✅ RequestContext[T] with metadata passing
- ✅ PipelineError structured error handling
- ✅ OpenTelemetry integration (no-op tracer)
- ✅ Comprehensive unit tests (100% core coverage)
- ✅ Complete documentation (3 READMEs)
- **Completed:** 2026-01-18
- **Files Created:** 6 implementation, 4 tests, 3 docs
- **See:** `tasks/T01_1_completed.md`

### Phase 2: Common Steps Library ✅ COMPLETE
- ✅ Slug resolution step
- ✅ Duplicate check step
- ✅ Set defaults step (ID, kind, timestamps)
- ✅ Persistence step
- ✅ Store interface abstraction
- **Completed:** 2026-01-18
- **See:** `tasks/T02_1_partial.md`

### Phase 3: Architecture Alignment ✅ COMPLETE
- ✅ Moved pipeline to `backend/libs/go/grpc/request/pipeline/`
- ✅ Matches Java structure
- ✅ Documentation updated
- **Completed:** 2026-01-18

### Phase 4: Agent Controller Integration ✅ COMPLETE
- ✅ Integrated Create pipeline
- ✅ Integrated Update pipeline
- ✅ Removed inline logic
- ✅ Applied pure pipeline pattern
- **Completed:** 2026-01-18
- **See:** `tasks/T03_complete.md`

### Phase 5: Pure Pipeline Refactoring ✅ COMPLETE
- ✅ Removed all manual validations
- ✅ Removed manual proto cloning
- ✅ Thin orchestrator pattern
- ✅ 55% code reduction
- **Completed:** 2026-01-18
- **See:** `checkpoints/2026-01-18-controller-refactoring-complete.md`

### Phase 6: BadgerDB Migration & Cloud Alignment ✅ COMPLETE
- ✅ Migrated from SQLite to BadgerDB (10-50x performance)
- ✅ Created store interface abstraction
- ✅ Updated pipeline steps to use interface
- ✅ Documented Cloud pipeline alignment (6/12 steps, 50%)
- ✅ Added placeholder steps with implementation notes
- ✅ Build verified successfully
- ✅ Comprehensive documentation (1,500+ lines)
- **Completed:** 2026-01-18
- **Files Created:** 3 implementation, 1 test, 3 docs
- **Files Modified:** 5 (main.go, agent_controller.go, 2 steps, go.mod)
- **See:** `checkpoints/2026-01-18-badgerdb-migration-complete.md`

### Phase 7: Go Package Structure Refactoring ✅ COMPLETE
- ✅ Refactored monolithic file into domain package
- ✅ 8 focused files (all < 100 lines)
- ✅ Idiomatic Go organization following Kubernetes/Docker patterns
- **Completed:** 2026-01-18
- **See:** `checkpoints/2026-01-18-go-package-structure-refactoring.md`

### Phase 7.1: Validation Step Integration ✅ COMPLETE
- ✅ Added ValidateProtoStep to agent create pipeline
- ✅ Improved step constructor pattern (matches other steps)
- ✅ Updated tests to match new signature
- ✅ Cloud parity increased to 58% (7/12 steps)
- **Completed:** 2026-01-18
- **Files Modified:** 3 (validation.go, validation_test.go, create.go)
- **See:** `checkpoints/2026-01-18-validation-step-added.md`

### Phase 7.2: Inline Agent Pipeline Steps ✅ COMPLETE
- ✅ Inlined agent-specific steps into create.go
- ✅ Deleted separate steps/ directory (3 files → 1 file)
- ✅ Added factory methods on controller
- ✅ Documented in-process gRPC pattern for future use
- ✅ Full alignment with Java AgentCreateHandler pattern
- **Completed:** 2026-01-18
- **Files Modified:** 1 (create.go: 62 → 210 lines)
- **Files Deleted:** 2 (create_default_instance.go, update_agent_status.go)
- **See:** `checkpoints/2026-01-18-inline-agent-pipeline-steps.md`

### Phase 8: AgentInstance Implementation (Next)
- [ ] Define AgentInstance proto
- [ ] Implement AgentInstance controller
- [ ] Implement CreateDefaultInstance step
- [ ] Implement UpdateAgentStatusWithDefaultInstance step
- [ ] Test end-to-end agent creation with default instance
- **Estimated:** 1-2 sprints
- **Priority:** HIGH (needed for 100% Cloud parity)

## Dependencies

- `buf.build/validate` - Proto validation library
- OpenTelemetry Go SDK (optional, for future)
- Existing `backend/libs/go/sqlite` store
- Existing `backend/libs/go/grpc` error handling

## Risks and Challenges

1. **Complexity Management**
   - Risk: Over-engineering for OSS use case
   - Mitigation: Start simple, iterate based on needs

2. **Performance Overhead**
   - Risk: Pipeline abstraction adds latency
   - Mitigation: Keep steps lightweight, benchmark critical paths

3. **Code Size Growth**
   - Risk: Too many small files becomes hard to navigate
   - Mitigation: Follow CLI guidelines (50-250 line files), clear naming

4. **Testing Complexity**
   - Risk: Pipeline framework needs comprehensive testing
   - Mitigation: Focus on integration tests, use table-driven tests

## Related Work

- **Stigmer Cloud Reference:** `backend/services/stigmer-service/src/main/java/ai/stigmer/grpcrequest/pipeline/`
- **Java Handler Example:** `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agent/request/handler/AgentCreateHandler.java`
- **ADR:** `docs/adr/2026-01/2026-01-19-162112-inprocess-grpc-adaptor.md`
- **ADR:** `docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md`

## Special Requirements

1. **Follow Planton CLI Engineering Standards**
   - Mandatory SRP (Single Responsibility Principle)
   - File size limits enforced
   - Interface segregation
   - Dependency injection over hard-coding

2. **OSS-Friendly**
   - No cloud-specific dependencies
   - Optional telemetry (no-op by default)
   - No IAM/authorization required
   - Lightweight for local deployment

3. **Future-Proof**
   - Easy to add steps
   - Pluggable telemetry backend
   - Event publishing hooks (even if unused)
   - Ready for cloud integration later

## Quick Resume

To resume work on this project in any session:

1. Drag `next-task.md` into chat, OR
2. Reference: `@stigmer/_projects/2026-01/20260118.01.agent-controller-pipeline/next-task.md`

## Progress Tracking

- [x] Phase 1: Pipeline Framework Foundation
- [x] Phase 2: Common Steps Library
- [x] Phase 3: Architecture Alignment (moved to grpc/request/)
- [x] Phase 4: Agent Controller Integration
- [x] Phase 5: Pure Pipeline Refactoring
- [x] Phase 6: BadgerDB Migration & Cloud Alignment (50% Cloud parity)
- [x] Phase 7: Go Package Structure Refactoring
- [x] Phase 7.1: Validation Step Integration (58% Cloud parity)
- [x] Phase 7.2: Inline Agent Pipeline Steps (Java pattern alignment)
- [ ] Phase 8: AgentInstance Implementation (Next - 75% Cloud parity target)
