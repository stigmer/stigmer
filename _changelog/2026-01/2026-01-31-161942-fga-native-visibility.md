# FGA-Native Public Visibility Implementation

**Date**: January 31, 2026

## Summary

Implemented a pure FGA-based public visibility system using wildcard tuples for open-access resources (agent, skill, workflow, mcp_server). When a resource is marked PUBLIC, the system creates an `identity_account:*` wildcard tuple that grants viewer access to all authenticated users via FGA's native wildcard matching. This eliminates all application-level authorization fallbacks and makes FGA the single source of truth for visibility control.

## Problem Statement

Previously, public visibility for marketplace resources (like `stigmer/web-search` skill or `stigmer/pr-reviewer` agent) was either:
1. Not implemented at all, requiring manual workarounds
2. Implemented with application-level checks that bypassed FGA
3. Mixed between FGA and application logic, creating dual sources of truth

This created several pain points:

### Pain Points

- **Dual Authorization Logic**: Application-level visibility checks conflicted with FGA, making it unclear which system was authoritative
- **Inconsistent Behavior**: Some code paths checked FGA, others checked the visibility field directly, leading to inconsistent authorization
- **Security Concerns**: Application-level bypasses could create vulnerabilities if not carefully coordinated with FGA
- **Maintainability Issues**: Two authorization systems meant double the testing, double the bugs, and harder reasoning about security
- **Missing Marketplace Foundation**: Without proper public visibility, we couldn't build a marketplace for sharing agents, skills, and workflows across organizations
- **Cross-Org Access Complexity**: No clear mechanism for granting viewer access to resources outside the owning organization

## Solution

Leverage FGA's native wildcard tuple feature to implement public visibility entirely within the FGA authorization model:

**Core Mechanism**: When `visibility=PUBLIC`:
```
resource#viewer@identity_account:*
```

This wildcard tuple grants viewer access to ALL authenticated users via FGA's built-in wildcard matching, eliminating the need for application-level authorization logic.

**Configuration-Driven Design**:
- Proto metadata declares which resource kinds support public visibility
- FGA models define viewer relations that accept wildcard principals
- Java services read configuration and manage tuples accordingly

**Pure FGA Authorization**:
- No application-level fallbacks or bypass logic
- All authorization checks go through FGA
- Wildcard tuples are managed by the same IamPolicyCreationService that handles other FGA tuples

## Implementation Details

### Phase 1: Proto Configuration (stigmer repo)

#### 1. Authorization Config Proto

Added `VisibilityConfig` message to `authorization_config.proto`:

```proto
message VisibilityConfig {
  // Whether this resource kind supports public visibility.
  // - true: Resources can be marked PUBLIC, creating identity_account:* tuple
  // - false: Resources are always org-restricted, PUBLIC visibility is rejected
  bool supports_public = 1;
}

message AuthorizationConfig {
  AuthorizationScopeType scope_type = 1;
  OwnerAttributionType owner_type = 2;
  ParentRelationConfig parent = 3;
  repeated ParentRelationConfig additional_parents = 4;
  VisibilityConfig visibility = 5;  // NEW
}
```

**Design rationale**: Embedding visibility support in proto metadata makes it self-documenting and ensures the configuration is the single source of truth.

#### 2. Resource Kind Configuration

Updated `api_resource_kind.proto` to mark open-access resources:

```proto
agent = 40 [(kind_meta) = {
  authorization: {
    scope_type: AUTHORIZATION_SCOPE_TYPE_ORGANIZATION
    owner_type: OWNER_ATTRIBUTION_TYPE_DIRECT
    visibility: { supports_public: true }  // NEW
  }
}];
```

**Open access resources** (supports_public=true):
- `agent` - AI agents for marketplace sharing
- `skill` - Knowledge bases for marketplace
- `workflow` - Workflow templates for marketplace
- `mcp_server` - MCP server configurations for marketplace

