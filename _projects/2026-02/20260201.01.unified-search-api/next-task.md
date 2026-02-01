# Next Task: 20260201.01.unified-search-api

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260201.01.unified-search-api

**Description**: Implement a unified Search bounded context with a single RPC for searching/discovering all API resources (agents, skills, MCP servers, workflows)
**Goal**: Create a search domain with single 'search' RPC that handles list, search, and discover operations across all resource types using MongoDB (cloud) and SQLite (OSS) backends
**Tech Stack**: Protocol Buffers, Java/Spring, Go (CLI), MongoDB, SQLite
**Components**: APIs (protos under ai.stigmer.search.v1), Backend services (Java handlers), CLI commands (list, search, discover)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260201.01.unified-search-api/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-02-01 10:18
**Current Task**: Phase 4 (CLI Integration) - Agent Commands Complete
**Status**: In Progress - Agents Done, Remaining Resources Pending
**Last Updated**: 2026-02-01 12:05

### Phase 1 Complete ✅

Phase 1 (Proto Definitions) completed on 2026-02-01:
- ✅ Created `apis/ai/stigmer/search/v1/query.proto` - SearchService definition
- ✅ Created `apis/ai/stigmer/search/v1/io.proto` - Request/Response messages
- ✅ Generated stubs for Go, Java, Python, TypeScript
- ✅ All compilation checks passed (buf lint, go build)
- ✅ Changelog created: `_changelog/2026-02/2026-02-01-105137-unified-search-api-phase1-proto-definitions.md`
- ✅ Committed: `26e1837` feat(apis/search): add unified search API proto definitions

**Key Deliverables**:
- Production-ready proto definitions with comprehensive documentation
- Type-safe API with buf.validate rules
- Generated stubs compiled and verified
- CQRS architecture clearly documented in proto comments

### Phase 2 Complete ✅

Phase 2 (Backend Domain Layer - Refactored) completed on 2026-02-01:
- ✅ Created `SearchableExtractor` interface (Strategy Pattern for proto classes)
- ✅ Implemented 4 extractors: Agent, Skill, McpServer, Workflow
- ✅ Created `SearchableResourceRegistry` with Spring auto-discovery
- ✅ Created `SearchCriteria` value object with inline validation
- ✅ **Refactored**: Removed duplicate DTOs - use proto classes directly
- ✅ Deleted unnecessary classes: SearchableMetadata, SearchResultDto, AuthorizedResourceIds, SearchQuery
- ✅ Comprehensive unit tests for all components
- ✅ No linter errors

