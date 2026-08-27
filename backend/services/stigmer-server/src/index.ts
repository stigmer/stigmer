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
 *     RunnerCredentialProvider; §6d's sandbox provisioner joins with O6)
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
export type { LogFields, Logger, LoggerOptions, LogLevel } from "./boot/logger.js";

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
export { AuditNotFoundError, ResourceNotFoundError } from "./store/interface.js";
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
export type { RunnerCredentialProvider } from "./runnerauth/runner-credential-provider.js";
export type { MintedToken } from "./runnerauth/runnerauth.js";
export {
  InvalidTokenError,
  MintingDisabledError,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "./runnerauth/runnerauth.js";

// The worker factory types extension workers implement (§8).
export type { WorkerFactory, WorkerFactoryDeps } from "./temporal/manager.js";
