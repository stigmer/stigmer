---
name: Project Repository Foundation
overview: Create the MongoDB repository for Project resources in stigmer-cloud, enabling backend persistence and retrieval. This is the foundation for Phase 5's reconciliation engine, following the established AgentRepo/McpServerRepo patterns exactly.
todos:
  - id: T05.5-prereq
    content: Run make java-stubs in stigmer-cloud/apis to generate Project Java stubs
    status: completed
  - id: T05.5-dir
    content: Create project domain directory structure in stigmer-cloud backend
    status: completed
  - id: T05.5-impl
    content: Implement ProjectRepo.java following AgentRepo pattern exactly (~150 lines)
    status: completed
  - id: T05.5-verify
    content: Build verification - Bazel build and Spring component scan
    status: completed
  - id: T05.5-test
    content: Unit tests - ProjectRepoTest.java with CRUD, lookup, and pagination tests
    status: completed
isProject: false
---

# T05.5: ProjectRepo Foundation

## Pre-Implementation Discovery

### Current State Analysis

**Proto Schema (stigmer repo - COMPLETE)**:
- `project = 60` in ApiResourceKind enum with `id_prefix: 'prj'`
- Full proto schema: api.proto, spec.proto, status.proto, enum.proto, io.proto, command.proto, query.proto
- ReconciliationSummary already defined (T05.0 is complete)
- Go/Python stubs generated

**Java Stubs (stigmer-cloud - MISSING)**:
- ApiResourceKind.project not in Java enum yet
- No Project Java stubs exist
- Must run `make java-stubs` first to generate from stigmer protos

**Existing Repository Patterns**:
- Base class: [AbstractMongoApiResourceRepository.java](backend/libs/java/api/api-state/src/main/java/ai/stigmer/apistate/repo/AbstractMongoApiResourceRepository.java)
- Reference: [AgentRepo.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agent/repo/AgentRepo.java) (144 lines)
- Reference: [McpServerRepo.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/repo/McpServerRepo.java) (179 lines)

---

## Implementation Steps

### Step 0: Generate Java Proto Stubs (Prerequisite)

Run in `stigmer-cloud/apis/`:

```bash
make java-stubs
```

This generates:
- `protos.ai.stigmer.agentic.project.v1.Project` class
- Updated `ApiResourceKind` enum with `project = 60`

**Verification**: Check that `stubs/java/src/main/java/protos/ai/stigmer/agentic/project/v1/Project.java` exists

---

### Step 1: Create Directory Structure

Create in `stigmer-cloud`:

```
backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/project/
├── repo/
│   └── ProjectRepo.java
└── request/
    ├── controller/
    └── handler/
```

---

### Step 2: Implement ProjectRepo.java

**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/project/repo/ProjectRepo.java`

**Target size**: ~150-180 lines (matches AgentRepo at 144 lines)

**Implementation following AgentRepo pattern exactly**:

```java
package ai.stigmer.domain.agentic.project.repo;

import ai.stigmer.apistate.annotation.ApiResourceRepo;
import ai.stigmer.apistate.repo.AbstractMongoApiResourceRepository;
import com.google.protobuf.Message;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;
import protos.ai.stigmer.agentic.project.v1.Project;
import protos.ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * MongoDB repository for Project resources.
 *
 * <p>Project is the aggregate root for resource lifecycle management,
 * enabling SDK synthesis with automatic reconciliation and orphan cleanup.
 *
 * <p>Projects are organization-scoped (org/name reference format).
 * Each project manages a collection of agents, workflows, skills, and MCP servers.
 */
@Slf4j
@Component
@ApiResourceRepo(kind = ApiResourceKind.project)
public class ProjectRepo extends AbstractMongoApiResourceRepository<Project> {

    private static final String COLLECTION = "project";

    public ProjectRepo(MongoTemplate mongoTemplate) {
        super(mongoTemplate, COLLECTION);
    }

    @Override
    protected Message.Builder getMessageBuilder() {
        return Project.newBuilder();
    }

