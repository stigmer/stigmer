---
name: Diff Algorithm T05.18
overview: Verify and enhance the diff algorithm implementation with comprehensive tests for all resource types, spec-only comparison verification, and edge case coverage.
todos:
  - id: verify-implementation
    content: Review specEquals() method and verify all 4 resource types are covered
    status: completed
  - id: multi-resource-tests
    content: Add MultiResourceTypeDiffTests - 10 tests for Workflow/McpServer/Skill
    status: completed
  - id: spec-only-tests
    content: Add SpecOnlyComparisonTests - 7 tests verifying metadata changes don't trigger updates
    status: completed
  - id: edge-case-tests
    content: Add EdgeCaseTests - 6 tests for null handling, empty states, large counts
    status: completed
  - id: realworld-tests
    content: Add RealWorldScenarioTests - 4 tests for realistic reconciliation scenarios
    status: completed
  - id: verify-tests-pass
    content: Run all tests and verify zero linter errors
    status: completed
  - id: create-changelog
    content: Create changelog documenting diff algorithm verification and test enhancement
    status: completed
isProject: false
---

# T05.18: Diff Algorithm - Verification and Test Enhancement

## Status Assessment

The core diff algorithm (`ReconciliationPlan.fromDiff()`) is already implemented in T05.12 with:

- Diff logic for all 4 resource types (agents, workflows, mcp_servers, skills)
- Spec-only comparison via `specEquals()` to avoid false positives from metadata changes
- Topological execution order from DependencyGraph
- Reverse dependency ordering for deletes

**Current Test Coverage:**

- ReconciliationPlanTest: 12 tests (construction, fromDiff basics, execution order, toString)
- DependencyGraphTest: 20 tests (comprehensive topological sort and cycle detection)

## Gap Analysis

The existing tests primarily use Agent resources. For world-class quality, we need:

1. **Multi-Resource Type Tests**: Verify diff works correctly for Workflows, McpServers, and Skills
2. **Spec-Only Comparison Tests**: Explicitly verify metadata changes don't trigger false updates
3. **Edge Case Tests**: Empty states, null handling, complex mixed scenarios
4. **Integration Tests**: Realistic multi-type reconciliation scenarios

## Implementation Plan

### Phase 1: Verify Existing Implementation (10 min)

Review the `specEquals()` method in [ReconciliationPlan.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/project/reconcile/ReconciliationPlan.java) lines 205-221:

```java
private static boolean specEquals(Message desired, Message actual) {
    if (desired instanceof Agent a1 && actual instanceof Agent a2) {
        return a1.getSpec().equals(a2.getSpec());
    }
    // ... handles Workflow, McpServer, Skill
}
```

Verify all resource types are covered and comparison is spec-only.

### Phase 2: Add Multi-Resource Type Tests (25 min)

Add new test methods to [ReconciliationPlanTest.java](backend/services/stigmer-service/src/test/java/ai/stigmer/domain/agentic/project/reconcile/ReconciliationPlanTest.java):

**New nested class: `MultiResourceTypeDiffTests**`

- `shouldDetectWorkflowCreates()` - Workflow in desired, not in actual
- `shouldDetectMcpServerCreates()` - McpServer in desired, not in actual
- `shouldDetectSkillCreates()` - Skill in desired, not in actual
- `shouldDetectWorkflowUpdates()` - Same slug, different spec
- `shouldDetectMcpServerUpdates()` - Same slug, different spec
- `shouldDetectSkillUpdates()` - Same slug, different spec
- `shouldDetectWorkflowDeletes()` - Workflow orphan detection
- `shouldDetectMcpServerDeletes()` - McpServer orphan detection
- `shouldDetectSkillDeletes()` - Skill orphan detection
- `shouldHandleAllResourceTypesMixed()` - Creates/updates/deletes across all types

### Phase 3: Add Spec-Only Comparison Tests (15 min)

**New nested class: `SpecOnlyComparisonTests**`

- `shouldNotDetectUpdateWhenOnlyMetadataIdDiffers()` - Same spec, different IDs
- `shouldNotDetectUpdateWhenOnlyTimestampsDiffer()` - Same spec, different created_at/updated_at
- `shouldNotDetectUpdateWhenOnlyOrgDiffers()` - Same spec, different org (desired has no org)
- `shouldDetectUpdateWhenSpecDiffers()` - Confirm spec changes DO trigger update
- `shouldDetectUpdateForWorkflowSpecChange()` - Workflow-specific spec comparison
- `shouldDetectUpdateForMcpServerSpecChange()` - McpServer-specific spec comparison
- `shouldDetectUpdateForSkillSpecChange()` - Skill-specific spec comparison

### Phase 4: Add Edge Case Tests (10 min)

**New nested class: `EdgeCaseTests**`

- `shouldHandleBothEmptyStates()` - Both desired and actual empty
- `shouldThrowOnNullDesired()` - Null input validation
- `shouldThrowOnNullActual()` - Null input validation
- `shouldThrowOnNullGraph()` - Null input validation
- `shouldHandleLargeResourceCounts()` - Performance sanity (100+ resources)
- `shouldHandleResourceKeysWithSpecialCharacters()` - Unicode slugs

### Phase 5: Add Real-World Scenario Tests (15 min)

**New nested class: `RealWorldScenarioTests**`

- `shouldHandleDataPipelineReconciliation()` - Realistic ETL pipeline with all resource types
- `shouldHandlePartialDeployment()` - Some resources exist, some don't
- `shouldHandleResourceRename()` - Old name deleted, new name created (not update)
- `shouldRespectDependencyOrderAcrossTypes()` - Full dependency chain verification

## Files to Modify


| File                          | Changes                                              |
| ----------------------------- | ---------------------------------------------------- |
| `ReconciliationPlanTest.java` | Add ~25 new test methods across 4 new nested classes |


## Helper Methods to Add

Add test utility methods for creating all resource types:

```java
private static Workflow createWorkflow(String name) { ... }
private static Workflow createWorkflowWithSpec(String name, String description) { ... }
private static McpServer createMcpServer(String name) { ... }
private static McpServer createMcpServerWithSpec(String name, String uri) { ... }
private static Skill createSkill(String name) { ... }
private static Skill createSkillWithSpec(String name, String description) { ... }
```

## Success Criteria

- All 4 resource types have create/update/delete tests
- Spec-only comparison explicitly verified (metadata changes don't trigger updates)
- Null input handling validated
- Edge cases covered
- Real-world scenarios tested
- Total test count: ~12 existing + ~25 new = ~37 tests for ReconciliationPlan
- Zero linter errors
- All tests passing

## Estimated Duration

60-75 minutes (as specified in Phase 5 plan)

## Deliverables

1. Enhanced `ReconciliationPlanTest.java` with comprehensive coverage
2. Changelog documenting verification and enhancements
3. Commit with conventional commit message