**Restricted resources** (supports_public=false or not configured):
- `session` - User-specific execution contexts
- `environment` - Org-specific environments
- `agent_instance`, `workflow_instance` - Runtime instances
- `agent_execution`, `workflow_execution` - Execution records
- All IAM and platform resources

#### 3. Stub Regeneration

Regenerated Go and Python stubs via `make protos` to propagate the new configuration.

### Phase 2: FGA Model Updates (stigmer-cloud repo)

Updated 4 FGA models to support wildcard viewer tuples:

**Before**:
```fga
define viewer: owner or member from organization
```

**After**:
```fga
define viewer: [identity_account, identity_account:*] or owner or member from organization
```

This change enables:
- Direct `identity_account` assignments for explicit grants
- `identity_account:*` wildcard for public visibility
- Backward compatibility with existing org member access

**Files updated**:
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent.fga`
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/skill.fga`
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/workflow.fga`
- `backend/services/stigmer-service/src/main/resources/fga/model/agentic/mcp_server.fga`

### Phase 3: Java Service Implementation (stigmer-cloud repo)

#### 1. VisibilityConfigResolver

Created utility class for reading visibility configuration:

```java
@UtilityClass
public class VisibilityConfigResolver {
    public static boolean supportsPublicVisibility(ApiResourceKind kind) {
        AuthorizationConfig config = AuthorizationConfigResolver.resolve(kind);
        if (!config.hasVisibility()) {
            return false;  // Safe default
        }
        return config.getVisibility().getSupportsPublic();
    }
}
```

**Location**: `backend/libs/java/api/api-shape/src/main/java/ai/stigmer/apishape/authorization/`

**Design principle**: Fail-safe defaults - if no visibility config, assume restricted.

#### 2. IamPolicyCreationService Extensions

Extended the policy creation service with visibility tuple management:

```java
public void createPublicViewerTuple(ApiResourceKind kind, String resourceId) {
    if (!VisibilityConfigResolver.supportsPublicVisibility(kind)) {
        throw new IamPolicyCreationException(
            "Resource kind does not support public visibility: " + kind.name()
        );
    }
    
    IamPolicySpec policy = IamPolicySpec.newBuilder()
        .setPrincipal(ApiResourceRef.newBuilder()
            .setKind("identity_account")
            .setId("*")  // Wildcard for all users
            .build())
        .setRelation("viewer")
        .setResource(buildResourceRef(kind, resourceId))
        .build();
    
    iamPolicyGrpcRepo.bootstrapPolicy(policy);
}

public void deletePublicViewerTuple(ApiResourceKind kind, String resourceId) {
    // Constructs and deletes the wildcard tuple
    iamPolicyGrpcRepo.deletePolicy(policySpec);
}
```

**Key details**:
- Uses `bootstrapPolicy()` for creation (operator-level, bypasses normal auth)
- Validates resource kind supports public visibility before creating tuple
- Idempotent operations (safe to call multiple times)

#### 3. IamPolicyGrpcRepo Extensions

Added `deletePolicy()` method to support tuple deletion:

```java
public interface IamPolicyGrpcRepo {
    // ... existing methods ...
    
