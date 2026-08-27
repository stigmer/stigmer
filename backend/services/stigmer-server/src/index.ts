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

// The O5 driver seams (§6a/§6c): the model-catalog read surface with the
// DD-008 disciplines in its contract, and the per-lane runner-credential
// seam with its OSS lane constant (an extension's verify callers name the
// lane they accept).
export type { ModelCatalogProvider } from "./domain/workflow/registry/model-catalog-provider.js";
export type { RunnerCredentialProvider } from "./runnerauth/runner-credential-provider.js";
export type { MintedToken } from "./runnerauth/runnerauth.js";
export {
  InvalidTokenError,
  MintingDisabledError,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "./runnerauth/runnerauth.js";

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

// The worker factory types extension workers implement (§8).
export type { WorkerFactory, WorkerFactoryDeps } from "./temporal/manager.js";