**Key Decisions**:
- Strategy Pattern to handle protobuf classes (can't implement interfaces)
- Return `SearchResult` proto directly from extractors (no intermediate DTOs)
- Use existing `IamPolicyGrpcRepo.listAuthorizedResourceIds()` for authorization
- Inline query validation in `SearchCriteria` (max 500 chars)

### Phase 3 Complete ✅

Phase 3 (Repository Layer / Query Layer) completed on 2026-02-01:
- ✅ Created `SearchQueryStore` interface - Query-side data access abstraction
- ✅ Created `SearchPagedResult` value object - Immutable paginated result container
- ✅ Implemented `MongoSearchQueryStore` - MongoDB implementation with text search
- ✅ Created MongoDB text index migration (`U20260201_SearchTextIndexes`) using Mongock
- ✅ Created `SearchGrpcAutoController` - gRPC router with auto-discovery
- ✅ Implemented `SearchHandler` with pipeline steps:
  - `BuildSearchCriteria` - Validates and converts request
  - `QueryAuthorizedIds` - Queries FGA for authorized IDs per kind
  - `ExecuteSearch` - Queries MongoDB via SearchQueryStore
- ✅ Reorganized package structure into clean sub-packages (extractor/, store/, handler/, controller/, valueobject/)
- ✅ Comprehensive unit tests for all components
- ✅ Updated `package-info.java` with complete architecture documentation
- ✅ No linter errors
- ✅ Changelog created: `_changelog/2026-02/2026-02-01-114355-search-backend-package-reorganization.md`
- ✅ Committed: `9b631a2` feat(backend/search): implement unified search backend with clean package structure

**Key Deliverables**:
- `SearchQueryStore` interface (allows future SQLite implementation for OSS)
- `MongoSearchQueryStore` with multi-collection querying and text search
- MongoDB text indexes via Mongock migration with weighted fields (name: 10, description: 5, tags: 5)
- Pipeline-based handler following established codebase patterns
- Authorization via FGA integration (per-kind authorized ID queries)
- Clean package structure following best practices

**Final Package Structure**:
```
stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/
├── package-info.java                        # Architecture docs
├── controller/
│   └── SearchGrpcAutoController.java        # gRPC router
├── extractor/                               # Strategy pattern
│   ├── SearchableExtractor.java             # Interface
│   ├── SearchableResourceRegistry.java      # Registry
│   ├── AgentSearchableExtractor.java
│   ├── SkillSearchableExtractor.java
│   ├── McpServerSearchableExtractor.java
│   └── WorkflowSearchableExtractor.java
├── handler/
│   └── SearchHandler.java                   # Pipeline handler
├── store/                                   # Data access
│   ├── SearchQueryStore.java                # Interface
│   └── MongoSearchQueryStore.java           # MongoDB impl
└── valueobject/
    ├── SearchCriteria.java                  # Validated criteria
    └── SearchPagedResult.java               # Result container

stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/
└── U20260201_SearchTextIndexes.java         # Mongock migration

stigmer-cloud/backend/services/stigmer-service/src/test/java/ai/stigmer/query/search/
├── extractor/
│   ├── AgentSearchableExtractorTest.java
│   └── SearchableResourceRegistryTest.java
├── handler/
│   └── SearchHandlerTest.java
├── store/
│   └── MongoSearchQueryStoreTest.java
└── valueobject/
    ├── SearchCriteriaTest.java
    └── SearchPagedResultTest.java
```

### Phase 4 In Progress: CLI Integration (Agent Commands Complete)

Phase 4 (Session 1 - 2026-02-01):
- ✅ Created `pkg/display/truncate.go` - Presentation-layer truncation (170 lines)
- ✅ Created `internal/cli/search/client.go` - SearchService gRPC wrapper (155 lines)
- ✅ Created `internal/cli/search/display.go` - Generic search result display (270 lines)
- ✅ Created `internal/cli/search/BUILD.bazel` - Build configuration
- ✅ Replaced `agent_list.go` placeholder with full implementation (120 lines)
- ✅ Created `agent_search.go` - Text-based agent search (140 lines)
- ✅ Extended `internal/cli/agent/display.go` - List/search display functions (+45 lines)
- ✅ Updated BUILD.bazel files with dependencies
- ✅ Added comprehensive unit tests (445 lines total)
- ✅ All tests passing (3 test suites, 15+ test cases)
- ✅ Changelog: `_changelog/2026-02/2026-02-01-120534-cli-search-api-integration.md`

**CLI Commands Now Available**:
- `stigmer agent list` - List agents with pagination, org scoping, output formats
- `stigmer agent search <query>` - Text search across name/description/tags

**Key Implementation**:
- Reusable `internal/cli/search/` package for all resources
- Presentation-layer truncation following ADR-4
- Word boundary-aware description truncation
- Relative time formatting ("2 days ago")
- Table/YAML/JSON output formats
- Pagination support (page, page-size flags)

**Remaining Phase 4 Tasks**:
- [ ] Add `list` subcommand to: skill, mcpserver, workflow
- [ ] Add `search` subcommand to: skill, mcpserver, workflow
- [ ] Add root `discover` command
- [ ] Extend `internal/cli/search/` for multi-kind display

**CLI Command Mapping**:
| CLI Command | RPC Request |
|-------------|-------------|
| `stigmer agent list` | `{kinds: [AGENT], org: "<user's org>", query: ""}` |
| `stigmer agent search "code review"` | `{kinds: [AGENT], query: "code review"}` |
| `stigmer discover "kubernetes"` | `{kinds: [], query: "kubernetes"}` |

## Quick Commands

After loading context:
- "Start Phase 4" - Begin CLI integration
- "Show project status" - Get overview of progress
- "Review Phase 3 code" - See the backend implementation
- "Review proto definitions" - Check API contract

---

*This file provides direct paths to all project resources for quick context loading.*
