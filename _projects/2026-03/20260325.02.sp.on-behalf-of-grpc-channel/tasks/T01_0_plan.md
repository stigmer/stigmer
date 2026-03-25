# Task T01: Implement On-Behalf-Of gRPC Channel Infrastructure

**Created**: 2026-03-25 10:53
**Status**: PENDING REVIEW
**Type**: Sub-Project of 20260325.01.auto-personal-org
**Estimated Effort**: ~5-6 hours

**This plan requires your review before execution.**

## Objective

Create gRPC on-behalf-of infrastructure so that downstream gRPC clients (using `inProcessChannelAsSystem`) can attribute resource ownership to a specific user identity instead of the machine account. This is a prerequisite for personal org auto-creation and fixes the existing execution context ownership problem.

## Parent Context

Spawned from **20260325.01.auto-personal-org** (Task 2: Server-side auto-creation).

**The problem**: When the system creates resources via `inProcessChannelAsSystem`, `CreateAuthorizationTuplesStepV2` uses the machine account as the caller, making it the FGA owner. The actual user — who triggered the operation — never appears in the ownership tuple.

**Industry precedent**: Kubernetes `Impersonate-User` header, AWS STS `AssumeRole`, Microsoft On-Behalf-Of flow.

## Design

### How it works

```
Temporal Activity / Handler Pipeline Step
  │
  ├─ Gets impersonated channel from factory:
  │    Channel ch = channelFactory.forIdentity(userId);
  │
  ├─ Makes gRPC call via impersonated channel:
  │    OrganizationCommandControllerGrpc.newBlockingStub(ch).create(org);
  │
  │   ┌──────────────────────────────────────────────────────┐
  │   │ OnBehalfOfClientInterceptor                          │
  │   │  • Attaches machine account JWT (from token injector)│
  │   │  • Adds x-on-behalf-of: <userId> metadata header     │
  │   └──────────────┬───────────────────────────────────────┘
  │                  │
  │   ┌──────────────▼───────────────────────────────────────┐
  │   │ Server-side Auth Interceptor (existing)              │
  │   │  • Validates machine account JWT ✓                   │
  │   │  • Sees x-on-behalf-of header                        │
  │   │  • Verifies caller IS machine account (trusted)      │
  │   │  • Overrides resolved identity → userId              │
  │   └──────────────┬───────────────────────────────────────┘
  │                  │
  │   ┌──────────────▼───────────────────────────────────────┐
  │   │ Handler Pipeline                                     │
  │   │  • context.getCaller().getIdentityAccountId() → userId│
  │   │  • CreateAuthorizationTuplesStepV2 → owner = userId  │
  │   └──────────────────────────────────────────────────────┘
```

### Key design decisions

1. **Metadata-based, not token-based**: We use a gRPC metadata header (`x-on-behalf-of`) rather than token exchange. The machine account JWT authenticates the system call; the header specifies attribution. No round-trips to Auth0.

2. **Trust boundary**: The server only honors `x-on-behalf-of` when the authenticated caller is the machine account. Non-system callers cannot impersonate — the header is silently ignored or rejected.

3. **Authorization stays with the system call**: The machine account's system-level access authorizes the operation. The on-behalf-of identity is used purely for ownership/attribution in FGA tuples, not for permission checks on the operation itself. This is deliberate — a newly created user has zero permissions, but the system should still be able to create their personal org.

4. **Composable with existing channels**: The `ImpersonatedChannelFactory` wraps the existing `inProcessChannelAsSystem` channel. No changes to channel beans or auto-configuration.

## Implementation Steps

### Step 1: Client-side interceptor

**New file**: `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/grpc/OnBehalfOfClientInterceptor.java`

- A `ClientInterceptor` that adds `x-on-behalf-of: <identityAccountId>` to outgoing gRPC call metadata
- Takes `identityAccountId` as a constructor parameter (each instance is scoped to one user)
- Stateless beyond the identity — no token management, no Auth0 calls

**Why api-authentication**: This interceptor is authentication infrastructure, same as `InProcessMachineAccountTokenInjectorInterceptor` and `InProcessAuthPropagationClientInterceptor`. It belongs in the same package.

### Step 2: Channel factory

**New file**: `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/grpc/ImpersonatedChannelFactory.java`

- A Spring `@Component` that takes `inProcessChannelAsSystem` channel via `@Qualifier`
- Provides: `Channel forIdentity(String identityAccountId)`
- Wraps the system channel with an `OnBehalfOfClientInterceptor` scoped to the given identity
- Callers get a channel that authenticates as machine account + attributes to the specified user

### Step 3: Server-side interceptor change

**Modified file**: The server interceptor that builds the `Caller` context from the JWT. Need to identify the exact file — it's the interceptor that extracts the identity account from the JWT claims and sets it on the gRPC `Context`.

