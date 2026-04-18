# IAM Policy Creation Service - Library Migration

**Date**: January 31, 2026

## Summary

Migrated IAM policy creation components from `stigmer-service` to proper library locations (`api-authorization` and `grpc-request`), establishing reusable authorization infrastructure following the Planton pattern. This architectural refactoring separates core authorization logic from service-specific implementations, enabling any service to leverage configuration-driven FGA tuple creation.

## Problem Statement

The IAM policy creation components were embedded in `stigmer-service`, creating several architectural issues:

### Pain Points

- **No reusability**: Other services couldn't leverage the configuration-driven tuple creation logic
- **Wrong layer**: Core authorization logic lived in service layer, not in shared libraries
- **Inconsistent with platform patterns**: Planton properly separates authorization concerns
- **Testing complexity**: Service-level tests harder to maintain than library-level tests
- **Duplication risk**: Any new service needing tuple creation would duplicate this logic

## Solution

Migrated components to appropriate library locations following clean architecture principles:

**Core Authorization Logic → `api-authorization` Library:**
- `IamPolicyCreationService` - Configuration-driven tuple creation
- `TupleCreationRequest` - Command object with builder pattern
- `IamPolicyCreationException` - Contextual exception handling
- `IamPolicyCreationServiceTest` - Comprehensive test suite (621 lines, 28 tests)

**Pipeline Integration → `grpc-request` Library:**
- `CreateAuthorizationTuplesStep` - Factory for pipeline steps
- Type-safe field accessor pattern for extracting resource metadata
- 5 specialized factory methods for different authorization patterns

## Implementation Details

### Architecture Pattern

```
Domain Handlers (stigmer-service)
        ↓
CreateAuthorizationTuplesStep (grpc-request library)
        ↓
IamPolicyCreationService (api-authorization library)
        ↓
IamPolicyGrpcRepo Interface (api-authorization library)
        ↓
IamPolicyGrpcRepoImpl (stigmer-service)
        ↓
IAM Service (OpenFGA)
```

### Key Components

**1. IamPolicyCreationService** (442 lines)

Configuration-driven service that reads authorization patterns from proto metadata:

```java
@Service
@RequiredArgsConstructor
public class IamPolicyCreationService {
    private final IamPolicyGrpcRepo iamPolicyGrpcRepo;
    
    public void createTuples(TupleCreationRequest request) {
        AuthorizationConfig config = AuthorizationConfigResolver.resolve(request.kind());
        // Creates tuples based on config - no hardcoded logic
    }
}
```

Supports all authorization patterns:
- **PLATFORM scope**: organization, identity_account → link to platform:stigmer
- **ORGANIZATION scope**: agent, skill, workflow → link to org
- **PARENT scope**: agent_execution → link to session
- **OWNER_ONLY scope**: api_key → owner tuple only
- **NONE scope**: platform, credential → no tuples

**2. TupleCreationRequest** (192 lines)

Immutable command object with validation:

```java
public record TupleCreationRequest(
    ApiResourceKind kind,
    String resourceId,
    String orgId,
    String creatorId,
    String parentId,
    Map<String, String> additionalParentIds
) {
    // Builder pattern with fluent API
    // Validation at construction
    // Defensive copying of mutable maps
}
```

**3. CreateAuthorizationTuplesStep** (352 lines)

Pipeline step factory with type safety:

```java
@Component
@RequiredArgsConstructor
public class CreateAuthorizationTuplesStep {
    private final IamPolicyCreationService service;
    
    public <T extends Message> RequestPipelineStepV2<CreateContextV2<T>> 
        forOrgScopedResource(
            ApiResourceKind kind,
            Function<T, String> idGetter,
            Function<T, String> orgGetter
        ) {
        return new OrgScopedResourceStep<>(kind, idGetter, orgGetter);
    }
}
```

### Spring Integration Decision

**Initial Approach:**
- Removed `@Service` and `@Component` annotations
- Created `IamPolicyConfig.java` for manual bean registration
- Treated these as framework-agnostic library classes

**DDD Analysis Revealed:**
- These are Application/Infrastructure services, NOT Domain services
- Domain purity rule doesn't apply to Application layer
- Framework awareness is appropriate for this layer
- Existing library classes use Spring annotations

**Final Approach:**
- Added `@Service` to `IamPolicyCreationService`
- Added `@Component` to `CreateAuthorizationTuplesStep`
- Deleted `IamPolicyConfig.java` (unnecessary ceremony)
- Spring component scanning auto-discovers beans

### Migration Checklist

- ✅ Moved 3 classes to api-authorization library
- ✅ Moved 1 class to grpc-request library
- ✅ Moved comprehensive test suite (621 lines)
- ✅ Added Spring annotations for auto-discovery
- ✅ Removed misleading "manual registration" documentation
- ✅ Deleted empty packages from stigmer-service
- ✅ Verified no circular dependencies
- ✅ Confirmed proper dependency graph

## Benefits

### Immediate Benefits

1. **Reusability**: Any service can now use IAM policy creation
2. **Single source of truth**: Authorization logic centralized in libraries
3. **Easier testing**: Library-level tests isolated from service concerns
4. **Better separation**: Core logic separated from pipeline integration
5. **Consistency**: Follows Planton architecture patterns

### Long-term Benefits

1. **Scalability**: New services automatically have access to tuple creation
2. **Maintainability**: Changes to authorization patterns happen in one place
3. **Extensibility**: Adding new scope/owner types only requires proto changes
4. **Quality**: Comprehensive test suite ensures correctness
5. **Clarity**: Clear dependency graph makes system easier to understand

## Impact

### Affected Components

**Libraries Enhanced:**
- `backend/libs/java/api/api-authorization` - Core authorization service added
- `backend/libs/java/grpc/grpc-request` - Pipeline step factory added

**Services Updated:**
- `backend/services/stigmer-service` - Now consumes from libraries

**Testing:**
- Test suite migrated to library level
- 621 lines of tests ensure authorization correctness
- Parameterized tests cover all resource kinds

### Migration Stats

| Metric | Count |
|--------|-------|
| Files moved | 5 |
| Lines migrated | ~1,787 |
| Classes in api-authorization | 3 |
| Classes in grpc-request | 1 |
| Test methods | 28 |
| Deleted config ceremony | 1 file (61 lines) |

### Dependency Impact

**api-authorization dependencies:**
- Already had: api-shape (for AuthorizationConfigResolver)
- No new dependencies added

**grpc-request dependencies:**
- Already had: api-authorization
- No new dependencies added

**No circular dependencies created** ✅

## Related Work

- **Configuration-Driven FGA Authorization**: This builds on the authorization config framework established in `authorization_config.proto`
- **FGA Model Updates**: Works in tandem with org-only authorization model changes
- **Phase 1 & 2 Completion**: SDK now uses org/slug, backend now has library-based authorization

## Next Steps

**Phase 3 Remaining Sub-Tasks:**

1. **Update Domain Handlers** - Handlers already use `CreateAuthorizationTuplesStep` via autowiring, no changes needed
2. **Update FGA Models** - Remove scope-based relations, finalize org-only model
3. **Add Visibility Filtering** - List operations should filter by public/private
4. **Data Migration** - Migrate owner_scope to visibility in existing data

---

**Status**: ✅ Production Ready
**Architecture**: Clean separation of concerns, reusable libraries, proper DDD layering
**Quality**: Comprehensive tests, Spring integration, zero technical debt