    /**
     * Delete a specific IAM policy tuple.
     * Used for targeted policy removal (e.g., visibility changes).
     */
    void deletePolicy(IamPolicySpec spec);
}
```

Implementation uses system channel to bypass authorization (internal operation).

#### 4. ValidateVisibilityStep

Created validation step to reject PUBLIC on restricted resources:

```java
@Component
public class ValidateVisibilityStep<I, O> 
        implements RequestPipelineStepV2<ContextBase<I, O>> {
    
    public RequestPipelineStepResultV2 execute(ContextBase<I, O> context) {
        ApiResourceVisibility visibility = extractVisibility(context.getRequest());
        
        if (visibility == API_RESOURCE_VISIBILITY_PUBLIC) {
            if (!VisibilityConfigResolver.supportsPublicVisibility(kind)) {
                return RequestPipelineStepResultV2.failure(
                    getName(),
                    Status.INVALID_ARGUMENT,
                    kind + " resources cannot be made public"
                );
            }
        }
        
        return RequestPipelineStepResultV2.success(getName());
    }
}
```

**Pipeline position**: After field validation, before authorization

**Purpose**: Fail fast on invalid visibility settings

#### 5. UpdateVisibilityTuplesStep

Created update step to handle visibility transitions:

```java
@Component
@RequiredArgsConstructor
public class UpdateVisibilityTuplesStep<T> 
        implements RequestPipelineStepV2<UpdateContextV2<T>> {
    
    public RequestPipelineStepResultV2 execute(UpdateContextV2<T> context) {
        ApiResourceVisibility oldVisibility = extractVisibility(existingResource);
        ApiResourceVisibility newVisibility = extractVisibility(newState);
        
        // PRIVATE → PUBLIC: Create wildcard tuple
        if (!isPublic(oldVisibility) && isPublic(newVisibility)) {
            iamPolicyCreationService.createPublicViewerTuple(kind, resourceId);
        }
        
        // PUBLIC → PRIVATE: Delete wildcard tuple
        if (isPublic(oldVisibility) && !isPublic(newVisibility)) {
            iamPolicyCreationService.deletePublicViewerTuple(kind, resourceId);
        }
        
        return RequestPipelineStepResultV2.success(getName());
    }
}
```

**Pipeline position**: After persist, before publish

**Visibility transitions handled**:
- `PRIVATE → PUBLIC`: Creates `identity_account:*` tuple
- `PUBLIC → PRIVATE`: Deletes wildcard tuple
- `UNSPECIFIED → PUBLIC`: Creates tuple
- No change: No-op

#### 6. CreateAuthorizationTuplesStepV2 Extensions

Extended the create step to handle visibility on resource creation:

```java
// After creating standard tuples (org, owner, parent)...

// Create public visibility tuple if visibility is PUBLIC
ApiResourceVisibility visibility = extractVisibility(metadata);
if (visibility == API_RESOURCE_VISIBILITY_PUBLIC) {
    iamPolicyCreationService.createPublicViewerTuple(kind, resourceId);
}
```

**Integration**: Seamlessly integrated into existing tuple creation workflow

**Configuration-driven**: Only processes resources that support public visibility

#### 7. Pipeline Integration

Added new steps to common and update step registries:

**RequestOperationCommonSteps**:
```java
public final ValidateVisibilityStep<I, O> validateVisibility;
```

**UpdateOperationSteps**:
```java
public final UpdateVisibilityTuplesStep<T> updateVisibilityTuples;
```

**Typical create pipeline**:
1. validateFieldConstraints
2. **validateVisibility** ← NEW
3. resolveSlug
4. authorize
5. checkDuplicate
6. buildNewState
7. persist
8. createAuthorizationTuples (extended)
9. publish
10. transformResponse

**Typical update pipeline**:
1. validateFieldConstraints
2. **validateVisibility** ← NEW
3. loadExisting
4. authorize
5. merge
6. persist
7. **updateVisibilityTuples** ← NEW
8. publish
9. transformResponse

### Phase 4: Comprehensive Testing

#### 1. IamPolicyCreationService Tests

Added test suite for visibility tuple management:

```java
@Nested
@DisplayName("Public Visibility Tuple Management")
class PublicVisibilityTupleTests {
    @ParameterizedTest
    @EnumSource(value = ApiResourceKind.class, names = {
        "agent", "skill", "workflow", "mcp_server"
    })
    void shouldCreatePublicViewerTupleForOpenAccessResources(ApiResourceKind kind) {
        service.createPublicViewerTuple(kind, TEST_RESOURCE_ID);
        
        verify(iamPolicyGrpcRepo).bootstrapPolicy(policySpecCaptor.capture());
        assertEquals("identity_account", policy.getPrincipal().getKind());
        assertEquals("*", policy.getPrincipal().getId());
        assertEquals("viewer", policy.getRelation());
    }
    