**Change**: After resolving the authenticated identity from JWT:
1. Check if `x-on-behalf-of` metadata header is present
2. If present, verify the authenticated identity IS the machine account (trusted system principal)
3. If verified, override `caller.identityAccountId` with the value from the header
4. If the caller is NOT the machine account, ignore the header (or log a warning)

This is the most sensitive change — it modifies the security boundary. Must be reviewed carefully.

### Step 4: Update downstream gRPC repos to support on-behalf-of

**Modified files** (interface changes):
- `downstream/agentic/agentinstance/AgentInstanceGrpcRepo.java` — add `createOnBehalfOf(AgentInstance, String identityAccountId)`
- `downstream/agentic/executioncontext/ExecutionContextGrpcRepo.java` — add `createOnBehalfOf(ExecutionContext, String identityAccountId)`

**Modified files** (implementation changes):
- `downstream/agentic/agentinstance/AgentInstanceGrpcRepoImpl.java` — implement using `channelFactory.forIdentity()`
- `downstream/agentic/executioncontext/ExecutionContextGrpcRepoImpl.java` — implement using `channelFactory.forIdentity()`

The existing `createAsSystem()` methods remain for backward compatibility — they're correct for cases where machine account ownership IS intended. The new `createOnBehalfOf()` methods are for cases where a specific user should own the resource.

**Note**: We do NOT update callers in this sub-project. The existing agent instance and execution context creation code stays unchanged. The personal org auto-creation (parent Task 2) and any future ownership fixes will use the new methods. This keeps the sub-project focused on infrastructure.

### Step 5: Create OrganizationGrpcRepo (needed by parent project)

**New files**:
- `downstream/tenancy/organization/OrganizationGrpcRepo.java` (interface)
- `downstream/tenancy/organization/OrganizationGrpcRepoImpl.java` (implementation)

Methods:
- `Organization createOnBehalfOf(Organization org, String identityAccountId)` — for personal org creation
- `Organization createAsSystem(Organization org)` — for any future system-created orgs

This follows the established downstream gRPC client pattern (interface + impl in same downstream package).

### Step 6: Tests

- Unit test for `OnBehalfOfClientInterceptor`: verifies metadata header is attached
- Unit test for `ImpersonatedChannelFactory`: verifies channel wrapping
- Integration test for the server-side interceptor change: verify that a call with machine account JWT + `x-on-behalf-of` header results in `context.getCaller()` returning the impersonated identity
- Integration test for the full flow: create a resource via impersonated channel, verify FGA owner tuple has the correct identity

## Files Summary

### New files (stigmer-cloud)
| File | Purpose |
|------|---------|
| `backend/libs/java/api/api-authentication/.../OnBehalfOfClientInterceptor.java` | Client interceptor: adds x-on-behalf-of header |
| `backend/libs/java/api/api-authentication/.../ImpersonatedChannelFactory.java` | Factory: wraps system channel with on-behalf-of |
| `downstream/tenancy/organization/OrganizationGrpcRepo.java` | Organization downstream gRPC interface |
| `downstream/tenancy/organization/OrganizationGrpcRepoImpl.java` | Organization downstream gRPC implementation |

### Modified files (stigmer-cloud)
| File | Change |
|------|--------|
| Server-side auth/context interceptor (TBD) | Honor x-on-behalf-of from machine account |
| `downstream/agentic/agentinstance/AgentInstanceGrpcRepo.java` | Add createOnBehalfOf method |
| `downstream/agentic/agentinstance/AgentInstanceGrpcRepoImpl.java` | Implement createOnBehalfOf |
| `downstream/agentic/executioncontext/ExecutionContextGrpcRepo.java` | Add createOnBehalfOf method |
| `downstream/agentic/executioncontext/ExecutionContextGrpcRepoImpl.java` | Implement createOnBehalfOf |

## Open Questions

1. **Server-side interceptor identity**: Which exact file/class builds the `Caller` object from the JWT on the server side? Need to locate this before implementation.

2. **Machine account identification**: How do we reliably identify the machine account on the server side? By a specific `sub` claim pattern? By a known identity account ID? Need to verify.

3. **Header name**: `x-on-behalf-of` is descriptive. Alternatives: `x-impersonate-identity`, `x-stigmer-acting-as`. The name should be clear and unlikely to collide with external proxy headers.

## Success Criteria

- A downstream gRPC client can call `channelFactory.forIdentity(userId)` and get a channel that attributes ownership to that user
- Resources created via this channel have FGA `owner` tuples pointing to the specified user, not the machine account
- Non-system callers cannot use the on-behalf-of header to escalate privileges
- Existing `createAsSystem()` flows continue to work unchanged

## Review Process

**What happens next**:
1. **You review this plan** — especially the security boundary change in Step 3
2. **Provide feedback** — design concerns, naming preferences, scope adjustments
3. **I'll revise if needed** — create T01_1_review.md + T01_2_revised_plan.md
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in T01_3_execution.md
