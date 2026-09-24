/**
 * The @stigmer/server library contract (DD-005, sub-project 20260826.09).
 *
 * This file IS the blessed surface: the package.json exports map resolves
 * the bare package name here and nowhere else, so everything a consumer
 * (the cloud composition, or any composition built on the published
 * package) may import appears below — and nothing else does. Deep imports
 * into dist/ internals are unsupported; anything a consumer needs that is
 * not exported is a seam request to OSS, never a reach-around. Additions
 * to this file are owner-visible surface changes, extended only through
 * gates (the DD-005 review property: a surface change is a one-file diff).
 *
 * The surface is exactly what the ratified architecture names (blueprint
 * 20260826.02/03 §1) and the parameter types those entries force:
 *   - the compose entry and config loading (composeServer + its options'
 *     required types: ServerConfig via loadConfig, Logger via createLogger)
 *   - the extension-point types (§2 — the whole src/extensions contract)
 *   - the pipeline primitives extensions build gates AND extension-
 *     registered services from (PipelineStep, RequestContext, the semantic
 *     error helpers, and the typed store not-found errors the ratified
 *     store-fault mapping keys on; C4 Stage 3 added the dispatch-policy
 *     configs and the loaded-execution context key its capacity gates
 *     consume; C4 Stage 4 added the executor, the identity read idiom,
 *     and the two chain-front steps so extension services run the SAME
 *     request idiom OSS controllers run)
 *   - the driver interfaces (Store, ArtifactStorage; O5 added §6a/§6b/§6c —
 *     ModelCatalogProvider, the widened storage surface, and
 *     RunnerCredentialProvider; O6 added §6d — SandboxProvisioner and its
 *     factory/registration types)
 *   - the worker factory types extension workers implement (§8)
 *   - the Postgres driver constructor (20260910.04 ruling 4), for a
 *     composition that shares ONE database with this chain
 *
 * The package publishes to npm in lockstep with every other @stigmer/*
 * package (stigmer-cloud project 20260910.04, amending DD-005): this file
 * is the versioned contract a consumer pins by exact version. Everything
 * below the barrel is internal and may change between releases without
 * notice; everything on it changes only through a gate. The same server
 * also ships as @stigmer/server-slim — the bundled deployable `stigmer up`
 * launches — which exports nothing and is not a library.
 */

// The compose entry and config loading.
export { composeServer } from "./boot/compose.js";
export type { ComposeOptions, ComposedServer } from "./boot/compose.js";
export { loadConfig } from "./boot/config.js";
export type { ServerConfig } from "./boot/config.js";
export { createLogger } from "./boot/logger.js";
export type {
  LogEntry,
  LogFields,
  Logger,
  LoggerOptions,
  LogLevel,
  LogSink,
} from "./boot/logger.js";

