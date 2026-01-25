# T01.4 Execution: Agent Integration

**Started**: 2026-01-25
**Status**: Go Implementation Complete ✅
**Blocked**: Partially - requires Python agent-runner changes for prompt engineering

---

## Pre-Implementation Analysis

### Completed Items (from T01.1-T01.3)

✅ **Proto definitions in place:**
- `AgentSpec.skill_refs` uses `ApiResourceReference` with `version` field
- `ApiResourceReference.version` supports: empty/"latest", tag name, exact hash
- `SkillSpec` has `skill_md` and `tag` fields
- Validation rules configured

✅ **No inline skill feature to remove:**
- Current design only uses `skill_refs` (references)
- No inline skill embedding exists in Agent proto
- This subtask is complete by default

✅ **Backend storage implemented:**
- `SkillRepo` exists for MongoDB operations
- Skill CRUD operations working via Push handler
- Artifact storage abstraction in place

### Remaining Work

#### 1. Version Resolution in SkillRepo (Java - stigmer-cloud)

**Need to add:**
```java
// Resolve skill by reference with version support
Optional<Skill> resolveByReference(ApiResourceReference ref);

// Internal methods:
Optional<Skill> findByOrgAndSlugAndTag(String org, String slug, String tag);
Optional<Skill> findByOrgAndSlugAndHash(String org, String slug, String hash);
```

**Resolution logic:**
1. If version is empty or "latest" → Query main `skill` collection by org/slug
2. If version looks like tag → Check main first, then query `skill_audit` collection
3. If version looks like hash (64 hex chars) → Check main first, then query `skill_audit` collection

**Note:** This requires the audit collection setup from T01.3 design decisions.

---

#### 2. ResolveSkillsActivity (Java - stigmer-cloud)

**Interface:**
```java
@ActivityInterface
public interface ResolveSkillsActivity {
    
    /**
     * Resolve skill references to actual Skill resources.
     * 
     * @param skillRefs List of skill references from AgentSpec
     * @return List of resolved Skills with skill_md content
     */
    @ActivityMethod(name = "ResolveSkills")
    List<Skill> resolveSkills(List<ApiResourceReference> skillRefs);
}
```

**Implementation:**
```java
@Component
public class ResolveSkillsActivityImpl implements ResolveSkillsActivity {
    
    private final SkillRepo skillRepo;
    
    public ResolveSkillsActivityImpl(SkillRepo skillRepo) {
        this.skillRepo = skillRepo;
    }
    
    @Override
    public List<Skill> resolveSkills(List<ApiResourceReference> skillRefs) {
        if (skillRefs == null || skillRefs.isEmpty()) {
            return List.of();
        }
        
        return skillRefs.stream()
            .map(this::resolveSkillReference)
            .filter(Optional::isPresent)
            .map(Optional::get)
            .collect(Collectors.toList());
    }
    
    private Optional<Skill> resolveSkillReference(ApiResourceReference ref) {
        // Delegate to SkillRepo version resolution
        return skillRepo.resolveByReference(ref);
    }
}
```

---

#### 3. Workflow Update (Java - stigmer-cloud)

**Option A: Add ResolveSkillsActivity to workflow**

```java
// In InvokeAgentExecutionWorkflowImpl.java

private final ResolveSkillsActivity resolveSkillsActivity = Workflow.newLocalActivityStub(
    ResolveSkillsActivity.class,
    LocalActivityOptions.newBuilder()
        .setStartToCloseTimeout(Duration.ofSeconds(30))
        .build()
);

private void executeGraphtonFlow(AgentExecution execution) {
    // Step 0: Resolve skills (NEW)
    List<ApiResourceReference> skillRefs = getSkillRefs(execution);
    List<Skill> resolvedSkills = resolveSkillsActivity.resolveSkills(skillRefs);
    
    // Step 1: Ensure thread (existing)
    String threadId = ensureThreadActivity.ensureThread(...);
    
    // Step 2: Execute with resolved skills (MODIFIED)
    AgentExecutionStatus finalStatus = executeGraphtonActivity.executeGraphton(
        execution, 
        threadId,
        resolvedSkills  // NEW parameter
    );
}
```

**Option B: Pass skill content in AgentExecutionSpec**

Alternative approach: Add `resolved_skills` field to `AgentExecutionSpec` proto and populate it during execution creation.

```protobuf
message AgentExecutionSpec {
    // ... existing fields
    
    // Resolved skills for this execution (system-populated)
    repeated ai.stigmer.agentic.skill.v1.Skill resolved_skills = 10;
}
```

**Recommendation:** Option B is cleaner as it keeps resolution at creation time, but Option A provides more flexibility.

---

#### 4. ExecuteGraphtonActivity Interface Update (Java + Python)

**Java Interface change:**
```java
@ActivityMethod(name = "ExecuteGraphton")
AgentExecutionStatus executeGraphton(
    AgentExecution execution, 
    String threadId,
    List<Skill> resolvedSkills  // NEW
) throws Exception;
```

**Python Implementation change (agent-runner repo):**
- Receive resolved skills in activity parameters
- Build system prompt with skill definitions:

```python
def build_skill_prompt_section(resolved_skills):
    """Build prompt section for resolved skills."""
    sections = []
    for skill in resolved_skills:
        sections.append(f"""### SKILL: {skill.metadata.name}
LOCATION: /bin/skills/{skill.metadata.slug}/

{skill.spec.skill_md}
""")
    return "\n".join(sections)
```

---

#### 5. Prompt Engineering (Python - agent-runner)

The Python agent-runner needs to:
1. Receive resolved skills (either via activity params or separate gRPC call)
2. Inject `skill_md` content into system prompt
3. Format each skill with header showing:
   - Skill name
   - Location in sandbox (for future mounting)
   - Full SKILL.md content