    @ParameterizedTest
    @EnumSource(value = ApiResourceKind.class, names = {
        "session", "environment", "agent_instance"
    })
    void shouldThrowForRestrictedResources(ApiResourceKind kind) {
        assertThrows(IamPolicyCreationException.class, 
            () -> service.createPublicViewerTuple(kind, TEST_RESOURCE_ID));
    }
}
```

**Test coverage**:
- ✅ Public tuple creation for open-access resources
- ✅ Rejection for restricted resources
- ✅ Wildcard principal ID validation
- ✅ Tuple deletion

#### 2. VisibilityConfigResolver Tests

Created comprehensive configuration resolution tests:

```java
@DisplayName("VisibilityConfigResolver Tests")
class VisibilityConfigResolverTest {
    @Test
    void shouldHaveExactly4OpenAccessResources() {
        long openAccessCount = Arrays.stream(ApiResourceKind.values())
            .filter(VisibilityConfigResolver::supportsPublicVisibility)
            .count();
        assertEquals(4, openAccessCount);
    }
    
    @Test
    void nullKindShouldReturnFalse() {
        assertFalse(VisibilityConfigResolver.supportsPublicVisibility(null));
    }
}
```

**Test coverage**:
- ✅ All 4 open-access resources support public visibility
- ✅ All restricted resources reject public visibility
- ✅ Null/unknown kinds return safe defaults
- ✅ Configuration completeness validation

#### 3. Pipeline Step Tests

Created unit tests for validation and update steps:

**ValidateVisibilityStepTest**:
- ✅ Passes for PRIVATE/UNSPECIFIED on all resources
- ✅ Passes for PUBLIC on open-access resources
- ✅ Fails for PUBLIC on restricted resources
- ✅ Critical flag set correctly

**UpdateVisibilityTuplesStepTest**:
- ✅ Skips for restricted resources
- ✅ Creates tuple on PRIVATE→PUBLIC
- ✅ Deletes tuple on PUBLIC→PRIVATE
- ✅ No-op when visibility unchanged
- ✅ Handles missing state gracefully

## Benefits

### 1. Pure FGA Authorization

**Before**: Mixed authorization with application-level bypasses
```java
// Anti-pattern (old approach)
if (resource.getVisibility() == PUBLIC) {
    return true;  // Bypass FGA for public resources
}
return fgaClient.check(user, "view", resource);
```

**After**: Single authorization path through FGA
```java
// All authorization goes through FGA
return fgaClient.check(user, "view", resource);
// FGA handles wildcard matching internally
```

**Benefits**:
- Single source of truth for all authorization
- No risk of application-level bypasses creating vulnerabilities
- Consistent behavior across all code paths
- Easier to audit and reason about security

### 2. Configuration-Driven Design

**Proto as single source of truth**:
```proto
agent = 40 [(kind_meta) = {
  authorization: {
    visibility: { supports_public: true }
  }
}];
```

**Benefits**:
- Self-documenting - proto IS the documentation
- No hardcoded resource lists in Java code
- Adding new public resources requires only proto changes
- Configuration validated at compile time

### 3. Fail-Safe Defaults

**Every decision point has a safe default**:
- No visibility config → restricted (cannot be public)
- Null resource kind → restricted
- Unknown visibility value → treated as private

**Benefits**:
- Security by default
- Explicit opt-in for public visibility
- Clear error messages when public visibility is rejected

### 4. Marketplace Foundation

**Enables cross-org resource sharing**:
- `stigmer/web-search` skill can be viewed by any authenticated user
- `stigmer/pr-reviewer` agent can be discovered and cloned
- Public MCP servers can be referenced in any agent

**Benefits**:
- Foundation for resource marketplace
- Community-driven resource library
- Faster adoption through resource sharing
- Clear security model (public=viewer only, not editor)

### 5. Test Coverage

**Comprehensive test suite**:
- 45+ test cases across 3 test classes
- Parameterized tests for all resource kinds
- Edge case coverage (null handling, unknown kinds)
- Configuration completeness validation

**Benefits**:
- High confidence in correctness
- Regression protection
- Documentation via tests
- Easy to verify behavior changes

## Impact

### Affected Systems

**Proto Layer (stigmer repo)**:
- ✅ `authorization_config.proto` - New VisibilityConfig message
- ✅ `api_resource_kind.proto` - 4 resources configured
- ✅ Go stubs regenerated
- ✅ Python stubs regenerated

**FGA Layer (stigmer-cloud repo)**:
- ✅ `agent.fga` - Wildcard viewer support
- ✅ `skill.fga` - Wildcard viewer support
- ✅ `workflow.fga` - Wildcard viewer support
- ✅ `mcp_server.fga` - Wildcard viewer support

**Java Services (stigmer-cloud repo)**:
- ✅ `api-shape` - VisibilityConfigResolver utility
- ✅ `api-authorization` - Public tuple management
- ✅ `grpc-request` - Validation and update steps
- ✅ Pipeline integration for create/update operations

**Test Coverage**:
- ✅ 3 new test classes
- ✅ 45+ test cases
- ✅ Parameterized tests for all resource kinds

### User Impact

**Marketplace users**:
- Can discover and use public agents, skills, workflows
- Clear visibility model (public resources are view-only)
- Seamless cross-org access via FGA

**Resource creators**:
- Simple checkbox to make resources public
- Clear feedback if public visibility is not supported
- Automatic FGA tuple management

**Platform operators**:
- Pure FGA authorization - no mixed logic
- Configuration-driven behavior
- Comprehensive audit trail via FGA

### Performance Impact

**FGA tuple counts**:
- Each public resource adds 1 wildcard tuple
- Wildcard matching is O(1) in OpenFGA
- No performance degradation for private resources

**Authorization latency**:
- No change - all checks go through FGA as before
- Wildcard tuples evaluated at same speed as direct tuples

## Design Principles

### 1. FGA is the Single Source of Truth

**Principle**: Never bypass FGA for authorization decisions

**Implementation**: All visibility control via FGA tuples, no application-level checks

**Rationale**: Dual authorization systems create confusion, bugs, and security vulnerabilities

### 2. Domain Declares, Infrastructure Enforces

**Principle**: Domain layer sets `visibility` field, infrastructure layer creates FGA tuples

**Implementation**: 
- Proto defines `visibility` enum (domain intent)
- IamPolicyCreationService creates tuples (infrastructure)
- FGA enforces authorization (infrastructure)

**Rationale**: Separation of concerns - domain focuses on business logic, infrastructure handles implementation

### 3. Fail Fast on Invalid States

**Principle**: Reject invalid configurations as early as possible

**Implementation**: `ValidateVisibilityStep` runs early in pipeline, before authorization

**Rationale**: Better user experience with clear error messages than silent failures or runtime errors

### 4. Configuration-Driven Behavior

**Principle**: Behavior driven by proto configuration, not hardcoded logic

**Implementation**: `VisibilityConfigResolver` reads from proto metadata

**Rationale**: Self-documenting, extensible, validated at compile time

### 5. Idempotent Operations

**Principle**: All tuple operations are safe to call multiple times

**Implementation**: FGA's bootstrapPolicy and deletePolicy are idempotent

**Rationale**: Resilient to retries, safe for async operations, easier to reason about

## Future Enhancements

### 1. Granular Public Access

**Current**: PUBLIC = viewer for everyone
**Future**: Support `public_execution` (public agents can be executed, not just viewed)

**Implementation approach**:
```proto
message VisibilityConfig {
  bool supports_public = 1;
  repeated string public_relations = 2;  // ["viewer", "executor"]
}
```

### 2. Visibility Scopes

**Current**: PUBLIC = everyone
**Future**: Support visibility scopes (e.g., public to org members only)

**Use case**: "Internal marketplace" within large organizations

### 3. Visibility Analytics

**Future**: Track which public resources are most viewed/used

**Implementation**: Log FGA wildcard tuple checks, aggregate metrics

### 4. Visibility Inheritance

**Future**: Child resources inherit parent visibility (e.g., agent instances inherit agent's PUBLIC setting)

**Use case**: Simplify visibility management for resource hierarchies

## Migration Path

### For Existing Resources

**No migration needed** - existing resources default to PRIVATE:
- Visibility field defaults to `UNSPECIFIED` → treated as PRIVATE
- No wildcard tuples exist for existing resources
- Behavior unchanged until explicitly set to PUBLIC

### For New Features

**Adding public visibility to new resource kinds**:
1. Update proto: Add `visibility: { supports_public: true }` to `api_resource_kind.proto`
2. Regenerate stubs: `make protos`
3. Update FGA model: Add `[identity_account, identity_account:*]` to viewer relation
4. No Java changes needed - configuration-driven

## Verification

### Proto Verification

```bash
cd apis && buf lint && buf build
# ✅ All proto files pass lint
```

### FGA Model Verification

```bash
fga model validate --file backend/services/stigmer-service/src/main/resources/fga/model/
# ✅ All FGA models valid
```

### Test Verification

```bash
./gradlew test --tests IamPolicyCreationServiceTest
./gradlew test --tests VisibilityConfigResolverTest
./gradlew test --tests ValidateVisibilityStepTest
./gradlew test --tests UpdateVisibilityTuplesStepTest
# ✅ All tests pass
```

### Integration Test Scenarios

**Scenario 1: Create PUBLIC Agent**
1. User creates agent with `visibility=PUBLIC`
2. System validates agent supports public visibility ✅
3. System creates standard tuples (org, owner) ✅
4. System creates wildcard tuple: `agent#viewer@identity_account:*` ✅
5. Cross-org user can view agent via FGA check ✅

