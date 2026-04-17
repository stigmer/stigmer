# Next Task: 20260417.01.platform-client

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260417.01.platform-client

**Description**: Add PlatformClient IAM resource with OAuth2 client_id + client_secret credentials, a token-minting gRPC endpoint (via Connect), and user token minting so platform builders can embed Stigmer React components in browser apps without OIDC federation setup. Follows the industry-standard pattern used by Twilio, Stream, Liveblocks, and Knock.
**Goal**: Enable platform builders to embed Stigmer in their browser apps with minimal friction: create a PlatformClient, call the token-minting RPC from their backend with user identity, and use the returned Stigmer-signed JWT in the React SDK via getAccessToken. Users are auto-provisioned on first encounter (reusing JIT provisioning machinery).
**Tech Stack**: Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), React (Console UI), MDX (docs)
**Components**: PlatformClient proto (stigmer), token-minting gRPC service (stigmer-cloud), PlatformClientTokenAuthenticationProvider (stigmer-cloud), JIT provisioning reuse (stigmer-cloud), Node/Go/Python SDK auth config (stigmer), React components for PlatformClient CRUD (stigmer), Console pages (stigmer), federation/SDK docs (stigmer)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.01.platform-client/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Task Overview

| Task | Description | Effort | Repo | Status |
|------|-------------|--------|------|--------|
| T01 | Proto: PlatformClient resource definition | 1–2 sessions | stigmer | COMPLETE |
| T02 | Backend: PlatformClient CRUD + credential generation | 1–2 sessions | stigmer-cloud | COMPLETE |
| T03 | Backend: Token endpoint + Stigmer-signed JWT issuance | 2 sessions | stigmer-cloud | NOT STARTED |
| T04 | Backend: Auth chain integration + JIT provisioning | 1–2 sessions | stigmer-cloud | NOT STARTED |
| T05 | SDK: Node/Go/Python client support for PlatformClient auth | 1–2 sessions | stigmer | NOT STARTED |
| T06 | Console UI + Documentation | 2 sessions | stigmer | NOT STARTED |

## Current Status

**Created**: 2026-04-17
**Current Task**: T03 (Token endpoint + JWT issuance — next up)
**Status**: T01 + T02 complete, ready for T03

## Session Progress (2026-04-17, Session 1)

### Accomplished
- Completed T01: Full PlatformClient proto definition (6 proto files)
- Registered `platform_client` (enum value 23) in `ApiResourceKind`
- Added `can_create_platform_client` (enum value 24) to `IamPermission`
- Created overview documentation for PlatformClient resource
- Fixed SDK codegen to handle third service role (`token`) alongside `command` and `query`
- All stubs generated and compiling across Go, Java, TypeScript, Python, Dart

### Key Decisions Made (Session 1)
- Token endpoint is gRPC (via Connect) not REST — Connect gives HTTP/JSON for free, keeps API surface consistent
- `auto_grant_on_org` is bool (like IdentityProvider), not string — grants on the owning org
- `PlatformClientCreateResponse` wraps resource + one-time secret — makes secret return explicit in type system
- `mintUserToken` naming over `createToken` — precise, avoids CRUD collision
- Stigmer signs its own JWTs (not Auth0) — PlatformClient makes Stigmer a token issuer

## Session Progress (2026-04-17, Session 2)

### Accomplished
- Completed T02: Full PlatformClient CRUD + credential generation backend in stigmer-cloud
- Removed `apply` RPC from command.proto (incompatible with one-time secret response pattern)
- Fixed SDK codegen resource type inference (`inferResourceType` function) — codegen was incorrectly treating `PlatformClientCreateResponse` as the primary resource type
- Created credential generation utilities (`PlatformClientCredentialGenerator`, `PlatformClientConstants`)
- Created MongoDB repository (`PlatformClientRepo`) with `findByClientId` custom query
- Created Mongock migration for indexes (metadata.id, org+slug compound, spec.clientId)
- Implemented all 7 handlers: Create, Update, Delete, RotateSecret, Get, GetByReference, ListByOrg
- Wired gRPC auto controller for command + query services
- Both `bazel build` targets pass (`stigmer_service_lib`, `api-authentication`)

### Key Decisions Made (Session 2)
- `apply` RPC removed — create-or-update semantics incompatible with one-time secret response (PlatformClientCreateResponse vs PlatformClient return types)
- Redis caching deferred to T03 — only consumed by token endpoint
- `CustomOperationHandlerV2` used for create/rotateSecret (different I/O types) — standard `CreateOperationHandlerV2` can't handle `PlatformClientCreateResponse` return type
- Context data map pattern (`context.put()/get()`) for intermediate state when I != O in custom handlers
- `PreserveCredentials` step added to update handler — framework's `clearComputedFields` wipes computed spec fields during update, requiring explicit restoration from existing resource

### Discoveries
- Framework bug: `UpdateOperationBuildNewStateStepV2` calls `clearComputedFields` which clears ALL computed spec fields, then `preserveResourceIdentifiers` only restores metadata (not spec). Any resource with computed spec fields loses them on update. Mitigated for PlatformClient with a custom `PreserveCredentials` step. ApiKey may have the same latent issue.
- SDK codegen `inferResourceType` was fragile — took the first command method's output type, which broke when `apply` was removed (making `create` the first method with a wrapper return type). Fixed to prefer `update`/`delete` output types.

## Next Steps
1. Pick up T03 in stigmer-cloud: Token endpoint + Stigmer-signed JWT issuance
2. T03 scope: Redis caching for client_id lookups, PlatformClientTokenController wiring, mintUserToken handler, JWT signing infrastructure, PlatformClientGrpcRepoImpl (downstream in-process client)
3. T04 follows: PlatformClientTokenAuthenticationProvider (auth chain integration), JIT provisioning integration

## Context for Resume
- Proto files are at `apis/ai/stigmer/iam/platformclient/v1/{spec,api,io,command,query,token}.proto`
- The `apply` RPC was removed from command.proto in this session — codegen tools updated
- The `inferResourceType` codegen fix is in `tools/codegen/proto2schema/main.go` and `tools/codegen/generator/sdk_client.go`
- T02 backend implementation is in stigmer-cloud: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/iam/platformclient/`
- Credential utilities are in: `backend/libs/java/api/api-authentication/src/main/java/ai/stigmer/apiauthentication/platformclient/`
- T03 task plan is at `_projects/2026-04/20260417.01.platform-client/tasks/T03_0_plan.md` (needs creation)
- `PlatformClientTokenControllerGrpc` is NOT wired yet — deferred to T03

## Quick Commands

After loading context:
- "Continue with T03" - Start the next task (token endpoint in stigmer-cloud)
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
