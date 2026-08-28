/**
 * The @stigmer/server library contract (DD-005, sub-project 20260826.09).
 *
 * This file IS the blessed surface: the package.json exports map resolves
 * the bare package name here and nowhere else, so everything a commit-pin
 * consumer (the cloud composition) may import appears below — and nothing
 * else does. Deep imports into dist/ internals are unsupported; anything a
 * consumer needs that is not exported is a seam request to OSS, never a
 * reach-around. Additions to this file are owner-visible surface changes,
 * extended only through gates (the DD-005 review property: a surface
 * change is a one-file diff).
 *
 * The surface is exactly what the ratified architecture names (blueprint
 * 20260826.02/03 §1) and the parameter types those entries force:
 *   - the compose entry and config loading (composeServer + its options'
 *     required types: ServerConfig via loadConfig, Logger via createLogger)
 *   - the extension-point types (§2 — the whole src/extensions contract)
 *   - the pipeline primitives extensions build gates from (PipelineStep,
 *     RequestContext, the semantic error helpers, and the typed store
 *     not-found errors the ratified store-fault mapping keys on)
 *   - the driver interfaces (Store, ArtifactStorage; O5 added §6a/§6b/§6c —
 *     ModelCatalogProvider, the widened storage surface, and
 *     RunnerCredentialProvider; O6 added §6d — SandboxProvisioner and its
 *     factory/registration types)
 *   - the worker factory types extension workers implement (§8)
 *
 * The package stays private and unpublished: this is the library contract
 * for the commit-pinned consumer, not a public package (DD-005).
 */

// The compose entry and config loading.
export { composeServer } from "./boot/compose.js";
export type { ComposeOptions, ComposedServer } from "./boot/compose.js";
export { loadConfig } from "./boot/config.js";
export type { ServerConfig } from "./boot/config.js";
export { createLogger } from "./boot/logger.js";
export type {
  LogFields,
  Logger,
  LoggerOptions,
  LogLevel,
} from "./boot/logger.js";

// The extension-point types (DD-006 — the seven-point registry).
export type {
  ExtensionServiceRegistration,
  ResolvedExtensions,
  ServerExtension,
} from "./extensions/registry.js";
export type {
  CallerClass,
  CallerIdentity,
  IdentityVerifier,
} from "./extensions/identity.js";
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
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
  VisibilityChangedEvent,
  VisibilityTupleShape,
  ResolvedParentLink,
} from "./extensions/resource-authorization.js";
export type { OrganizationDirectory } from "./extensions/organization-directory.js";
export { ALL_ORGANIZATIONS } from "./extensions/organization-directory.js";
export {
  diffVisibilityShapes,
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
// the same header the OSS asCaller adapters use.
export {
  callerIdentityOf,
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
} from "./pipeline/interceptors/auth.js";

// The driver interfaces and the store-fault classes the ratified mapping
// keys on (typed not-found → NotFound; anything else rethrows as an
// infrastructure fault — the guidelines' instanceof idiom).
export type { Store } from "./store/interface.js";
export {
  AuditNotFoundError,
  ResourceNotFoundError,
} from "./store/interface.js";
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
} from "./runnerauth/runner-credential-provider.js";
export type { MintedToken } from "./runnerauth/runnerauth.js";
export {
  InvalidTokenError,
  MintingDisabledError,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "./runnerauth/runnerauth.js";

// The cross-edition secret envelope (enc:v1 — AES-256-GCM, the format the
// Java SecretEncryptionService shares): compositions building extension
// domains with secret-bearing columns seal under the SAME envelope the
// OSS store uses (C4 gate ruling Q4's interim posture; C2/C3 inherit the
// seam). The service, not the primitives — the format stays defined
// exactly once.
export {
  DecryptionFailedError,
  EncryptionDisabledError,
  InvalidCiphertextError,
  SecretService,
} from "./encryption/encryption.js";

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

// The worker factory types extension workers implement (§8).
export type { WorkerFactory, WorkerFactoryDeps } from "./temporal/manager.js";
