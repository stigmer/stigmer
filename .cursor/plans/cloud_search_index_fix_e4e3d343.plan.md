---
name: Cloud Search Index Fix
overview: Eliminate brittle centralized mappings in MongoSearchQueryStore, extend search coverage from 4 to all 14 proto-declared searchable kinds, and align the cloud search architecture with the Open-Closed Principle so that adding a new searchable kind requires only implementing one SearchableExtractor -- no other files need modification.
todos:
  - id: phase-1-interface
    content: "Phase 1: Extend SearchableExtractor interface with getCollectionName() and newBuilder(); update existing 4 extractors"
    status: completed
  - id: phase-2-store
    content: "Phase 2: Refactor MongoSearchQueryStore to derive all config from registry; remove COLLECTION_NAMES, PROTO_CLASSES, getBuilderForKind()"
    status: completed
  - id: phase-3-criteria
    content: "Phase 3: Make SearchCriteria registry-driven; remove static SEARCHABLE_KINDS; update SearchHandler to pass registry kinds"
    status: completed
  - id: phase-4-extractors
    content: "Phase 4: Implement 10 new SearchableExtractor classes (organization, project, session, agent_instance, environment, agent_execution, workflow_instance, workflow_execution, execution_context, identity_account)"
    status: completed
  - id: phase-5-validate
    content: "Phase 5: Update validateExpectedKinds in SearchableResourceRegistry to expect all 14 kinds"
    status: completed
  - id: phase-6-migration
    content: "Phase 6: Create U20260308_ExtendSearchTextIndexes migration for text indexes on 10 new collections"
    status: completed
  - id: phase-7-tests
    content: "Phase 7: Update 4 existing test classes and create 10 new extractor test classes"
    status: completed
isProject: false
---

# Fix Cloud Search Index Architecture

## Domain Analysis (per Architect Role)

### The Critique

The current cloud search has three DDD/Clean Architecture violations:

1. **Anemic extractor interface**: `SearchableExtractor` doesn't own its proto type or storage identity. The `MongoSearchQueryStore` maintains three parallel mappings (`COLLECTION_NAMES`, `PROTO_CLASSES`, `getBuilderForKind()`) that must be manually synchronized -- a textbook violation of the Open-Closed Principle.
2. **Static knowledge leak**: `SearchCriteria.SEARCHABLE_KINDS` is a hardcoded constant that duplicates knowledge already expressed in the extractor registry. Every new searchable kind requires updating this constant, the store maps, the store switch, and the migration -- four parallel changes for one concept.
3. **Incomplete contract fulfillment**: The proto schema (`api_resource_kind.proto`) declares 14 kinds as searchable via `not_search_indexed: false`. The cloud implementation honors only 4, silently violating the API contract. `validateExpectedKinds` only checks 4 kinds, providing false assurance.

### The Fix

Distribute all kind-specific knowledge to the extractors. The store and criteria become kind-agnostic, driven entirely by the registry. The registry becomes the single source of truth for "what is searchable."

---

## Phase 1: Extend SearchableExtractor Interface

**Goal**: Each extractor owns its proto type AND its MongoDB collection identity.

**File**: `[SearchableExtractor.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/SearchableExtractor.java)`

Add two new methods:

```java
String getCollectionName();

Message.Builder newBuilder();
```

- `getCollectionName()` returns the MongoDB collection name (e.g., `"agent"`, `"organization"`)
- `newBuilder()` returns a fresh proto builder (e.g., `Agent.newBuilder()`)

Update existing 4 extractors to implement these methods:

- `[AgentSearchableExtractor.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/AgentSearchableExtractor.java)`: `"agent"`, `Agent.newBuilder()`
- `[SkillSearchableExtractor.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/SkillSearchableExtractor.java)`: `"skill"`, `Skill.newBuilder()`
- `[McpServerSearchableExtractor.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/McpServerSearchableExtractor.java)`: `"mcp_server"`, `McpServer.newBuilder()`
- `[WorkflowSearchableExtractor.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/WorkflowSearchableExtractor.java)`: `"workflow"`, `Workflow.newBuilder()`

---

## Phase 2: Refactor MongoSearchQueryStore -- Eliminate Centralized Mappings

**Goal**: The store derives all kind-specific knowledge from the registry/extractors.

**File**: `[MongoSearchQueryStore.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/store/MongoSearchQueryStore.java)`

- **Remove** `COLLECTION_NAMES` static map (lines 75-80)
- **Remove** `PROTO_CLASSES` static map (lines 86-91)
- **Remove** `getBuilderForKind()` method (lines 283-291)
- **Refactor** `searchKind()`: obtain `collectionName` via `extractor.getCollectionName()` instead of `COLLECTION_NAMES.get(kind)`
- **Refactor** `documentToProto()`: accept extractor parameter, use `extractor.newBuilder()` instead of `getBuilderForKind(kind)` and `PROTO_CLASSES.get(kind)`
- **Remove** all hardcoded proto imports (`Agent`, `Skill`, `McpServer`, `Workflow`) from this file -- the store should be kind-agnostic

After this phase, `MongoSearchQueryStore` has zero knowledge of specific resource kinds.

---

## Phase 3: Make SearchCriteria Registry-Driven

**Goal**: Eliminate the static `SEARCHABLE_KINDS` constant from `SearchCriteria`.

