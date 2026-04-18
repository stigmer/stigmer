# Next Task: 20260417.01.platform-client

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260417.01.platform-client

**Description**: Add PlatformClient IAM resource with OAuth2 client_id + client_secret credentials, a token-minting gRPC endpoint (via Connect), and user token minting so platform builders can embed Stigmer React components in browser apps without OIDC federation setup. Follows the industry-standard pattern used by Twilio, Stream, Liveblocks, and Knock.
**Goal**: Enable platform builders to embed Stigmer in their browser apps with minimal friction: create a PlatformClient, call the token-minting RPC from their backend with user identity, and use the returned Stigmer-signed JWT in the React SDK via getAccessToken. Users are auto-provisioned on first encounter (reusing JIT provisioning machinery).
**Tech Stack**: Protobuf, Java/Spring (stigmer-cloud backend), TypeScript (SDK), Go (SDK), Python (SDK), React (Console UI), MDX (docs)
**Components**: PlatformClient proto (stigmer), token-minting gRPC service (stigmer-cloud), PlatformClientTokenAuthenticationProvider (stigmer-cloud), JIT provisioning reuse (stigmer-cloud), Node/Go/Python SDK auth config (stigmer), React components for PlatformClient CRUD (stigmer), Console pages (stigmer), federation/SDK docs (stigmer)

## Current State (COMPLETE)

- **Status**: All tasks T01–T06 complete. Codegen import bug fixed. Project ready for final merge prep.
- **Last session**: 2026-04-18 (session 10) — Fixed codegen generator bug where method types in non-standard proto files (token.proto) were incorrectly imported from io_pb. Fixed both TS and Python generators, regenerated all SDKs.
- **Active task**: None — all tasks complete.

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
| T02 | Backend: PlatformClient CRUD + credential generation | 1–2 sessions | stigmer-cloud | COMPLETE (FGA gap closed in session 7) |
| T03 | Backend: Token endpoint + Stigmer-signed JWT issuance | 2 sessions | stigmer-cloud | COMPLETE |
| T04 | Backend: Auth chain integration + JIT provisioning | 1 session | stigmer + stigmer-cloud | COMPLETE |
| T05 | SDK: TypeScript/Go/Python/Java client support for PlatformClient auth | 1 session | stigmer | COMPLETE |
| T06 | Console UI + Documentation | 2 sessions | stigmer | COMPLETE |

## Current Status

**Created**: 2026-04-17
**Current Task**: None — all tasks complete
**Status**: T01–T06 complete. Codegen import bug fixed in session 10. Project finished in 10 sessions.

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

## Session Progress (2026-04-17, Session 3)

### Accomplished
- Completed T03: mintUserToken gRPC endpoint + Stigmer-signed JWT issuance
- Changed proto option from `is_skip_authorization` to `is_public` on `mintUserToken` — the endpoint is public; handler validates client credentials as business logic
- Created JWT signing infrastructure (`StigmerJwtSigningConfig`, `StigmerJwtIssuer`) using `com.auth0:java-jwt` with RSA-256 signing
- Created Redis caching for PlatformClient lookups by client_id (cache-aside: Redis → MongoDB)
- Created `PlatformClientCredentialValidator` with constant-time hash comparison and expiry checking
- Created `MintUserTokenHandler` using `CustomOperationHandlerV2` pipeline pattern
- Wired `PlatformClientTokenControllerGrpc` in `@AutoGrpcRouterController`
- Added signing key config to `application.yaml`
- Both `bazel build` targets pass cleanly

### Key Decisions Made (Session 3)
- **gRPC, not REST**: The original plan called for a REST endpoint following OAuth2 conventions. Changed to gRPC because all infrastructure is gRPC-based, zero REST controllers exist in the codebase, SDKs mediate access, and the proto already defines the RPC.
- **`is_public` over `is_skip_authorization`**: The endpoint is public — no Bearer token expected. The handler validates client credentials as business logic (like a login endpoint validates username/password).
- **No JWKS endpoint**: Stigmer validates its own tokens in-process (T04). JWKS deferred until external verification need emerges.
- **No `mintClientToken`**: Only `mintUserToken` implemented. M2M tokens deferred until demand emerges.
- **Simplified lookup: direct Mongo, no gRPC repo**: The plan called for a gRPC repo pattern (like API keys). But the API key pattern uses gRPC indirection because its introspector runs in shared infrastructure that can't access Mongo repos. The `MintUserTokenHandler` is in stigmer-service domain and has direct Mongo access. Eliminated 3 unnecessary files.
- **Identity resolution deferred to T04**: The JWT `sub` claim uses the platform's external `user_id` (not a Stigmer IdentityAccount ID). T04's auth chain resolves this to an IdentityAccount. See design decision 003.