// The extension-point types (DD-006 — the seven-point registry).
export type {
  ExtensionServiceRegistration,
  ResolvedExtensions,
  ResolvedServiceRegistration,
  ServerExtension,
} from "./extensions/registry.js";
export type {
  CallerClass,
  CallerIdentity,
  IdentityVerifier,
} from "./extensions/identity.js";
// The 20260902.02 seam: post-authentication caller guards
// (ServerExtension.callerGuards) — enforcement of the MINTING CLIENT's
// contract, run by the serving chassis after the position-1 identity
// stamp and never by the in-process chain (the structural exemption).
// The composition owns WHO is exempt and WHAT refuses (skip sets,
// byte-pinned copy, liveness reads); OSS owns the walk, the fault
// mapping (ConnectError = the guard's wire shape; any other throw =
// INTERNAL), and the ordering.
export type { CallerGuard } from "./extensions/caller-guards.js";
// The caller-identity read idiom for extension-registered services (C2
// Stage 3, 20260827.10): extension RPC handlers traverse the same
// interceptor chain as OSS controllers, so the identity stamped at chain
// position 1 is already on the HandlerContext — the exported accessor
// below (with the R5 propagation surface) is the ONE sanctioned way to
// read it.
export type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "./extensions/authorizer.js";
export type { GateSlotName } from "./extensions/gate-slots.js";
export type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusHooks,
  AgentExecutionStatusObserver,
  AgentExecutionStatusTransition,
} from "./extensions/status-hooks.js";
export type { ExtensionDrivers } from "./extensions/drivers.js";
export type { ResolvedExtensionDrivers } from "./extensions/registry.js";
// The C2 seams (20260827.10): the tuple-lifecycle driver point and the
// organization query directory, plus the shape-policy helpers a driver's
// tests pin against.
export type {
  DefaultInstanceLinkedEvent,
  PolicyGrantedEvent,
  PolicyRevokedEvent,
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
  VisibilityChangedEvent,
  VisibilityTupleShape,
  ResolvedParentLink,
} from "./extensions/resource-authorization.js";
export type { OrganizationDirectory } from "./extensions/organization-directory.js";
export { ALL_ORGANIZATIONS } from "./extensions/organization-directory.js";
// The license-status seam (drivers.licenseStatus): the provider an
// Enterprise composition registers so getLicenseStatus answers from its
// configured ticket. The built-in `absent` default is the composition
// root's and is not exported.
export type {
  LicenseStatusProvider,
  LicenseStatusReport,
} from "./extensions/license-status.js";
// The outbound-egress seam (drivers.outboundEgress): which addresses the
// control plane may dial when it reaches a URL a user supplied. Both
// postures are exported so a composition registers one line and owns no
// copy of the address ranges (the classification lives in
// @stigmer/outbound/egress, shared with the runner's web_fetch guard).
export type { OutboundEgressPolicy } from "./extensions/outbound-egress.js";
export {
  relaxedEgressPolicy,
  strictEgressPolicy,
} from "./extensions/outbound-egress.js";
// The 20260911.11 identity-account seams (Q-IA-9): the store PORT a
// composition drives the domain through (drivers.identityAccountStore;
// a driver throws DuplicateAccountError for a held id), the federation
// capability (drivers.identityFederation), and the ONE subject →
// identityId rule both OSS verifiers already apply, exported so a
// composition's own verifier converges on it instead of restating it.
export type { IdentityAccountStore } from "./domain/identityaccount/store.js";
export { DuplicateAccountError } from "./domain/identityaccount/store.js";
// The port's contract as a vitest-free kit: a driver's own test iterates
// the same cases the OSS adapter passes, so the port is proven per
// driver, never restated per repository.
export type {
  IdentityAccountStoreContractCase,
  IdentityAccountStoreContractFixture,
} from "./domain/identityaccount/store-contract.js";
export { identityAccountStoreContract } from "./domain/identityaccount/store-contract.js";
// The 20260913.01 IamPolicy seams (Q-OR-1, Q-OR-10): the store PORT a
// composition drives the domain's grant path through (drivers.iamPolicyStore;
// a driver throws DuplicatePolicyError for a held id) and its vitest-free
// contract kit; the grant scope (drivers.policyGrantScope — which kinds an
// edition grants on, with which roles; open source's default is the
// organization alone); and the tuple-half query engine
// (drivers.authorizationQueries — the three graph questions only an
// authorization backend answers). The grant path itself is NOT exported: a
// composition reaches it as in-process RPCs, the doctrine.
export type { IamPolicyStore } from "./domain/iampolicy/store.js";
export { DuplicatePolicyError } from "./domain/iampolicy/store.js";
export type {
  IamPolicyStoreContractCase,
  IamPolicyStoreContractFixture,
} from "./domain/iampolicy/store-contract.js";
export { iamPolicyStoreContract } from "./domain/iampolicy/store-contract.js";
export type { PolicyGrantScope } from "./extensions/policy-grant-scope.js";
export type { AuthorizationQueryEngine } from "./extensions/authorization-queries.js";
// How an access list names a grantee that is not a person
// (drivers.principalDisplay): a team, in the editions that serve teams.
export type { PrincipalDisplay } from "./extensions/principal-display.js";
export type { IdentityFederation } from "./extensions/identity-federation.js";
export type { AccountsBySubject } from "./domain/identityaccount/resolve.js";
export { identityIdForSubject } from "./domain/identityaccount/resolve.js";
// The PlatformClient seams: the store PORT a composition drives the domain
// through (drivers.platformClientStore; a driver throws
// DuplicatePlatformClientError for a held id, slug or client_id) and its
// vitest-free contract kit; the guest-token capability
// (drivers.guestTokenMinting — the one token method only an edition that
// hosts shared-agent pages serves); and the builder of the system-managed
// client such an edition keeps per organization under the reserved slug,
// so the tokens it signs for guests and schedule fires name a real client.
export type { PlatformClientStore } from "./domain/platformclient/store.js";
export { DuplicatePlatformClientError } from "./domain/platformclient/store.js";
export type {
  PlatformClientStoreContractCase,
  PlatformClientStoreContractFixture,
} from "./domain/platformclient/store-contract.js";
export { platformClientStoreContract } from "./domain/platformclient/store-contract.js";
export type { GuestTokenMinting } from "./extensions/guest-token-minting.js";
export type { SystemManagedPlatformClientInput } from "./domain/platformclient/system-managed.js";
export { newSystemManagedPlatformClient } from "./domain/platformclient/system-managed.js";
export { SYSTEM_SHARE_CLIENT_SLUG } from "./domain/platformclient/constants.js";
// The platform-token envelope and its key ring: the RS256 JWT every token
// the server signs for itself rides. A composition supplies its ring
// (drivers.platformTokenKeys, built from its PEMs), signs its own typed
// lanes through the envelope — each with its own lifetime when it is not
// the ring's default, the expiry handed back — and verifies them with the
// same function and refusal copy open source's user-token lane uses.
export type {
  PlatformTokenClaimValue,
  PlatformTokenRefusal,
  PlatformTokenSigningOptions,
  PlatformTokenVerification,
  SignedPlatformToken,
  VerifiedPlatformToken,
} from "./platformtoken/envelope.js";
export {
  PLATFORM_TOKEN_ISSUER,
  PLATFORM_TOKEN_REFUSAL_MESSAGES,
  TOKEN_TYPE_CLAIM,
  decodeVerifiedPlatformTokenPayload,
  platformTokenRefusalError,
  signPlatformToken,
  stringClaim,
  verifyPlatformToken,
} from "./platformtoken/envelope.js";
export type {
  PlatformTokenKeyMaterial,
  PlatformTokenKeyRing,
  PlatformTokenSigner,
  SigningPlatformTokenKeyRing,
} from "./platformtoken/key-ring.js";
export {
  DEFAULT_PLATFORM_TOKEN_TTL_SECONDS,
  canSign,
  platformTokenKeyRingFromPem,
} from "./platformtoken/key-ring.js";
// The built-in authorizer's model seams: the kind
// declarations (transcripts of the cloud's `.fga` files), the evaluator,
// and the OpenFGA store-test kit — exported so the cloud's drift test
// compares the live model against the transcripts and runs its live
// store tests through the evaluator, both from the published package.
// The drivers themselves are composed by the root and are not exported.
export type {
  DerivedRelation,
  KindDeclaration,
  Rewrite,
  SubjectType,
} from "./authorization/model/rewrite.js";
export type { Model } from "./authorization/model/index.js";
export {
  builtInModel,
  declarationFor,
  newModel,
} from "./authorization/model/index.js";
export type {
  ObjectRef,
  Person,
  Subject,
  Tuple,
  TupleSource,
} from "./authorization/tuples.js";
export type { EvaluationFault } from "./authorization/evaluator.js";
export {
  AuthorizationEvaluationError,
  MAX_RESOLUTION_DEPTH,
  checkRelation,
} from "./authorization/evaluator.js";
export type {
  StoreTestCase,
  StoreTestDocument,
  StoreTestKit,
  StoreTestSkip,
  StoreTestSkipReason,
} from "./authorization/store-test-kit.js";
export {
  parseStoreTestDocument,
  storeTestCases,
} from "./authorization/store-test-kit.js";
// The kinds whose missing row the built-in authorizer denies instead of
// answering not-found — the cloud's probe exemption over the open-source
// tier; exported so the cloud's drift test pins the two sets equal.
export { NOT_FOUND_EXEMPT_KINDS } from "./authorization/authorizer.js";
export type {
  ListReadScope,
  ListEntryMeta,
} from "./extensions/list-read-scope.js";
// The one consumption idiom of the list read scope for post-scan list lanes:
// exported so a list lane a composition serves from its own table narrows
// its rows exactly as the library's lanes do, instead of building each
// candidate's authorization facts by hand.
export { restrictListByReadScope } from "./extensions/list-read-scope.js";
// The stigmer-cloud#572 seam: the identity a schedule fire acts as
// (drivers.scheduleFireCaller) — the composition mints it per fire; the
// RunStarter propagates it through the R5 in-process header. A mint that
// can act as nobody throws the seam's typed refusal, which the RunStarter
// counts against the schedule instead of retrying.
export type { ScheduleFireCallerMint } from "./extensions/schedule-fire-caller.js";
export { ScheduleFireCallerRefusedError } from "./extensions/schedule-fire-caller.js";
// The 20260830.03 seam: the visitor-sanitization policy the serving
// chain's error boundary consumes (drivers.visitorErrorPolicy) — the
// composition supplies WHO is on the anonymous surface and WHAT copy
// replaces a leak-prone description; the boundary owns the mechanism
// (code set, code preservation, ref format, details-drop). The factory
// rides the callerIdentityKey precedent: production wiring stays
// compose.ts's job, but a composition's OWN tests must drive its policy
// through the REAL boundary mechanism, never a re-derivation.
export type { VisitorErrorPolicy } from "./pipeline/interceptors/error-boundary.js";
export { createErrorBoundaryInterceptor } from "./pipeline/interceptors/error-boundary.js";
// The tuple lifecycle's resolution, for a kind a composition serves outside
// the generic chains (a cloud-served create): `resolveResourceCreatedEvent`
// derives the creation event from the kind's `kind_meta` exactly as the
// shared CreateAuthorizationTuples step does, so the driver sees one shape
// whichever chain created the row.
export {
  diffVisibilityShapes,
  resolveResourceCreatedEvent,
  visibilityShapesFor,
} from "./pipeline/steps/authorization-tuples.js";