    // ============== Standard Lookup Methods ==============
    // (Mirror AgentRepo/McpServerRepo exactly)
}
```

**Required Methods** (from AbstractMongoApiResourceRepository interface):

| Method | Purpose | Pattern Source |
|--------|---------|----------------|
| `findByOrgAndSlug(orgId, slug)` | Get project by org + name | AgentRepo |
| `findBySlug(slug)` | Get by slug (warn: not unique) | McpServerRepo |
| `findByOrg(orgId)` | List all projects in org | AgentRepo |
| `findByIds(ids)` | IAM-filtered batch fetch | AgentRepo |
| `page(pageable)` | Paginated listing | AgentRepo |
| `find(org, env, pageable)` | Filtered paginated listing | AgentRepo |

**Future-proofing for Reconciliation** (T05.17):

The repository will need a method to query resources owned by a project. This is handled differently:
- Child resources (Agent, Workflow, etc.) have `metadata.annotations["stigmer.ai/sdk.project"] = projectId`
- Reconciliation will query child repos, not ProjectRepo
- No additional methods needed in ProjectRepo for T05.5

---

### Step 3: Build Verification

**Commands**:

```bash
# From stigmer-cloud root
./bazelw build //backend/services/stigmer-service/...

# Verify Spring component discovery
./bazelw test //backend/services/stigmer-service/...
```

**Verification Checklist**:
- [ ] Java compilation succeeds
- [ ] No Bazel dependency errors
- [ ] Spring component scan finds `@Component`
- [ ] `@ApiResourceRepo` annotation resolves `ApiResourceKind.project`

---

## Architecture Alignment

### Why ProjectRepo Follows Standard Pattern

1. **Consistency**: Every API resource (Agent, Workflow, McpServer, Skill) follows identical pattern
2. **Base Class Benefits**: Idempotent saves via `replaceOne()`, automatic JSON/Proto conversion
3. **IAM Integration**: `findByIds()` enables policy-filtered queries
4. **Minimal Code**: ~150 lines (no custom business logic in repo)

### ProjectRepo vs Other Repos

| Feature | ProjectRepo | AgentRepo | McpServerRepo |
|---------|-------------|-----------|---------------|
| Collection | `"project"` | `"agent"` | `"mcp_server"` |
| Kind | `ApiResourceKind.project` | `ApiResourceKind.agent` | `ApiResourceKind.mcp_server` |
| Scoping | org/name | org/env/name | org/name |
| Environment | Not used | Used | Not used |
| Lines | ~150 | 144 | 179 |

---

## Testing Strategy

### Unit Test: ProjectRepoTest.java

**File**: `backend/services/stigmer-service/src/test/java/ai/stigmer/domain/agentic/project/repo/ProjectRepoTest.java`

**Test Cases**:

1. **CRUD Operations**:
   - `testSave_newProject_createsDocument()`
   - `testSave_existingProject_updatesDocument()`
   - `testFindById_exists_returnsProject()`
   - `testFindById_notExists_returnsEmpty()`
   - `testDeleteById_exists_removesDocument()`

2. **Lookup Operations**:
   - `testFindByOrgAndSlug_exists_returnsProject()`
   - `testFindByOrgAndSlug_notExists_returnsEmpty()`
   - `testFindByOrg_multipleProjects_returnsAll()`
   - `testFindByIds_subset_returnsMatchingOnly()`

3. **Pagination**:
   - `testPage_multipleProjects_returnsPaginated()`
   - `testFind_withOrgFilter_returnFiltered()`

---

## Success Criteria

- [ ] Java stubs generated with `make java-stubs` (includes Project and updated ApiResourceKind)
- [ ] ProjectRepo.java created in correct package (~150 lines)
- [ ] All methods mirror AgentRepo pattern exactly
- [ ] Bazel build succeeds
- [ ] Spring component scan discovers repository
- [ ] Unit tests cover all public methods
- [ ] Code follows existing style (Lombok `@Slf4j`, method ordering)

---

## Key Implementation Considerations

1. **No Business Logic**: Repository is pure data access - reconciliation logic belongs in domain service
2. **Idempotent Saves**: Base class uses `replaceOne()` with upsert (matches Planton pattern)
3. **Proto Conversion**: Uses `JsonFormat` for protobuf <-> JSON <-> MongoDB Document
4. **IAM Ready**: `findByIds()` method enables OpenFGA policy-filtered queries
5. **Minimal Surface**: Only standard methods - no project-specific queries needed yet

---

## Dependencies

**Upstream** (must be complete):
- T05.0: Reconciliation Proto Types - ALREADY COMPLETE (ReconciliationSummary exists in stigmer)

**Downstream** (depends on this):
- T05.6: Project Create Handler
- T05.7: Project Update Handler
- T05.8: Project Delete Handler
- T05.9: Project Apply Handler
- T05.10: Project Get Handler
- T05.11: Project GetByReference Handler

---

## Time Estimate

| Activity | Time |
|----------|------|
| Generate Java stubs | 5 min |
| Create directory structure | 2 min |
| Implement ProjectRepo.java | 20-25 min |
| Build verification | 5 min |
| Unit tests | 20-25 min |
| **Total** | **45-60 min** |