### Discoveries
- `RequestMethodMetadataRegistry` automatically extracts `isPublic` from proto method descriptor options. No manual registration needed — just changing the proto option is sufficient.
- `InterceptorAwareCustomOperationContextFactory` handles public methods correctly — allows `caller == null` when `methodMetadata.getIsPublic()` is true. The `InvitationGetByTokenHandler` is the existing precedent.
- The `PlatformClientTokenController` service does not need `api_resource_kind` option since it's not a resource lifecycle service. The `CustomOperationContextV2.getResourceKind()` returns null, which is fine since the handler doesn't use it.

## Session Progress (2026-04-17, Session 4)

### Accomplished
- Completed T04: Auth chain integration + JIT provisioning
- OSS: Added `platform_client = 4` to `IdentityAccountProvisioningMode`, extended `idp_id` doc comments, `make codegen`
- Cloud: Refactored `StigmerJwtIssuer` into `StigmerJwtKeySource` + `StigmerJwtIssuer` + `StigmerJwtVerifier`
- Cloud: Created `PlatformClientIdentityEncoding` — composite `stgm_pc|{pcid}|{extUid}` encoding
- Cloud: Created `PlatformClientAccountProvisioner(Impl)` — resolve-or-provision with ALREADY_EXISTS recovery
- Cloud: Added `ResolveOrProvisionUser` pipeline step to `MintUserTokenHandler`; JWT `sub` is now IdentityAccount ID
- Cloud: Created `PlatformClientTokenAuthenticationProvider` + `PlatformClientAuthenticationToken`
- Cloud: Wired provider into auth chain: API key → Stigmer JWT → federated → Auth0
- Cloud: Updated `RequestCallerIdentityMapper` with PlatformClient branch; added `platformClientId` to `RequestCallerIdentity`
- 7 tests pass (4 new + 3 existing unbroken)

### Key Decisions Made (Session 4)
- **Mint-time JIT** (supersedes DD-003): provisioning at `mintUserToken`, not at token validation. Aligns with proto contract.
- **Composite `idp_id`**: `stgm_pc|{platform_client_id}|{external_user_id}` — globally unique by construction, no mapping table, no scope fields.
- **No live `ApiResourceReference` to PlatformClient on IdentityAccount**: PlatformClient is an admission credential, not an ongoing auth authority. The `platform_client_id` baked into `idp_id` is an immutable historical marker.
- **No new Mongo collections or indexes**: existing sparse unique `spec.idpId` index is sufficient.

### Discoveries
- `IdpIdToIdentityAccountIdCacheProxy.proxyGet()` returns the raw `idpId` as fallback when no account is found (for non-machine accounts). The provisioner detects this by comparing the returned value against the composite `idpId` — equality means "not resolved."
- `IamRole` enum values in the proto have `iam_role_unspecified = 0` and `UNRECOGNIZED` for unknown wire values. Both must be checked when defaulting `auto_grant_role` to viewer.

## Session Progress (2026-04-17, Session 5)

### Accomplished
- Completed T05: PlatformClient auth helpers in all four SDKs (TypeScript, Go, Python, Java)
- Wrote DD-005 superseding T05_0_plan.md (gRPC pivot, no client_credentials grant, no SDK-level caching, mintUserToken naming, Java inclusion)
- TypeScript: `createPlatformClientAuth` in `@stigmer/sdk/node`, 6 tests passing
- Go: `NewPlatformClientAuth` with functional options, 5 tests passing, `go build ./...` clean
- Python: `platform_client_auth(...)` factory with dataclasses, tests written
- Java: `PlatformClientAuth.builder(...)` with `AutoCloseable`, 7 tests written
- Integration docs: `docs/guides/platform-client-auth.mdx` with all four language snippets + React wiring
- Runnable example: `sdk/typescript/examples/mint-user-token.ts`