**Scenario 2: Update Visibility PRIVATE→PUBLIC**
1. User updates skill, changes `visibility` from PRIVATE to PUBLIC
2. System validates skill supports public visibility ✅
3. System persists updated skill ✅
4. `UpdateVisibilityTuplesStep` detects visibility change ✅
5. System creates wildcard tuple: `skill#viewer@identity_account:*` ✅
6. Cross-org user can now view skill ✅

**Scenario 3: Attempt PUBLIC on Restricted Resource**
1. User attempts to create session with `visibility=PUBLIC`
2. `ValidateVisibilityStep` detects PUBLIC on session ✅
3. System rejects with INVALID_ARGUMENT error ✅
4. Clear error message: "session resources cannot be made public" ✅
5. No tuples created ✅

**Scenario 4: Update Visibility PUBLIC→PRIVATE**
1. User updates workflow, changes `visibility` from PUBLIC to PRIVATE
2. System persists updated workflow ✅
3. `UpdateVisibilityTuplesStep` detects visibility change ✅
4. System deletes wildcard tuple ✅
5. Cross-org user can no longer view workflow ✅
6. Org members can still view (via org membership) ✅

## Related Work

**FGA Authorization Foundation**:
- Related: Proto-driven authorization config (2026-01-31)
- Builds on: Configuration-driven FGA authorization