**File**: `[SearchCriteria.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/valueobject/SearchCriteria.java)`

- Add `searchableKinds` as a record component (used for filtering in the compact constructor and in `effectiveKinds()`)
- Remove the static `SEARCHABLE_KINDS` constant
- The compact constructor filters `kinds` against the `searchableKinds` parameter (instead of the static constant)
- `effectiveKinds()` returns `searchableKinds` in discover mode (instead of the static constant)

**File**: `[SearchHandler.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/handler/SearchHandler.java)` (the `BuildSearchCriteria` step)

- Pass `registry.getSupportedKinds()` to `SearchCriteria.of()` as the `searchableKinds` parameter

This makes `SearchCriteria` a pure parameterized value object with no static coupling.

---

## Phase 4: Add 10 New Extractors

New files in `[backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/)`

Each follows the same pattern as the existing 4 extractors, implementing all interface methods including the new `getCollectionName()` and `newBuilder()`. Summary field sourced from the OSS extractors:

**User-facing resources:**

- `OrganizationSearchableExtractor.java` -- collection: `"organization"`, summary: `spec.description`
- `ProjectSearchableExtractor.java` -- collection: `"project"`, summary: `spec.description`
- `SessionSearchableExtractor.java` -- collection: `"session"`, summary: `spec.subject`
- `AgentInstanceSearchableExtractor.java` -- collection: `"agent_instance"`, summary: `spec.description`
- `EnvironmentSearchableExtractor.java` -- collection: `"environment"`, summary: `spec.description`

**Operational resources:**

- `AgentExecutionSearchableExtractor.java` -- collection: `"agent_execution"`, summary: `metadata.name`
- `WorkflowInstanceSearchableExtractor.java` -- collection: `"workflow_instance"`, summary: `spec.description`
- `WorkflowExecutionSearchableExtractor.java` -- collection: `"workflow_execution"`, summary: `""` (empty -- indexed by name/tags only)
- `ExecutionContextSearchableExtractor.java` -- collection: `"execution_context"`, summary: `""` (empty -- indexed by name/tags only)

**Cloud-only resource:**

- `IdentityAccountSearchableExtractor.java` -- collection: `"identity_account"`, summary: `spec.email + " " + spec.firstName + " " + spec.lastName`

All annotated with `@Component` for Spring auto-discovery.

---

## Phase 5: Update ValidateExpectedKinds

**File**: `[SearchableResourceRegistry.java](backend/services/stigmer-service/src/main/java/ai/stigmer/query/search/extractor/SearchableResourceRegistry.java)`

Update `validateExpectedKinds()` to expect all 14 searchable kinds (13 open-source + `identity_account`). This catches missing extractors at startup before they cause silent search gaps.

---

## Phase 6: MongoDB Text Index Migration

**New file**: `backend/services/stigmer-service/src/main/java/ai/stigmer/migrations/U20260308_ExtendSearchTextIndexes.java`

Create a Mongock `@ChangeUnit` (order after `"004"`) that adds text indexes on the 10 new collections:

- Each collection: compound text index on `metadata.name` (weight 10), description field (weight 5), `metadata.tags` (weight 5)
- Description field per collection: `spec.description` for most; `spec.subject` for session; `spec.instructions` for none of the new ones; `spec.email` for identity_account
- For kinds with no meaningful description (workflow_execution, execution_context): index only `metadata.name` and `metadata.tags`
- Include rollback method that drops indexes safely

---

## Phase 7: Update Tests

**Existing tests to update:**

- `[SearchCriteriaTest.java](backend/services/stigmer-service/src/test/java/ai/stigmer/query/search/valueobject/SearchCriteriaTest.java)` -- adapt to new constructor signature with `searchableKinds` parameter; test filtering against dynamic set
- `[MongoSearchQueryStoreTest.java](backend/services/stigmer-service/src/test/java/ai/stigmer/query/search/store/MongoSearchQueryStoreTest.java)` -- verify store works with registry-driven config; remove assumptions about static maps
- `[SearchableResourceRegistryTest.java](backend/services/stigmer-service/src/test/java/ai/stigmer/query/search/extractor/SearchableResourceRegistryTest.java)` -- validate 14 extractors registered
- `[SearchHandlerTest.java](backend/services/stigmer-service/src/test/java/ai/stigmer/query/search/handler/SearchHandlerTest.java)` -- adapt to new `SearchCriteria.of()` signature

**New tests:**

- One test class per new extractor (10 total), following the pattern of `[AgentSearchableExtractorTest.java](backend/services/stigmer-service/src/test/java/ai/stigmer/query/search/extractor/AgentSearchableExtractorTest.java)`

---

## Checkpoint / Pause Points

The following surprises would warrant pausing for discussion:

- If any of the 10 new resource types have a proto structure that doesn't follow the standard `metadata`/`spec`/`status` layout
- If any MongoDB collection is missing or has conflicting indexes
- If `identity_account` search summary (email + name) raises privacy/security concerns
- If existing tests reveal assumptions about the 4-kind limit that go deeper than expected

---

## Files Changed Summary

- **Modified**: 8 existing files (interface, 4 extractors, store, criteria, registry)
- **New**: 10 extractor files + 1 migration file
- **Test modified**: 4 existing test files
- **Test new**: 10 extractor test files
- **Total**: ~33 files