### Key Decisions Made (Session 5)
- **Separate helper, not a new auth mode**: PlatformClient credentials don't replace `apiKey`. Adding them to the main client would imply they do.
- **No SDK-level token caching**: Token is user-keyed; caching is the platform builder's concern. Non-breaking to add later.
- **Java as first-class peer**: Original T05 plan omitted it. Codegen already had the wire method; only the ergonomic wrapper was missing.
- **Server-only by construction (TypeScript)**: Exported from `@stigmer/sdk/node` only. No browser entry exposure.

## Session Progress (2026-04-17, Session 6)

### Accomplished
- Completed T06 Console UI half: full-CRUD PlatformClient management in `@stigmer/react` + Console
- 6 hooks in `sdk/react/src/platform-client/`: `usePlatformClientList`, `usePlatformClient`, `useCreatePlatformClient`, `useUpdatePlatformClient`, `useDeletePlatformClient`, `useRotatePlatformClientSecret`
- 4 components: `PlatformClientListPanel`, `CreatePlatformClientForm`, `PlatformClientDetailPanel`, `PlatformClientSecretAlert`
- Console section (`PlatformClientsSection`) with flow state machine: idle → creating → revealing → editing
- Route at `/settings/platform-clients` with nav entry under Configuration (Plug icon)
- SDK barrel: exported `PlatformClientClient` + `PlatformClientInput` from `@stigmer/sdk`
- React barrel: 12 exports + 12 type exports in `@stigmer/react`
- All 128 existing tests pass, zero lint errors, TypeScript clean (only pre-existing codegen stub issue)

### Key Decisions Made (Session 6)
- **SDK-first, not Console-first**: PlatformClient CRUD built in `@stigmer/react` following IdentityProvider pattern, consumed from Console. Keeps option open for platform builders to embed admin UI.
- **IdentityProvider as reference, not ApiKey**: IdP has the full CRUD shape (list + single-get + create + update + delete + detail-with-edit). ApiKey is list-only with no edit.
- **Dropped PlatformClientQuickStart component**: No compelling embedded use case — platform builders create PlatformClients in the Stigmer Console, not in their own apps. Auth guide docs are sufficient.
- **Revealing flow state for one-time secrets**: Both `create` and `rotateSecret` return `PlatformClientCreateResponse` with raw secret. A single `PlatformClientSecretAlert` component handles both entry points. Console section has a `revealing` state entered from both `creating→success` and `editing→rotate-success`.
- **No demo fixtures**: Deferred as low-priority — demo client doesn't need PlatformClient mocks for the Console to be functional.

### Pre-existing Issue Noted
- Codegen file `sdk/typescript/src/gen/platformclient.ts` imports `MintUserTokenRequest`/`MintUserTokenResponse` from `io_pb` but they live in `token_pb`. Needs `make codegen` re-run to fix. Not introduced by session 6.

## Session Progress (2026-04-17, Session 7)

### Accomplished
- Closed FGA authorization gap in stigmer-cloud: `platform_client` type was missing from the OpenFGA model
- Added `iam/platform_client.fga` — Restricted access model mirroring `oauth_app.fga` (viewer = owner + admin from org)
- Added `can_create_platform_client` and `can_create_oauth_app` to `organization.fga` (both gated on admin)
- Registered `iam/platform_client.fga` in `fga.mod`
- Created `ProtoFgaSchemaConsistencyTest` — walks every proto RPC method option and asserts the (resource_kind, permission) pair exists as a relation in the FGA model
- Created `PlatformClientAuthorizationTest` — tests CreateAuthorizationTuples, GetByReference Authorize, and RotateSecret LoadAndAuthorize steps
- All 4 new tests pass, all existing tests unbroken
- Wrote DD-006 documenting the gap, root cause, and structural guard

### Key Decisions Made (Session 7)
- **Restricted, not Personal**: PlatformClients are org-level infrastructure (like OAuthApp), not personal credentials (like ApiKey). Admins need governance visibility.
- **Fix both gaps together**: The `can_create_oauth_app` omission in `organization.fga` was the same bug class as `can_create_platform_client`. Fixed in one coherent FGA change.
- **ProtoFgaSchemaConsistencyTest as structural guard**: Catches proto↔FGA drift at compile time. Explicit descriptor enumeration is intentional — forces developers to register new service protos.