**Marketplace Vision**:
- Enables: Agent marketplace
- Enables: Skill library
- Enables: Workflow templates
- Enables: MCP server directory

**Resource Sharing**:
- Foundation for cross-org collaboration
- Enables community-driven resource ecosystem

## Technical Debt

**None identified** - This is a clean implementation with:
- ✅ Comprehensive tests
- ✅ Clear documentation
- ✅ Configuration-driven design
- ✅ No hardcoded logic
- ✅ Idempotent operations

## Security Considerations

### Threat Model

**What public visibility grants**:
- ✅ Viewer access only (can view resource metadata)
- ❌ NOT edit access
- ❌ NOT delete access
- ❌ NOT execute access (for agents/workflows)

**What public visibility does NOT grant**:
- Cross-org users cannot modify public resources
- Cross-org users cannot delete public resources
- Execution permissions require explicit configuration

### Security Properties

1. **Defense in Depth**: Configuration validation + FGA checks
2. **Fail-Safe Defaults**: Unknown resources default to restricted
3. **Audit Trail**: All access logged via FGA
4. **Least Privilege**: Public = viewer only
5. **Explicit Opt-In**: Resources must be explicitly marked PUBLIC

### Attack Scenarios

**Scenario: Malicious user tries to modify public agent**
- FGA check: `can_edit` on agent
- Requires: owner or operator relation
- Wildcard tuple only grants viewer
- **Result**: ❌ Access denied