**Prompt template example:**
```
### Available Skills

The following skills provide specialized capabilities:

### SKILL: calculator
LOCATION: /bin/skills/acme_calculator/

(Content of SKILL.md here...)

### SKILL: web-search
LOCATION: /bin/skills/tools_web-search/

(Content of SKILL.md here...)
```

---

## Implementation Options

### Option 1: Full Java-Side Resolution (Recommended)

1. Add version resolution to SkillRepo
2. Create ResolveSkillsActivity (local activity)
3. Update workflow to resolve before execution
4. Pass resolved skills to Python activity
5. Python just formats skills into prompt

**Pros:** Skills resolved before execution starts, version pinning reliable
**Cons:** Requires activity interface change, more Java code

### Option 2: Python-Side Resolution via gRPC

1. Create new gRPC endpoint: `ResolveSkillsByReference`
2. Python activity calls this endpoint during setup
3. No workflow changes needed

**Pros:** Simpler workflow, Python controls timing
**Cons:** Additional gRPC call during execution, version resolution in critical path

### Option 3: Hybrid - Resolution at Execution Creation

1. Resolve skills when `AgentExecution` is created
2. Store resolved `skill_md` content in execution spec
3. No workflow changes, Python just reads from spec

**Pros:** Resolution happens once at creation, deterministic
**Cons:** Proto changes needed, larger execution payload

---

## Blocking Dependencies

### skill_audit Collection (T01.3 design decision)

For tag/hash version resolution to work properly, we need the `skill_audit` collection implemented. This was designed in T01.3 but may not be implemented yet.

**Check:** Does the audit framework exist for skills?

### Python Agent-Runner Changes

T01.4 requires changes to the Python agent-runner service which is likely in a separate repository. These changes cannot be made in this repo.

**Required Python changes:**
- Update activity to receive resolved skills
- Implement prompt engineering with skill injection
- (Future) Mount skills at `/bin/skills/`

---

## Recommended Approach for This Session

Given the dependencies:

1. **Start with Java-side work:**
   - Add version resolution methods to SkillRepo
   - Create ResolveSkillsActivity interface and implementation
   - Register activity in worker config
   - Unit test resolution logic

2. **Defer workflow integration:**
   - ExecuteGraphtonActivity interface change requires coordination
   - May need discussion on best approach (Option 1/2/3)

3. **Document Python requirements:**
   - Create specification for agent-runner changes
   - Define activity parameter changes needed

---

---

## Go Implementation Complete ✅

**Completed**: 2026-01-25

### Files Created/Modified

1. **Created**: `load_skill_by_reference.go`
   - `LoadSkillByReferenceStep` - Skill-specific version resolution step
   - `isHash()` - Helper to detect if version is a SHA256 hash
   - Version resolution logic:
     - Empty/"latest" → Returns main collection skill
     - Tag → Checks main, then searches audit records
     - Hash (64 hex chars) → Checks main, then searches audit records

2. **Modified**: `get_by_reference.go`
   - Now uses `LoadSkillByReferenceStep` instead of generic `LoadByReferenceStep`
   - Updated documentation to describe version support

3. **Modified**: `BUILD.bazel`
   - Added `load_skill_by_reference.go` to sources

4. **Modified**: `skill_controller_test.go`
   - Added helper functions: `createTestSkill()`, `createTestAuditRecord()`
   - Added `TestSkillController_GetByReference` - Tests for version resolution from main
   - Added `TestSkillController_GetByReference_AuditVersions` - Tests for audit lookup
   - Added `TestIsHash` - Unit tests for hash detection

### Test Results

```
✅ TestSkillController_GetByReference/get_by_slug_without_version_(latest)
✅ TestSkillController_GetByReference/get_by_slug_with_explicit_latest_version
✅ TestSkillController_GetByReference/get_by_slug_with_matching_tag
✅ TestSkillController_GetByReference/get_by_slug_with_matching_hash
✅ TestSkillController_GetByReference/get_non-existent_slug
✅ TestSkillController_GetByReference/get_with_non-existent_version
✅ TestSkillController_GetByReference_AuditVersions/get_current_version_(v3)
✅ TestSkillController_GetByReference_AuditVersions/get_older_version_(v1)_from_audit
✅ TestSkillController_GetByReference_AuditVersions/get_version_by_hash_from_audit
✅ TestIsHash (all cases)
```

### Architecture

```
GetByReference(ctx, ref) 
  → ValidateProtoStep
  → LoadSkillByReferenceStep
      ├── Find main skill by slug
      ├── Check version parameter:
      │   ├── empty/"latest" → Return main skill
      │   ├── matches main skill tag/hash → Return main skill
      │   └── Otherwise → Search audit records
      │       └── Find latest matching tag or exact hash
      └── Return resolved skill
```

### Key Design Decisions

1. **Skill-specific step** rather than generic - Only Skills have versioning currently
2. **Audit key format**: `skill_audit/<resource_id>/<timestamp>` - Allows prefix scanning
3. **Latest by timestamp** - Multiple audit records with same tag are sorted by timestamp
4. **Hash detection** - 64 lowercase hex characters = SHA256 hash = exact version lookup

---

## Remaining Work

### Java Backend (stigmer-cloud)

The Java implementation should follow similar pattern:
- [ ] Add version resolution to SkillRepo
- [ ] Create ResolveSkillsActivity (Temporal local activity)
- [ ] Update workflow to call resolution before ExecuteGraphton
- [ ] Pass resolved skills to Python activity

### Python Agent-Runner

- [ ] Update ExecuteGraphtonActivity to receive resolved skills
- [ ] Implement prompt engineering with skill injection
- [ ] Mount skills at `/bin/skills/` (future)

---

**Status**: Go implementation complete ✅