### Discoveries
- `can_create_oauth_app` was also missing from `organization.fga` since OAuthApp landed (commit `ad6de7b1`). Pre-existing latent bug — OAuthApp `create` was also silently broken at the FGA authorization layer.
- The `IamPolicyCreationServiceTest` in `api-authorization` exists as a Java file but has no Bazel test target — its tests never run in CI.

## Remaining Pre-Merge Work
1. ~~Fix pre-existing codegen stub import issue (`MintUserToken*` in `io_pb` vs `token_pb`) via `make codegen`~~ — **DONE** (session 10)
2. Commit remaining uncommitted files in stigmer-cloud: generated stubs (from `make protos`), handler code (cache/, token/, handler/token/), auth chain code (platformclient/auth/, platformclient/jwt/), and broader feature-branch changes
3. Demo components for PlatformClient Console UI (deferred — separate engineering task)

## Session Progress (2026-04-18, Session 10)

### Accomplished
- Fixed codegen generator bug: method types in non-standard proto files were incorrectly imported from `io_pb`/`io_pb2`
- **TypeScript generator** (`sdk_client_ts.go`): Added `methodTypeFileMap` from `schema.MethodTypes`, lookup before `io_pb` fallback
- **Python generator** (`sdk_client_python.go`): Added `pyProtoFileToModule`, `pyMethodTypePb2Prefix`, `pyTrackMethodTypeImport` helpers; `extraPb2Modules` tracking with deduplication; same-package-only restriction for cross-package safety
- Fixed hand-written `sdk/typescript/src/platform-client-auth.ts` import (`io_pb` → `token_pb`)
- Ran `make codegen` — regenerated all 4 SDK clients
- Verified: TypeScript 114 tests passed, Go all tests passed, codegen generator tests passed
- Bonus: Fixed two pre-existing Python annotation bugs (`_iampolicy.py`, `_environment.py`) from same root cause

### Key Decisions Made (Session 10)
- **Generator fix over proto reorganization**: User proposed moving `mintUserToken` to command.proto and messages to io.proto to avoid the bug. Pushed back: `mintUserToken` is a public endpoint (no Bearer token), not a resource command. Mixing auth models in one service controller would be incorrect. The generator fix uses data the schema already provides.
- **Same-package restriction for Python map**: Cross-package types (e.g., `ApiResourceAuditActor` from commons) must NOT go through `methodTypePb2Map` — they need separate import handling. Restricting to `strings.HasPrefix(mt.ProtoType, schema.Package+".")` prevents false routing.
- **Deduplication over filtering**: `extraPb2Modules` emitter skips `io_pb2`/`spec_pb2` when already imported by `needsIoPb2`/`needsSpec` flags, preventing duplicate import lines.

### Discoveries
- The Python generator had a broader class of the same bug: `IamPolicySpec` and `ApiResourceRef` (defined in spec.proto) were annotated as `io_pb2.X` in `_iampolicy.py`. Same for `EnvironmentValue` in `_environment.py`. The fix corrected these as a side effect.
- Python and Java SDK tests can't run locally due to unresolvable proto dependencies (`stigmer-protos>=0.1.0`, `stigmer-java-protos`). Pre-existing environment limitation, not a regression.

## Session Progress (2026-04-18, Session 9)

### Accomplished
- Completed T06 documentation pass — the final task in the PlatformClient project
- Fixed factual inaccuracies in `docs/concepts/identity.mdx` (was claiming no auto-provisioning)
- Added "Platform" as a fourth account type in the identity concepts page with Mermaid sequence diagram
- Added PlatformClient to `docs/vocabulary.md` (quick-reference table + full detailed entry)
- Added PlatformClient tooltip to `site/src/components/docs/glossary.ts`
- Polished `docs/guides/authentication/platform-client/overview.mdx` with "When to use this", troubleshooting `<Steps>`, and "What's next"
- Updated cross-references in `docs/concepts/organizations.mdx`
- Verified all 6 pages that reference PlatformClient guide link correctly
- Zero stale links to old `docs/guides/federation/` or `docs/guides/platform-client-auth.mdx` paths