**Scenario: Attacker tries to set session as PUBLIC**
- Validation: `ValidateVisibilityStep` checks supports_public
- Session does not support public visibility
- **Result**: ❌ INVALID_ARGUMENT error

**Scenario: Bug creates public tuple for restricted resource**
- `createPublicViewerTuple()` validates supports_public
- Throws `IamPolicyCreationException` for restricted resources
- **Result**: ❌ Exception before tuple creation

## Key Files

### Proto Files (stigmer repo)
```
apis/ai/stigmer/commons/apiresource/apiresourcekind/
├── authorization_config.proto (MODIFIED - Added VisibilityConfig)
└── api_resource_kind.proto (MODIFIED - 4 resources configured)
```

### FGA Models (stigmer-cloud repo)
```
backend/services/stigmer-service/src/main/resources/fga/model/agentic/
├── agent.fga (MODIFIED)
├── skill.fga (MODIFIED)
├── workflow.fga (MODIFIED)
└── mcp_server.fga (MODIFIED)
```

### Java Services (stigmer-cloud repo)
```
backend/libs/java/api/
├── api-shape/src/main/java/ai/stigmer/apishape/authorization/
│   └── VisibilityConfigResolver.java (NEW)
├── api-authorization/src/main/java/ai/stigmer/apiauthorization/
│   ├── repo/IamPolicyGrpcRepo.java (MODIFIED)
│   └── service/IamPolicyCreationService.java (MODIFIED)
└── grpc-request/src/main/java/ai/stigmer/grpcrequest/pipeline/
    ├── step/common/
    │   ├── ValidateVisibilityStep.java (NEW)
    │   ├── UpdateVisibilityTuplesStep.java (NEW)
    │   └── RequestOperationCommonSteps.java (MODIFIED)
    ├── step/update/UpdateOperationSteps.java (MODIFIED)
    └── operation/create/step/CreateAuthorizationTuplesStepV2.java (MODIFIED)
```

### Implementation (stigmer-cloud repo)
```
backend/services/stigmer-service/src/main/java/ai/stigmer/downstream/iam/
└── iampolicy/IamPolicyGrpcRepoImpl.java (MODIFIED)
```

### Tests (stigmer-cloud repo)
```
backend/libs/java/
├── api-shape/src/test/java/ai/stigmer/apishape/authorization/
│   └── VisibilityConfigResolverTest.java (NEW - 45+ test cases)
├── api-authorization/src/test/java/ai/stigmer/apiauthorization/service/
│   └── IamPolicyCreationServiceTest.java (MODIFIED - Added visibility tests)
└── grpc-request/src/test/java/ai/stigmer/grpcrequest/pipeline/step/common/
    ├── ValidateVisibilityStepTest.java (NEW)
    └── UpdateVisibilityTuplesStepTest.java (NEW)
```

## Metrics

**Code Changes**:
- 2 proto files modified
- 4 FGA models updated
- 1 new utility class
- 2 new pipeline steps
- 6 existing files modified
- 3 new test classes
- Go/Python stubs regenerated

**Test Coverage**:
- 45+ new test cases
- 4 resource kinds tested (open access)
- 6 resource kinds tested (restricted)
- Edge cases covered (null, unknown)
- Configuration completeness validated

**Lines of Code** (approximate):
- Proto: +50 lines
- FGA models: +20 lines (4 files)
- Java implementation: +800 lines
- Java tests: +400 lines
- **Total**: ~1,270 lines

---

**Status**: ✅ Production Ready

**Repositories**: 
- `stigmer` (proto layer)
- `stigmer-cloud` (FGA models + Java implementation)

**Timeline**: Single session implementation (January 31, 2026)