// The pipeline primitives extensions build gate steps from.
export type { PipelineStep } from "./pipeline/pipeline.js";
export { RequestContext } from "./pipeline/request-context.js";
export {
  abortedError,
  alreadyExistsError,
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "./pipeline/errors.js";
// The shared slug derivation (C2 Stage 3): extension-registered resource
// kinds derive slugs with the SAME generator both editions pin
// (ApiRequestResourceSlugGenerator parity) — the semantics live exactly
// once.
export { generateSlug } from "./pipeline/steps/slug.js";
// The in-process caller-propagation surface (ruling R5): extension code
// composing requests through the in-process transport AS a caller rides
// the same header the OSS asCaller adapters use. (callerIdentityOf and
// callerIdentityKey ride the request-idiom export block below.)
export {
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
} from "./pipeline/interceptors/auth.js";

// The request idiom for extension-REGISTERED services (C4 Stage 4): a
// service contributed through ServerExtension.services runs the same
// chain shape every OSS controller runs — identity read once
// (callerIdentityOf), then Authorize (descriptor-driven from the
// `(ai.stigmer.commons.rpc.config)` method options, owning the ratified
// three-arm decision mapping and the `internal`-caller skip) and
// ValidateProto at the chain front, executed by the pipeline (which owns
// the sanitized-Internal error contract). Blessing these keeps
// authorization and validation semantics single-definition: an extension
// hand-rolling either would re-derive ratified wire behavior.
// callerIdentityKey is the stamp side of the same contract — production
// stamping stays the interceptors' job, but an extension's OWN service
// tests must stamp what the serving chain stamps (the auth.test.ts
// idiom) to exercise their chains over a router transport.
export {
  callerIdentityKey,
  callerIdentityOf,
} from "./pipeline/interceptors/auth.js";
// The serving chassis factory (20260902.02, the error-boundary
// precedent): a composition's OWN tests must drive its caller guards
// through the REAL stamp→guard mechanism — the walk order, the fault
// mapping, the refusal pass-through — never a re-derivation. Production
// wiring stays compose.ts's job.
export { createVerifierChainInterceptor } from "./pipeline/interceptors/auth.js";
// The interceptor's inner identity walk on its own (stigmer#991): a
// composition's extension-owned HTTP lanes are not Connect requests and
// cannot ride the interceptor, but they must authenticate a presented
// bearer with the SAME composed chain — one walk, two edges, never a
// re-instantiated verifier list. Identity only; caller guards stay the
// serving interceptor's (RPC-shaped by contract).
export {
  authenticateBearerToken,
  parseBearerToken,
} from "./pipeline/interceptors/auth.js";
export { newPipeline } from "./pipeline/pipeline.js";
export { newAuthorizeStep } from "./pipeline/steps/authorize.js";
// The run gate's check set (P1 sp.run-gate): an edition's Authorizer keys
// its lane admission on this predicate — the runtime lanes it mints (a
// guest share, a channel, a schedule fire, a workflow sandbox) were
// admitted upstream by their own gate steps and are not re-asked here.
// OSS defines the gate, so OSS defines which checks are the gate; a
// composition never re-derives the set.
export { isRunGateCheck } from "./pipeline/steps/authorize-run-target.js";
export { newValidateProtoStep } from "./pipeline/steps/validation.js";
// The create-shaping steps, for an envelope kind a composition serves
// itself (a cloud_only kind has no OSS controller to run them): between
// ValidateProto and its own domain step the composition runs the SAME
// ResolveSlug and BuildNewState every OSS create runs, so how a slug is
// derived from a name, how an id is spelled, how status.audit is stamped
// for the caller and how visibility defaults live exactly once and move
// together. The RequestContext must carry the kind (its fourth
// constructor argument) for BuildNewState to pick the id prefix.
// CheckDuplicate is deliberately not here: it reads this server's Store,
// and a composition's own table answers that question in a step of the
// same name over its own repo.
export { newBuildNewStateStep } from "./pipeline/steps/defaults.js";
export { newResolveSlugStep } from "./pipeline/steps/slug.js";
// The update and reference-read steps for the same kinds, on the same
// terms. An update runs BuildUpdateState after the composition's own
// loader has stashed the stored row under EXISTING_RESOURCE_KEY, so which
// fields a client may change, how status carries over and how the audit
// slots are stamped stay the OSS step's. A read by reference runs
// AuthorizeResolvedTarget with `loadedTargetAsMethod(get)` after the
// loader has stashed the row under TARGET_RESOURCE_KEY, so the kind's
// `get` annotation owns the permission and the refusal copy for both
// reads. The loaders stay the composition's for CheckDuplicate's reason:
// they read its own table.
export { newBuildUpdateStateStep } from "./pipeline/steps/build-update-state.js";
export { EXISTING_RESOURCE_KEY } from "./pipeline/steps/load-existing.js";
export {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "./pipeline/steps/authorize-resolved-target.js";
export { TARGET_RESOURCE_KEY } from "./pipeline/steps/load-target.js";

// The driver interfaces and the store-fault classes the ratified mapping
// keys on (typed not-found → NotFound; anything else rethrows as an
// infrastructure fault — the guidelines' instanceof idiom).
export type { Store, StoreOpenOptions } from "./store/interface.js";
export {
  AuditNotFoundError,
  ResourceNotFoundError,
} from "./store/interface.js";
// The list index's read shapes, which `Store.queryResources` speaks
// (store/list-index.ts). Declaring an index stays internal: the list is
// the composition root's (boot/list-indexes.ts), one per server.
export type {
  ListIndexCursor,
  ListIndexDeclaration,
  ListIndexQuery,
  ListIndexRow,
} from "./store/list-index.js";
// The maintenance-surface row shape (20260830.04 Stage 1, ruling Q3):
// what findResourcesRawOrderedAfter pages and what
// replaceResourceDataIfUnchanged guards on — the secret-convergence
// sweep's storage contract.
export type { RawResourceDocument } from "./store/interface.js";
// The Postgres driver constructor (stigmer-cloud 20260910.04 ruling 4;
// the newR2ArtifactStorage precedent for blessing a driver constructor).
// A composition that runs its own schema chain in the SAME database as
// this chain needs the OSS tables provisioned in its DB-backed tests
// exactly as production provisions them: PostgresStore.open runs the
// versioned chain under its advisory lock. The migrations themselves stay
// internal — a consumer gets the driver, never the DDL — so the chain's
// shape is not a contract and nothing outside this package can replay it
// piecemeal. Not for production wiring: compose.ts selects the driver from
// config (DD-010), and a composition never opens a second store.
export { PostgresStore } from "./store/postgres/store.js";
export type {
  ArtifactStorage,
  ArtifactStorageDriverFactory,
  PresignedUpload,
  StagedUploadLane,
} from "./artifactstorage/artifact-storage.js";
export { ArtifactStorageNotFoundError } from "./artifactstorage/artifact-storage.js";
// The R2 driver constructor (C1 seam, 20260827.04): compositions register
// per-domain R2 drivers with their own bucket/credential config while the
// S3 plumbing lives exactly once in OSS (the §6b registration shape).
export { newR2ArtifactStorage } from "./artifactstorage/r2-storage.js";
export type { R2StorageConfig } from "./artifactstorage/r2-storage.js";

// The O5 driver seams (§6a/§6c): the model-catalog read surface with the
// DD-008 disciplines in its contract, and the per-lane runner-credential
// seam with its OSS lane constant (an extension's verify callers name the
// lane they accept).
export type { ModelCatalogProvider } from "./domain/workflow/registry/model-catalog-provider.js";
// The document-driven provider constructor (C1 seam, 20260827.04): a
// composition whose catalog source is its own (the cloud's DB-resident
// baseline) builds providers from documents with the SAME interpretation
// ModelRegistryStore uses — the semantics live exactly once in OSS.
export { newModelCatalogProviderFromDocument } from "./domain/workflow/registry/document-catalog.js";
export type {
  RunnerCredentialProvider,
  // The C4 capability shapes (gate ruling Q1): the optional methods'
  // domain-shaped request/result types — a composition implementing the
  // exchange, bootstrap, sandbox-mint, or EC-read capabilities types
  // against these, never against wire messages.
  RunnerBootstrapCredentials,
  RunnerScopedTokenExchange,
  RunnerScopedTokenRequest,
  SandboxCredentialRequest,
  // The parity-entry-20260830.05 capability shape: the memory
  // capture-eligibility verdict (admit carries the token's proved
  // subject + session claims for the defaults step's Java-parity
  // derivation).
  MemoryCaptureDecision,
} from "./runnerauth/runner-credential-provider.js";
export type { MintedToken } from "./runnerauth/runnerauth.js";
export {
  InvalidTokenError,
  MintingDisabledError,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "./runnerauth/runnerauth.js";

// The secret-sealing seam (20260830.04 Stage 1, gate rulings Q2/Q3 —
// widening the C4-era enc:v1 block): the SecretService facade over the
// versioned-codec registry (async, scoped, batched, with reencrypt as the
// sweep's one upgrade door), the SecretCodec contract an extension's
// vault-backed formats implement (drivers.secretCodecs), the
// EncryptionScope tenancy/location record every seal site threads, and
// the TWO-ARMED error taxonomy the skip/propagate policies branch on
// (value-scoped InvalidCiphertextError family vs infrastructure
// EncryptionUnavailableError family). The service and its contract types,
// not the crypto primitives — each wire format stays defined exactly
// once. The maintenance-surface store verbs this seam blessed ride the
// Store interface above; RawResourceDocument is their row shape.
export {
  DecryptionFailedError,
  EncryptionDisabledError,
  EncryptionScope,
  EncryptionUnavailableError,
  InvalidCiphertextError,
  SecretService,
} from "./encryption/encryption.js";
export type { SecretCodec } from "./encryption/codec.js";

// The O6 driver seam (§6d): the sandbox-provisioner contract an extension
// implements to register its own isolation driver (selected through the
// SANDBOX_PROVISIONER_TYPE knob), plus the reserved built-in names its
// registrations may never shadow.
export type {
  SandboxDriverConfig,
  SandboxEnvironment,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxProvisionerFactory,
  SandboxScope,
} from "./sandbox/provisioner.js";
export { BUILT_IN_SANDBOX_PROVISIONER_TYPES } from "./sandbox/provisioner.js";

// The C4 Stage 3 gate seams: the dispatch-policy configs a capacity gate
// reads — the UNSPECIFIED-resolution rules and routing modes are single
// definitions by doctrine (oss#397), and their own headers name "a future
// policy consumer" as the reason they must be consumed, never re-derived.
// Plus the lifecycle chains' loaded-execution context key: recover-chain
// gate steps read the loaded resource through it (ctx.newState on those
// chains is the input message, not the resource).
export {
  AgentExecutionTemporalConfig,
  ROUTING_SESSION,
  newConfigFromEnv as newAgentExecutionTemporalConfigFromEnv,
} from "./domain/agentexecution/temporal/config.js";
export {
  WORKFLOW_ROUTING_EXECUTION,
  WorkflowExecutionTemporalConfig,
  newWorkflowExecutionConfigFromEnv,
} from "./domain/workflowexecution/temporal/config.js";
export { LOADED_EXECUTION_KEY } from "./pipeline/request-context.js";

// The C3 driver seam (DD-004's serving half, ruling Q1): the channel
// delivery runtime a composition registers to SERVE the install,
// messaging, and conversation arms the storing posture refuses — plus
// the write-constraints and delete-teardown hooks that carry the two
// edition-split CRUD sites. One driver, grouped by the surfaces it takes
// over; with none composed the byte-pinned refusals serve unchanged.
export type {
  ChannelRuntime,
  ChannelRuntimeConversations,
  ChannelRuntimeInstalls,
  ChannelRuntimeMessaging,
} from "./domain/agentchannel/channel-runtime.js";

// The worker factory seam extension workers implement (§8). Factories
// construct workers ONLY through deps.createWorker — this package's
// @temporalio/worker instance — so a composition never loads a second
// native bridge for its extension workers (the finding-16 fix; see
// WorkerFactoryDeps.createWorker in temporal/manager.ts).
export type {
  CreateWorkerOptions,
  WorkerFactory,
  WorkerFactoryDeps,
  WorkerWorkflowSource,
} from "./temporal/manager.js";
// The SDK's pure-JS workflow bundler, re-exported so factories that
// prebuild a shared bundle (the channel sweeps' pattern) need no runtime
// dependency on @temporalio/worker of their own.
export { bundleWorkflowCode } from "@temporalio/worker";