### Key Decisions Made (Session 9)
- **Platform as a fourth account type**: PlatformClient-provisioned accounts are NOT a sub-category of Federated. Different trust model (Stigmer signs tokens), different auth chain, different idp_id encoding. Presented as a peer alongside Direct, Federated, and Machine.
- **Kept single-page guide**: Pushed back on the original 4-page plan (overview + quick-start + token-endpoint + auto-provisioning). PlatformClient's simplicity is its value — one comprehensive page is proportional.
- **Renamed "JIT provisioning" to "Automatic account creation"**: Plainer language for guides context.
- **Deferred demo components**: Creating demo components for PlatformClient Console UI is engineering work, not a documentation task. Separate session.

## Session Progress (2026-04-17, Session 8)

### Accomplished
- Rescoped PlatformClient identity resolution from per-PlatformClient to per-org
- Changed composite `idp_id` from `stgm_pc|{platform_client_id}|{external_user_id}` to `stgm_pc|{org}|{external_user_id}`
- Updated proto docstrings in 3 files (identityaccount/spec.proto, platformclient/spec.proto, platformclient/token.proto)
- Updated `PlatformClientIdentityEncoding.composeIdpId(org, externalUserId)` in stigmer-cloud
- Updated `PlatformClientAccountProvisionerImpl` to use org instead of clientId for identity resolution
- Updated `PlatformClientProvisioningException.UnknownUserException` error message to reference org
- Rewrote `PlatformClientIdentityEncodingTest` for org-scoped parameters
- Added `OrgScopedResolutionTests` to `PlatformClientAccountProvisionerImplTest` (3 new tests)
- Added org-scoped identity resolution paragraph to `docs/guides/platform-client-auth.mdx`
- Ran `make codegen` (stigmer) and `make protos` (stigmer-cloud) --- all stubs regenerated
- Verified FGA model (`platform_client.fga`) needs no changes --- already org-scoped
- Committed: OSS `f202c6988`, Cloud `2796fff9`

### Key Decisions Made (Session 8)
- **Org-scoped, not per-PlatformClient**: Same user_id from any PlatformClient in the same org resolves to one IdentityAccount. Matches the common multi-app embedding pattern.
- **Email is profile data only**: Never used as a lookup key. Updated on each mintUserToken call. Two different users in the same org can share an email.
- **Keep PlatformClient name**: After evaluating EmbedApp, IntegrationApp, and others, decided the current name is directionally correct and not worth the churn.
- **No migration**: Pre-GA feature on feature branch. Any existing test data with the old format should be wiped.

### Research and Analysis
- Investigated whether Auth0 or WorkOS offer equivalent functionality to PlatformClient
- Auth0: Custom Token Exchange (CTE) is the closest equivalent, but locked behind B2B Professional ($800/mo) / Enterprise plans and still in Early Access
- WorkOS: No equivalent feature at any tier. M2M is app-scoped (not user-scoped), Impersonation is admin-only debugging tool
- Conclusion: PlatformClient is a genuine product differentiator that neither major IDP sells at a reasonable price point

## Context for Resume
- React hooks + components: `sdk/react/src/platform-client/` (11 files)
- Console section: `client-apps/web/src/components/settings/PlatformClientsSection.tsx`
- Console route: `client-apps/web/src/app/settings/platform-clients/page.tsx`
- Nav entry: `client-apps/web/src/components/layout/settings-nav.ts` (Plug icon under Configuration)
- SDK barrel export: `sdk/typescript/src/index.ts` (`PlatformClientClient`, `PlatformClientInput`)
- React barrel export: `sdk/react/src/index.ts` (12 + 12 type exports)
- Generated client surface: `stigmer.platformclient.*` (lowercase, codegen-driven)
- Proto files: `apis/ai/stigmer/iam/platformclient/v1/{spec,api,io,command,query,token}.proto`
- SDK helpers (T05): `sdk/typescript/src/platform-client-auth.ts`, `sdk/go/platform_client_auth.go`, `sdk/python/src/stigmer/platform_client_auth.py`, `sdk/java/src/main/java/ai/stigmer/sdk/PlatformClientAuth.java`
- Integration docs (T05): `docs/guides/platform-client-auth.mdx`
- Design decisions: DD-004, DD-005, DD-006 (FGA gap)

## Quick Commands

After loading context:
- "Continue with T06 docs" - Start the documentation pass (session 8)
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
