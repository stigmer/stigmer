/**
 * The staged composition root: plain functions building the graph in
 * dependency order — config → storage → temporal → controllers → routes →
 * listen. Every dependency is a required parameter; a missing one is a
 * compile error or a loud boot throw, NEVER a silent no-op (a dependency
 * injected late and forgotten is the bug class this shape rules out).
 *
 * Boot ordering is contract: health
 * flips SERVING only when wiring is complete, and the port binds AFTER
 * that — the CLI's serverGate TCP probe treats port-bind as readiness.
 * Shutdown is the reverse (grpc lib Stop): NOT_SERVING first, then the
 * session event streams end (a watcher resumes elsewhere), then drain.
 *
 * Extensions: the optional
 * `extensions` units resolve FIRST — a bad registry aborts boot before any
 * stage has side effects — and their contributions ride the existing
 * stages (services in the one routes closure, workers on the manager's
 * factory list, the edition into the platform controller). With no
 * extensions composed, every stage below is the open-source server
 * alone; the conformance rosters pin that.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { createRouterTransport } from "@connectrpc/connect";
import type { ConnectRouter, Transport } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { HealthCheckResponse_ServingStatus as ServingStatus } from "@stigmer/apis/grpc/health/v1/health_pb";

import { newBuiltInAuthorizer } from "../authorization/authorizer.js";
import {
  bindAuthorizer,
  bindListReadScope,
  bindOrganizationDirectory,
  newCredentialBinding,
} from "../authorization/credential-binding.js";
import { newBuiltInListReadScope } from "../authorization/list-read-scope.js";
import { newBuiltInOrganizationDirectory } from "../authorization/organization-directory.js";
import { newBuiltInGrantCheck } from "../authorization/grant-check.js";
import { builtInModel } from "../authorization/model/index.js";
import {
  authorizationPostureOf,
  kindsWithoutRows,
} from "../authorization/posture.js";
import { newStoredResources } from "../authorization/stored-resources.js";
import { newBuiltInGradingCaller } from "../authorization/grading-caller.js";
import { newBuiltInEvalRunCaller } from "../authorization/eval-run-caller.js";
import { newTrustedLocalAuthorizer } from "../authorization/trusted-local-authorizer.js";
import type { Authorizer } from "../extensions/authorizer.js";
import type { ComposedServices } from "../extensions/composed-services.js";
import { ABSENT_LICENSE_STATUS } from "../extensions/license-status.js";
import { runnerProviderAvailability } from "../extensions/provider-availability.js";
import { relaxedEgressPolicy } from "../extensions/outbound-egress.js";
import type { ListReadScope } from "../extensions/list-read-scope.js";
import type { OrganizationDirectory } from "../extensions/organization-directory.js";
import type { GradingCallerMint } from "../extensions/grading-caller.js";
import type { EvalRunCallerMint } from "../extensions/eval-run-caller.js";
import { registerAgentServices } from "../domain/agent/controller.js";
import {
  newConfigFromEnv,
  ROUTING_SESSION,
} from "../domain/run/temporal/config.js";
import { registerAgentExecutionServices } from "../domain/run/controller.js";
import {
  LocalArtifactStorage,
  newArtifactStorage,
} from "../artifactstorage/artifact-storage.js";
import type { ArtifactStorage } from "../artifactstorage/artifact-storage.js";
import { downloadUrlSignerFor } from "../artifactstorage/url-signer.js";
import { newExecutionEngineStateProvider } from "../temporal/agentexecution/engine-client.js";
import { newPluginToolsEngineStateProvider } from "../temporal/plugintools/engine-client.js";
import { newAgentExecutionWorkerFactory } from "../temporal/agentexecution/worker.js";
import { TemporalManager } from "../temporal/manager.js";
import { loadServerPayloadCodecs } from "../temporal/payload-codec.js";
import type { Client as TemporalClient } from "@temporalio/client";

import { RoutineArtifact } from "../temporal/routine/artifact.js";
import { newRoutineConfigFromEnv } from "../temporal/routine/config.js";
import { RoutineReconciler } from "../temporal/routine/reconciler.js";
import { RunStarter } from "../temporal/routine/run-starter.js";
import type { RoutineFireIdentity } from "../temporal/routine/run-starter.js";
import { RoutineSyncer } from "../temporal/routine/syncer.js";
import { newRoutineWorkerFactory } from "../temporal/routine/worker.js";
import { newGradingConfigFromEnv } from "../temporal/grading/config.js";
import { newGradingWorkerFactory } from "../temporal/grading/worker.js";
import { newEvalsConfigFromEnv } from "../temporal/evals/config.js";
import { newEvalsWorkerFactory } from "../temporal/evals/worker.js";
import { evalModelCatalogOf } from "../domain/eval-run/matrix.js";
import { registerRoutineServices } from "../domain/routine/controller.js";
import { ownerAsFireCaller } from "../domain/routine/owner.js";
import { registerChannelServices } from "../domain/channel/controller.js";
import { registerChannelConversationServices } from "../domain/channel/conversation.js";
import { registerChannelMessageServices } from "../domain/channel/message.js";
import { registerApiKeyServices } from "../domain/apikey/controller.js";
import {
  newCreateAccountPath,
  registerIdentityAccountServices,
} from "../domain/identityaccount/controller.js";
import { ensureOperatorAccount } from "../domain/identityaccount/operator.js";
import { newDirectAccountProvisioner } from "../domain/identityaccount/provisioning.js";
import { newResourceIdentityAccountStore } from "../domain/identityaccount/resource-store.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import { registerGrantServices } from "../domain/grant/controller.js";
import { newGrantPath } from "../domain/grant/grant-path.js";
import { AccessHistoryRetentionRunner } from "../domain/grant/history-retention.js";
import { nodeGuardedFetch } from "@stigmer/outbound/dial";
import { isReleaseVersion } from "@stigmer/plugin-package/client";
import { temporalConnectionEnv } from "@stigmer/temporal-codecs";
import { newOrganizationOnlyGrantScope } from "../domain/grant/grant-scope.js";
import { newMembershipRules } from "../domain/grant/membership.js";
import { newResourceGrantStore } from "../domain/grant/resource-store.js";
import { newBuiltInRoleLifecycle } from "../domain/grant/role-lifecycle.js";
import { newIssuerDiscovery } from "../identity/oidc-discovery.js";
import { newOidcUserInfoClient } from "../identity/oidc-userinfo.js";
import { newApiKeyIdentityVerifier } from "../domain/apikey/verifier.js";
import { deleteKeysOwnedBy } from "../domain/apikey/account-keys.js";
import type { IdentityVerifier } from "../extensions/identity.js";
import { newOidcIdentityVerifier } from "../identity/oidc-verifier.js";
import { createArtifactFileServer } from "../artifactstorage/file-server.js";
import { registerChannelAppServices } from "../domain/channelapp/controller.js";
import { registerEnvironmentServices } from "../domain/environment/controller.js";
import { newEnvironmentPolicy } from "../domain/run/environment-admission.js";
import { registerVaultServices } from "../domain/vault/controller.js";
import { newVaultResolver } from "../domain/vault/resolve.js";
import { newSignInFreshener } from "../domain/vault/sign-in/refresh.js";
import { clientDocument, clientDocumentUrlFor } from "../domain/vault/sign-in/client-document.js";
import { createOAuthClientDocumentLane } from "../transport/oauth-client/lane.js";
import { MAX_MESSAGE_BYTES } from "../transport/constants.js";
import { createManagedAgentsLane } from "../transport/managed-agents/lane.js";
import type { SignInFreshener } from "../domain/vault/resolve.js";
import { newVaultService } from "../domain/vault/service.js";
import { deleteAllMyVaultsOf } from "../domain/vault/delete.js";
import { newMyVaultDeparture } from "../domain/grant/departure.js";
import type { OrganizationDepartureHandler } from "../domain/grant/grant-path.js";
import { registerGitHubServices } from "../domain/github/controller.js";
import { registerMemoryServices } from "../domain/memory/controller.js";
import { newRunScoreCascade } from "../domain/score/cascade.js";
import { registerScoringRuleServices } from "../domain/scoring-rule/controller.js";
import { registerEvalRunServices } from "../domain/eval-run/controller.js";
import { newCaseArchiveReader } from "../domain/eval-run/suite.js";
import { newTemporalEvalRunWorkflows } from "../domain/eval-run/workflows.js";
import { registerScoreServices } from "../domain/score/controller.js";
import { newGradingObserver } from "../domain/score/grading-observer.js";
import type {
  ScoreDeleter,
  ScoreRecorder,
} from "../domain/score/ports.js";
import { registerOAuthAppServices } from "../domain/oauthapp/controller.js";
import { registerTokenService } from "../domain/token/controller.js";
import { newEmbeddingOriginGuard } from "../domain/token/origin-guard.js";
import { newUserTokenVerifier } from "../domain/token/verifier.js";
import { newChildOrganizations } from "../domain/organization/children.js";
import { registerOrganizationServices } from "../domain/organization/controller.js";
import {
  createDeletingOrganizationInterceptor,
  newOrganizationLifecycle,
} from "../domain/organization/lifecycle.js";
import {
  newChildrenStage,
  newContentStage,
  newFinalStage,
  newQuiesceStage,
  newShredStage,
} from "../domain/organization/purge/core-stages.js";
import { OrganizationPurgeRunner } from "../domain/organization/purge/runner.js";
import { registerPlatformServices } from "../domain/platform/controller.js";
import { SERVER_VERSION } from "../domain/platform/version.js";
import { registerSessionServices } from "../domain/session/controller.js";
import { SessionEventBroker } from "../domain/session/events/broker.js";
import { registerPluginServices } from "../domain/plugin/controller.js";
import { registerEvalServices } from "../domain/eval/controller.js";
import { registerRunEvalCaseService } from "../domain/eval/run-eval-case.js";
import { EVAL_ARTIFACT_KEY_PREFIX } from "../domain/eval/constants.js";
import { newLocalProgramPolicy } from "../domain/run/local-programs.js";
import { PLUGIN_ARTIFACT_KEY_PREFIX } from "../domain/plugin/constants.js";
import { registerSkillServices } from "../domain/skill/controller.js";
import {
  DEFAULT_SLOT_TTL_MS,
  MAX_ZIP_SIZE,
  STAGING_KEY_PREFIX,
} from "../domain/skill/constants.js";
import { newSkillArtifactStorage } from "../domain/skill/storage/artifact-storage.js";
import { newContentAddressedArchiveStore } from "../archive/content-store.js";
import {
  newSkillTransferLane,
  transferServeUrl,
  uploadUrl as skillUploadUrl,
} from "../domain/skill/transfer/handler.js";
import { UploadSlots } from "../domain/skill/transfer/slots.js";
import { newFileBlobs, uploadRefOf as fileUploadRefOf } from "../domain/file/blobs.js";
import {
  STAGED_FILE_NAME,
  STAGING_KEY_PREFIX as FILE_STAGING_KEY_PREFIX,
  UPLOAD_URL_TTL_MS as FILE_UPLOAD_URL_TTL_MS,
} from "../domain/file/constants.js";
import { registerFileServices } from "../domain/file/controller.js";
import { registerRunFileService } from "../domain/file/run-files.js";
import {
  fileTransferServeUrl,
  fileUploadUrl,
  newFileTransferLane,
} from "../domain/file/transfer.js";
import {
  newArchiveStaging,
  uploadRefOf,
} from "../domain/skill/transfer/staging.js";
import {
  DEFAULT_WRITE_VERSION,
  ENCRYPTION_KEY_ENV_VAR,
  ENCRYPTION_KEY_FILE_NAME,
  ENCRYPTION_WRITE_VERSION_ENV_VAR,
  SecretService,
  StaticKeySecretCodec,
} from "../encryption/encryption.js";
import type { SecretCodec } from "../encryption/codec.js";
import { getOrCreateNamedKey } from "../encryption/key-manager.js";
import { V1_VERSION } from "../encryption/v1-codec.js";
import { resolvePlatformTokenKeys } from "../platformtoken/key-ring.js";
import { registerActivityServices } from "../query/activity/controller.js";
import { ActivityHandler } from "../query/activity/handler.js";
import { registerSearchServices } from "../query/search/controller.js";
import { SearchHandler } from "../query/search/handler.js";
import { SqliteSearchQueryStore } from "../query/search/query-store.js";
import { newSearchableResourceRegistry } from "../query/search/registry.js";
import {
  initRpcMetrics,
  metricsExportPosture,
} from "../observability/rpc-metrics.js";
import { kindEnumName } from "../pipeline/apiresource-meta.js";
import { quoteJoin } from "../pipeline/errors.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import { createResourceReferenceInterceptor } from "../pipeline/interceptors/resource-references.js";
import { KeyedSerializer } from "../pipeline/keyed-serializer.js";
import {
  SYSTEM_OPERATOR_IDENTITY_ID,
  createVerifierChainInterceptor,
  serverActingFor,
} from "../pipeline/interceptors/auth.js";
import type { CallerIdentity } from "../extensions/identity.js";
import {
  createSingleOrganizationInterceptor,
  newSingleOrganizationHolder,
} from "../pipeline/interceptors/single-organization.js";
import { createOrganizationNameInterceptor } from "../pipeline/interceptors/organization-names.js";
import { newOrganizationNameResolver } from "../domain/organization/names.js";
import { accountAsCaller } from "../domain/identityaccount/actor.js";
import { newStoppedTurnObserver, undoDeciderCaller } from "../domain/session/filereview/stopped-turn.js";
import { newQueuedTurnObserver, startQueuedTurn } from "../domain/run/queued-turn.js";
import type { QueuedTurnStarter } from "../domain/run/queued-turn.js";
import { ensureSingleOrganization } from "./single-organization.js";
import { operatorIdentitySnapshot } from "../pipeline/steps/defaults.js";
import { createErrorBoundaryInterceptor } from "../pipeline/interceptors/error-boundary.js";
import { createRequestMetricsInterceptor } from "../pipeline/interceptors/request-metrics.js";
import { newBuiltInRunnerCredentialProvider } from "../runnerauth/built-in-runner-credential-provider.js";
import { newExecutionScopedRunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import { newRunnerSubjectIdentityVerifier } from "../runnerauth/runner-subject-verifier.js";
import { RunnerAuthService } from "../runnerauth/runnerauth.js";
import { PostgresStore } from "../store/postgres/store.js";
import { SqliteStore } from "../store/sqlite/store.js";
import type { Store } from "../store/interface.js";
import { resolveExtensions } from "../extensions/registry.js";
import {
  artifactLaneBindError,
  resolveArtifactLanePort,
  resolveArtifactServeUrl,
} from "./artifact-lane.js";
import { resolveOAuthRedirectUri } from "./oauth-redirect-uri.js";
import {
  assessSkillTransferOrigin,
  resolveSkillTransferBaseUrl,
} from "./skill-transfer-origin.js";
import type { ServerExtension } from "../extensions/registry.js";
import type { ModelCatalogProvider } from "../modelcatalog/model-catalog-provider.js";
import { ModelRegistryStore } from "../modelcatalog/model-registry-store.js";
import { bundledModelRegistryDocument } from "../modelcatalog/bundled.js";
import { builtInSandboxProvisionerFactories } from "../sandbox/builtins.js";
import { newSandboxLane } from "../sandbox/lane.js";
import {
  newSandboxProvisioner,
  SANDBOX_DRIVERS_WITHOUT_RUNNER_IMAGE,
  type SandboxBackgroundHandle,
} from "../sandbox/provisioner.js";
import { newStoreSessionActivityReader } from "../sandbox/session-activity.js";
import { HealthState, registerHealthService } from "../transport/health.js";
import { resolveConsoleAssets } from "../transport/console/assets.js";
import {
  createConsoleLane,
  type ConsoleSignInPosture,
} from "../transport/console/handler.js";
import { createRegistryLanes } from "../transport/registry/lanes.js";
import { createUnifiedPortServer } from "../transport/server.js";
import { registerExtensionServicesUnshadowed } from "./route-shadowing.js";
import type { ServerConfig } from "./config.js";
import { createInProcessClients } from "./inprocess.js";
import type { InProcessClients } from "./inprocess.js";
import { LIST_INDEXES } from "./list-indexes.js";
import { STORE_OPEN_OPTIONS } from "./store-options.js";
import {
  CORE_PURGED_KINDS,
  assertOrganizationPurgeCoverage,
  newCoreKindPurges,
  orderOrganizationPurgeStages,
} from "./organization-purge.js";
import type { Logger } from "./logger.js";

export interface ComposedServer {
  healthState: HealthState;
  /** The persistence layer (exposed for tests; domain code gets it injected). */
  store: Store;
  /**
   * The composed secret-encryption facade — the SAME instance every
   * domain seals and opens with (one facade per composition). Exposed for compositions whose extensions run
   * maintenance lanes over stored ciphertext — the secret-convergence
   * sweep's reencrypt door and the encryption-state census: a twin
   * facade built from the same codec map would duplicate KEK caches and
   * silently drift from the boot-resolved write version.
   */
  secrets: SecretService;
  /**
   * The Temporal lifecycle manager (exposed for composed tests asserting
   * engine-state behavior). Health semantics are unchanged by it: a down
   * engine never flips gRPC health — that is the engine-unavailable
   * posture the agentexecution suites pin.
   */
  temporalManager: TemporalManager;
  /**
   * The runner-token service (exposed for boot tests and for the values
   * fetch's tests, which mint scope-bound tokens against the SAME key the
   * server verifies with; the mint side is the platform controller's
   * getRunnerScopedToken).
   */
  runnerAuthService: RunnerAuthService;
  /** Each session's event fan-out (exposed for tests). */
  sessionEventBroker: SessionEventBroker;
  /**
   * The in-process router transport — the same routes and interceptor
   * chain as the serving router EXCEPT the position-1 identity source
   * (this lane stamps the internal caller class, the serving chain runs
   * the verifier chassis). Exposed
   * because it is the one lane that reaches EVERY registered service,
   * extension services included:
   * compositions build clients to their extension services over it, and
   * the extension suite proves both-router visibility through it.
   */
  inProcessTransport: Transport;
  /**
   * The composed identity-verifier chain in serving order — the OSS
   * lanes the posture composed (apikey, oidc) then every extension's, in
   * unit order — for a composition's extension-owned HTTP edges to run
   * through `authenticateBearerToken` (stigmer#991). Exposed rather than
   * rebuilt at the edge because the OSS entries are constructed HERE from
   * the store and the config; an edge that rebuilt the list would drop
   * them or reorder them, and the edge would then authenticate
   * differently from the server it fronts.
   */
  identityVerifiers: ReadonlyArray<IdentityVerifier>;
  /**
   * The one routes function both routers are built from (exposed for
   * tests, the `store` posture — the tier-truthfulness invariant
   * enumerates the services a composition registers through it; the
   * server registers no reflection service, deliberately).
   */
  routes: (router: ConnectRouter) => void;
  /**
   * The organization purge runner (domain/organization/purge/runner.ts),
   * exposed for composed tests and a composition's own proofs: `runPass`
   * runs one pass over the deletion table now, as the interval would.
   */
  organizationPurge: Pick<OrganizationPurgeRunner, "runPass">;
  /** Completes wiring, flips SERVING, binds the port; returns the bound port. */
  start(): Promise<number>;
  /**
   * The ports the listeners actually bound, once start() has resolved;
   * undefined before. An ephemeral bind (`GRPC_PORT=0`, `ARTIFACT_HTTP_PORT=0`)
   * is known only here, and the process entry announces it on request
   * (boot/ready-line.ts).
   */
  boundPorts(): BoundPorts | undefined;
  /** NOT_SERVING first, stop background work, drain connections. */
  shutdown(): Promise<void>;
}

export interface BoundPorts {
  /** The unified transport listener's port. */
  readonly grpc: number;
  /**
   * The artifact download lane's port; undefined when artifact storage is
   * not local and the lane never binds (artifactstorage/file-server.ts).
   */
  readonly artifactHttp: number | undefined;
}

export interface ComposeOptions {
  config: ServerConfig;
  logger: Logger;
  /**
   * Named extension units composed into this server. Omitted or
   * empty means plain OSS — byte-identical wire behavior, pinned by the
   * conformance rosters.
   */
  extensions?: ReadonlyArray<ServerExtension>;
  /**
   * The release this server reports through getServerInfo. Defaults to
   * SERVER_VERSION: the esbuild define the all-in-one bundle stamps, or
   * "dev" when unbundled. A composition that consumes @stigmer/server as a
   * library runs no bundle and would otherwise report "dev" whatever
   * release it installed, so it states the version of the package it
   * composes (the installed package's own manifest is the honest source).
   * A fact about the library the consumer installed, not about any
   * extension unit — which is why it lives here and not on
   * ServerExtension beside `edition`. When it is a release it is also the
   * release every sandbox driver hands the runner layer's start script
   * (SandboxDriverConfig.serverRelease), while the default runner image
   * (defaultSandboxRunnerImage) follows SERVER_VERSION: a composition that
   * states a release names its runner image too, or its sandboxes start on
   * `runner:latest`, warned about or refused by that layer's release.
   */
  version?: string;
  /** Test seam forwarded to the model-registry upstream fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam: bind an ephemeral port instead of config.grpcPort. */
  portOverride?: number;
  host?: string;
}

export async function composeServer(
  options: ComposeOptions,
): Promise<ComposedServer> {
  const { config, logger } = options;
  // The one version this server states: getServerInfo reports it, and the
  // sandbox drivers hand it, when it is a release, to the runner layer's
  // start script, which refuses a layer of another release.
  const version = options.version ?? SERVER_VERSION;

  // Stage: extensions — resolves and validates BEFORE any stage has side
  // effects (a bad registry is a loud boot throw, never a
  // partially-wired server). The empty set resolves to explicit defaults
  // and logs nothing, keeping today's boot output stable.
  const extensions = resolveExtensions(options.extensions);
  if (extensions.unitNames.length > 0) {
    logger.info("extension units composed", {
      units: extensions.unitNames.join(", "),
    });
  }

  // Stage: storage — the driver selection seam: DATABASE_URL
  // present → Postgres (async connect + advisory-locked migrations), else
  // sqlite on DB_PATH (its whole migration chain). Postgres wins when both are set:
  // DB_PATH always has a default value, so no other precedence could ever
  // select Postgres (config.ts documents the contract). Either driver
  // opens with the list indexes (list-indexes.ts) and the session event
  // gates (domain/session/events/gates.ts) and reconciles them
  // before it returns. A failure here is a loud boot throw, never a
  // degraded server. The operator identity (#400) is installed by the
  // process body (boot/run.ts) — once per PROCESS, before any writer
  // exists — not here: composeServer is re-entrant for tests, the
  // identity seam deliberately is not.
  let store: Store;
  const storeOptions = STORE_OPEN_OPTIONS;
  if (config.databaseUrl !== "") {
    store = await PostgresStore.open(config.databaseUrl, logger, storeOptions);
    logger.info("storage driver selected", { driver: "postgres" });
  } else {
    store = SqliteStore.open(config.dbPath, logger, storeOptions);
    logger.info("storage driver selected", {
      driver: "sqlite",
      dbPath: config.dbPath,
    });
  }

  // The deleting rule (domain/organization/lifecycle.ts): an organization
  // being deleted answers as if it did not exist, at each of its seats —
  // the interceptor on both chains, the credential binding's target
  // resolution, and the walks over every organization.
  const organizationLifecycle = newOrganizationLifecycle(
    store.organizationDeletions,
  );
  const deletingOrganizations =
    createDeletingOrganizationInterceptor(organizationLifecycle);

  // The require-authentication posture has two sources OR'd here: the
  // OSS OIDC issuer and a composed unit's declaration (registry
  // point). Neither source = the OSS
  // trusted-local posture, byte-identical wire behavior. Resolved in the
  // storage stage because the posture decides a WRITE below (the operator
  // account); the verifier chain it also governs is built at the end.
  const authEnabled = config.oidcIssuer !== "";
  const requireAuthentication =
    authEnabled || extensions.requireAuthentication !== undefined;

  // The AUTHORIZATION posture (authorization/posture.ts), named once and
  // handed down: a unit's own Authorizer (nothing built in installs);
  // the built-in posture (no unit Authorizer under an authentication
  // posture — open source composes its Authorizer and organization
  // directory below, and the role rows are
  // enforced); or trusted-local (the permissive default: one caller,
  // nothing to separate). `builtInAuthorization` is
  // the first two together — the roles exist to feed the built-in
  // authorizer, so the identity stage installs the built-in role
  // lifecycle and the membership rules under both; a composition with its
  // own Authorizer has its own onboarding and gets neither.
  // An edition above open source serves many organizations; without the
  // require-authentication posture a request carrying no credential would
  // act as the laptop's one operator on every one of them. Refused at boot,
  // before any side effect, whichever authorizer the composition runs.
  if (!requireAuthentication && extensions.edition !== ServerEdition.oss) {
    throw new Error(
      `the composition serves edition '${ServerEdition[extensions.edition]}' without the require-authentication posture — an edition above open source must sign its callers in: declare requireAuthentication on a unit that registers a verifier, or configure STIGMER_OIDC_ISSUER`,
    );
  }
  const authorizationPosture = authorizationPostureOf({
    unitAuthorizer: extensions.authorizer !== undefined,
    requireAuthentication,
  });
  const builtInAuthorization = authorizationPosture !== "unit-authorizer";
  // The built-in authorizer evaluates the one model every edition reads,
  // and derives each resource's tuples from its row. A wider edition's
  // kinds are served by units that keep their rows in stores of their own,
  // so each such unit registers a reader for its kinds
  // (drivers.resourceRowReaders), and the built-in posture serves a wider
  // edition only when every kind it serves has rows the derivation can
  // read — never answers derived from rows that are not there. Refused at
  // boot, the same class as a misconfigured registry and the verifierless
  // posture below: caught before any side effect.
  //
  // The credential binding (below) reads a target's organization from its
  // row in EVERY posture, a unit Authorizer's included, so a kind whose
  // rows nothing can read is refused there too, with its own copy: a bound
  // caller's check on it would otherwise be decided by a row that is not
  // there. Trusted-local serves open source's edition only, whose kinds
  // are the store's, so it never meets this.
  const unreadable = kindsWithoutRows({
    edition: extensions.edition,
    model: builtInModel,
    readers: extensions.drivers.resourceRowReaders,
  });
  if (unreadable.length > 0) {
    throw new Error(
      authorizationPosture === "built-in"
        ? `the composition serves edition '${ServerEdition[extensions.edition]}' under the built-in authorizer but registers no row reader for ${quoteJoin(unreadable.map(kindEnumName))} — register a reader for each kind a unit serves (drivers.resourceRowReaders), or register an Authorizer`
        : `the composition serves edition '${ServerEdition[extensions.edition]}' but registers no row reader for ${quoteJoin(unreadable.map(kindEnumName))} — the credential binding reads every served kind's organization from its row: register a reader for each kind a unit serves (drivers.resourceRowReaders)`,
    );
  }
  // Every kind an organization can own is removed by a purge or kept on
  // purpose, or the composition does not boot (boot/organization-purge.ts);
  // checked with the other boot refusals, before the first write.
  assertOrganizationPurgeCoverage({
    edition: extensions.edition,
    coreKinds: CORE_PURGED_KINDS,
    units: extensions.orgPurge,
  });

  // Stage: identity accounts — the first domain whose
  // persistence is a PORT rather than the generic Store. The composed
  // driver (`drivers.identityAccountStore`) serves when a unit
  // registers one; otherwise open source's adapter over `store` installs
  // HERE (the default lives with the consumer, never in the registry).
  // This ONE binding is what the create path, the provisioner, the
  // operator ensure and both OSS verifiers read, so a composed driver is
  // followed everywhere by construction. The domain's one create path is
  // built once and shared by the create RPC, provisioning and the operator
  // ensure below.
  const identityAccounts =
    extensions.drivers.identityAccountStore ??
    newResourceIdentityAccountStore(store);
  // The Grant row half: the store PORT bound the same way
  // (`drivers.grantStore`; open source's adapter over `store`
  // when absent) and the domain's ONE grant and revoke path built over it.
  // The grant path's lifecycle is the composed DRIVER — the cloud's tuple
  // hooks — never the built-in lifecycle below, which sits ON TOP of the
  // grant path; that direction keeps the two acyclic. Both
  // bindings are what the Grant controller registers over (routes).
  // An edition above open source keeps the permission history: the
  // edition is the composition's one declaration of that difference, so
  // open source's adapter records every access row change in the row's
  // transaction there, and nowhere else. A composed driver keeps its own.
  const grants =
    extensions.drivers.grantStore ??
    newResourceGrantStore(store, {
      keepsHistory: extensions.edition !== ServerEdition.oss,
    });
  // A person's departure from an organization deletes their My vault there
  // (domain/grant/departure.ts). The handler needs the vault service,
  // which needs the secret facade built further down, so it is bound once
  // both exist; the grant path only calls it at request time.
  let myVaultDeparture: OrganizationDepartureHandler | undefined;
  const grantPath = newGrantPath({
    grants,
    resources: newStoredResources(store),
    lifecycle: extensions.drivers.resourceAuthorizationLifecycle,
    logger,
    departures: (identityAccountId, organizationId, caller) => {
      /* v8 ignore next 3 -- @preserve: bound a few statements below, during boot, before any request is served; only a mis-ordered composition reaches it. */
      if (myVaultDeparture === undefined) {
        throw new Error("the My vault departure handler is not bound yet");
      }
      return myVaultDeparture(identityAccountId, organizationId, caller);
    },
  });
  // The tuple-lifecycle driver: undefined = the three
  // shared tuple steps (CreateAuthorizationTuples / CleanupGrants /
  // UpdateVisibilityTuples) no-op before any resolution work — OSS
  // behavior byte-identical. Handed to every resource controller as an
  // explicit dependency, the same threading as the authorizer.
  const authorizationLifecycle =
    extensions.drivers.resourceAuthorizationLifecycle;
  // The lifecycle the ORGANIZATION and IDENTITY-ACCOUNT controllers get
  // the composed driver when a unit
  // registers one; otherwise, under the built-in posture, open source's
  // role lifecycle — the organization creator's `owner` row, cleanup on
  // organization and account deletes — the row half of the seam that
  // records authorization at lifecycle points in every edition
  // (extensions/resource-authorization.ts, corrected 2026-09-13). Those
  // two kinds ONLY, because a lifecycle on a controller turns on the
  // steps' full event RESOLUTION for that kind, and resolution fails a
  // request whose configured parent id is missing (the cloud relies on
  // that refusal) — a state open source admits by contract (a memory
  // captured with no credential has no subject). The built-in object is
  // a two-kind role recorder, so only two controllers see it; every other
  // controller keeps the composed driver above and stays byte-identical.
  const roleLifecycle =
    authorizationLifecycle ??
    (builtInAuthorization
      ? newBuiltInRoleLifecycle({
          grantPath,
          accounts: identityAccounts,
        })
      : undefined);
  // The operator seam is read once here for both its consumers below: the
  // trusted-local account ensure and the membership rules' operator-email
  // arm (which also applies under an authentication posture — the
  // operator who signs in through OIDC is admin of what the laptop has).
  const operatorIdentity = operatorIdentitySnapshot();
  // A composition that declares one organization fills it into every
  // serving request that names none, from the holder start() settles
  // (pipeline/interceptors/single-organization.ts); getServerInfo reports
  // the same holder. Undefined everywhere else: no fill, `single_org` false.
  const singleOrganization =
    extensions.orgLimit === 1 ? newSingleOrganizationHolder() : undefined;
  const membership = builtInAuthorization
    ? newMembershipRules({
        grantPath,
        grants,
        store,
        operatorEmail: operatorIdentity.email,
        edition: extensions.edition,
      })
    : undefined;
  // Stage: runner credentials. The concrete service is
  // constructed and exposed UNCONDITIONALLY — its boot-fatal key posture
  // is a cross-domain invariant, and the boot and values-fetch tests
  // mint against the server's own key through it. The provider over it is
  // the edition's whole credential story in one object: a composed
  // driver; otherwise, under the built-in authorization posture, open
  // source's built-in provider (runnerauth/built-in-runner-credential-
  // provider.ts — the execution-scoped default plus the memory-capture
  // and exchange-gating capabilities an enforcing self-host needs);
  // otherwise the
  // execution-scoped default, byte-identical to the wiring this seam
  // replaced. Both open-source providers also mint the RUN credential the
  // execution engine puts on every dispatch (the engine below takes
  // this object; runnerauth/dispatch-credential.ts) — a composed driver
  // that leaves that capability undefined dispatches without one, its
  // runners being credentialed another way.
  // The credential binding (authorization/credential-binding.ts): a
  // credential that names an organization works in that organization and
  // its child organizations, a run's credential in its run's organization
  // alone. Built before the runner credential provider, whose run
  // credential exchange asks it, and before the decision drivers it wraps
  // below. It reads a target's organization from the row where the
  // built-in authorizer would (the Grant and identity-account ports a
  // composition may substitute, then the units' row readers, then the
  // generic store), which is why every posture, not only the built-in one,
  // refuses a served kind no reader can read.
  const credentialBinding = newCredentialBinding({
    store,
    rowReaders: extensions.drivers.resourceRowReaders,
    grants,
    identityAccounts,
    lifecycle: organizationLifecycle,
  });
  const runnerAuthService = RunnerAuthService.fromEnv();
  const runnerCredentials =
    extensions.drivers.runnerCredentialProvider ??
    (authorizationPosture === "built-in"
      ? newBuiltInRunnerCredentialProvider({
          service: runnerAuthService,
          store,
          accounts: identityAccounts,
          credentialBinding,
        })
      : newExecutionScopedRunnerCredentialProvider(runnerAuthService));
  // The ONE composed Authorizer, bound here — after the store,
  // the account port and the Grant port it reads — and handed to every
  // controller as an explicit dependency; the Authorize step at position 1
  // of every chain calls it. By posture: an extension's registration;
  // open source's built-in Authorizer (authorization/authorizer.ts — the
  // cloud's model evaluated over the tuples the row would have had), which
  // checks every caller on the run gate as the person it acts for; or,
  // trusted-local, open source's permissive driver
  // (authorization/trusted-local-authorizer.ts), which separates no callers
  // and answers only whether a named Organization exists, as the other two
  // do (stigmer#1163). The organization directory is bound beside it
  // under the same posture, so `listMine` lists what a person may view;
  // who a routine's fires act as is chosen below by the authentication
  // posture alone (routineFireIdentity).
  const postureAuthorizer: Authorizer =
    extensions.authorizer ??
    (authorizationPosture === "built-in"
      ? newBuiltInAuthorizer({
          store,
          grants,
          accounts: identityAccounts,
          rowReaders: extensions.drivers.resourceRowReaders,
          edition: extensions.edition,
          logger,
        })
      : newTrustedLocalAuthorizer({ store }));
  const postureOrganizationDirectory: OrganizationDirectory | undefined =
    extensions.drivers.organizationDirectory ??
    (authorizationPosture === "built-in"
      ? newBuiltInOrganizationDirectory({
          store,
          grants,
          accounts: identityAccounts,
          rowReaders: extensions.drivers.resourceRowReaders,
        })
      : undefined);
  // Who a routine's fires act as (temporal/routine/run-starter.ts): its
  // owner in every posture that signs callers in, presented as a unit's
  // fire-caller driver turns them, else as themselves; the trusted-local
  // laptop's one person keeps its own internal identity.
  const routineFireIdentity: RoutineFireIdentity = requireAuthentication
    ? {
        kind: "owner",
        accounts: identityAccounts,
        caller: extensions.drivers.routineFireCaller ?? ownerAsFireCaller,
      }
    : { kind: "trusted-local" };
  // The ONE list read scope (the seam's single-instance point), bound
  // here under the same posture and handed to every list-shaped consumer
  // below — the post-scan lanes, recent activity, the run summaries and
  // search's organization kinds through restrictListByReadScope, search's
  // sessions and runs through the enumeration verb. A
  // unit's driver wins in every posture; the built-in one evaluates the
  // model per candidate over the facts the candidate carries
  // (authorization/list-read-scope.ts); trusted-local composes none and
  // keeps the full scan.
  const postureListReadScope: ListReadScope | undefined =
    extensions.drivers.listReadScope ??
    (authorizationPosture === "built-in"
      ? newBuiltInListReadScope({
          store,
          grants,
          accounts: identityAccounts,
          rowReaders: extensions.drivers.resourceRowReaders,
          logger,
        })
      : undefined);
  // The three decision drivers resolved above are wrapped with the
  // credential binding HERE, whatever the posture chose, a unit's
  // registration included, so every controller, every skip lane that calls
  // the Authorizer and every unit's own consumer of the composed services
  // is bound by construction; only the raw drivers above are unbound, and
  // nothing past this point sees them.
  const authorizer: Authorizer = bindAuthorizer(
    postureAuthorizer,
    credentialBinding,
  );
  // Who an AI judge run acts as: a unit's grading caller (the hosted
  // edition's per-organization grading account), else the scoring rule's
  // creator under the built-in posture, for runs that creator may see,
  // else the server itself on the trusted-local laptop
  // (extensions/grading-caller.ts).
  const gradingCaller: GradingCallerMint | undefined =
    extensions.drivers.gradingCaller ??
    (authorizationPosture === "built-in"
      ? newBuiltInGradingCaller({ store, accounts: identityAccounts, authorizer })
      : undefined);
  // Who an eval run's tries and AI-graded checks act as: a unit's eval
  // caller (the hosted edition's per-organization eval account), else the
  // eval's creator under the built-in posture, while they may still edit
  // the eval's plugin, else the server itself on the trusted-local laptop
  // (extensions/eval-run-caller.ts). The eval's worker
  // (temporal/evals/) mints through it per try and per vote.
  const evalRunCaller: EvalRunCallerMint | undefined =
    extensions.drivers.evalRunCaller ??
    (authorizationPosture === "built-in"
      ? newBuiltInEvalRunCaller({ store, accounts: identityAccounts, authorizer })
      : undefined);
  const organizationDirectory: OrganizationDirectory | undefined =
    postureOrganizationDirectory === undefined
      ? undefined
      : bindOrganizationDirectory(
          postureOrganizationDirectory,
          organizationLifecycle,
        );
  const listReadScope: ListReadScope | undefined =
    postureListReadScope === undefined
      ? undefined
      : bindListReadScope(
          postureListReadScope,
          credentialBinding,
          organizationLifecycle,
        );
  // The persons callers stand for (stigmer#1387): under the
  // require-authentication posture every caller is someone the
  // identity-account domain can name, so memory and the person's declared
  // preferences are that person's own; trusted-local composes none — the
  // laptop's one operator, whose memory is the organization's switch alone
  // (the contract's single-operator arm). The same binding both verifiers
  // read, so a composed driver is followed here too.
  const personAccounts: AccountsByCaller | undefined = requireAuthentication
    ? identityAccounts
    : undefined;
  logger.info("authorization posture resolved", {
    posture: authorizationPosture,
    authorizer:
      extensions.authorizer !== undefined
        ? "extension"
        : authorizationPosture === "built-in"
          ? "built-in"
          : "permissive",
    listReadScope:
      extensions.drivers.listReadScope !== undefined
        ? "extension"
        : authorizationPosture === "built-in"
          ? "built-in"
          : "none",
  });
  const identityAccountPath = {
    accounts: identityAccounts,
    store,
    logger,
    authorizer,
    authorizationLifecycle: roleLifecycle,
  };
  const createIdentityAccount = newCreateAccountPath(
    identityAccountPath,
    ApiResourceKind.identity_account,
  );
  // ONE issuer discovery for every lane that reads a well-known document
  // provisioning's userinfo client here and the OIDC verifier's
  // JWKS location below share it, so an issuer is discovered once per
  // process and validated the same way wherever it is consumed. Built in
  // this stage, not inside routes() (which runs twice) — the same reason
  // the searchRegistry lives here.
  const issuerDiscovery = newIssuerDiscovery();
  // Provisioning reads the caller's profile from the userinfo endpoint of
  // the issuer that vouched for the token, discovered per issuer and
  // cached — so a composition whose own verifiers name their issuer
  // on the identity needs no knob here.
  const identityAccountProvisioner = newDirectAccountProvisioner({
    accounts: identityAccounts,
    createAccount: createIdentityAccount,
    userInfo: newOidcUserInfoClient(issuerDiscovery),
  });
  // Under the trusted-local posture the server knows its one principal
  // from the operator seam (the SAME seam the interceptor stamps callers
  // from — never config directly, so the row and the stamp cannot
  // disagree) and states the fact at boot:
  // create-if-absent, so preferences set later survive every reboot. A
  // composition with an authentication posture never creates one — its
  // users provision themselves on first sign-in. A stage that writes a
  // resource is new here; it earns its place because it is the truth of
  // that posture, and a failure is a loud boot throw like the storage
  // stage's own.
  // A composition that declares one organization makes it in start() as
  // the caller named here (boot/single-organization.ts): the operator's
  // account under trusted-local, so the role lifecycle makes them its
  // owner; under sign-in the server acting as nobody, so the membership
  // rules decide its owner from the recorded fact, never a stamp.
  let singleOrganizationCaller: CallerIdentity = serverActingFor(
    SYSTEM_OPERATOR_IDENTITY_ID,
  );
  if (!requireAuthentication) {
    const operator = await ensureOperatorAccount(
      { accounts: identityAccounts, createAccount: createIdentityAccount },
      operatorIdentity,
    );
    logger.info("trusted-local operator account ensured", {
      accountId: operator.metadata?.id ?? "",
    });
    singleOrganizationCaller = accountAsCaller(operator);
    // The laptop's one principal owns what the laptop has:
    // `owner` on every organization with no owner row, create-if-absent,
    // so the Members page tells the truth from the first boot after roles
    // exist. Under the built-in posture only — a unit with its own
    // Authorizer and no authentication posture keeps its own rules.
    if (membership !== undefined) {
      await membership.ensureOperatorOwnership(operator);
      logger.info("trusted-local operator ownership ensured", {
        accountId: operator.metadata?.id ?? "",
      });
    }
  }
  // Stage: keys — the fail-loud boot ASYMMETRY:
  //
  //   - Encryption key failure → WARN and continue with a keyless
  //     pass-through v1 codec. Plaintext at rest is tolerable (the write
  //     steps WARN per request, oss#394); refusing to boot over it is not.
  //   - Runner-token key failure → FATAL (throw). The values fetch
  //     answers only a runner credential, so a server that cannot mint
  //     runner tokens would start every execution without its secrets — the
  //     silent failure the oss#405 fail-loud doctrine forbids. (The verify
  //     side is the values fetch, domain/vault/values.ts; the mint side is
  //     the platform controller's getRunnerScopedToken.)
  //
  // The versioned-codec seam: the
  // built-in v1 codec installs HERE, never in the registry (a default
  // lives with its consumer), and merges with the
  // extension-registered codecs. The write version resolves FAIL-FAST:
  // naming a version with no codec is a boot throw (deliberately outside
  // the WARN-degrade catch — only the KEY ladder degrades; a
  // misconfigured write version must never silently write v1). The env
  // vars stay off ServerConfig, the key-manager posture: no config entry
  // exists before the code that reads it.
  let v1Key: Buffer | undefined;
  try {
    v1Key = getOrCreateNamedKey(
      ENCRYPTION_KEY_ENV_VAR,
      ENCRYPTION_KEY_FILE_NAME,
    );
  } catch (error) {
    logger.warn(
      "Failed to initialize encryption - secret values will be stored in plaintext",
      { error: error instanceof Error ? error.message : String(error) },
    );
    v1Key = undefined;
  }
  const secretCodecs = new Map<string, SecretCodec>([
    [V1_VERSION, new StaticKeySecretCodec(v1Key)],
    ...extensions.drivers.secretCodecs,
  ]);
  // Blank normalizes to the default — a rollback lever must be robust to
  // sloppy unsetting (the cloud EncryptionConfig contract).
  const writeVersionValue = process.env[ENCRYPTION_WRITE_VERSION_ENV_VAR] ?? "";
  const secretService = SecretService.withCodecs({
    codecs: secretCodecs,
    writeVersion:
      writeVersionValue === "" ? DEFAULT_WRITE_VERSION : writeVersionValue,
  });
  logger.info("secret encryption configured", {
    writeVersion:
      writeVersionValue === "" ? DEFAULT_WRITE_VERSION : writeVersionValue,
    registeredCodecs: [...secretCodecs.keys()].sort(),
  });
  // The vault service: the one in-process door to vault rows (entry
  // writes, My vault's first write, opening values for a run), shared by
  // the vault RPCs, sign-in, the GitHub lane and the run resolver.
  const vaultService = newVaultService({
    store,
    logger,
    secretService,
    authorizationLifecycle,
    authorizer,
    credentialBinding,
  });
  myVaultDeparture = newMyVaultDeparture({
    store,
    logger,
    secretService,
    authorizationLifecycle: extensions.drivers.resourceAuthorizationLifecycle,
    vaults: vaultService,
  });
  // The platform-token key ring joins the FATAL side of the asymmetry:
  // under an authentication posture a server that cannot sign or verify
  // its own tokens would refuse every minted user token's caller, and an
  // explicitly configured key that does not load is configuration the
  // operator meant (the ladder's rule). No posture, no ring
  // (resolvePlatformTokenKeys carries the four arms).
  const platformTokenKeys = resolvePlatformTokenKeys({
    requireAuthentication,
    supplied: extensions.drivers.platformTokenKeys,
    edition: extensions.edition,
  });
  logger.info("platform-token keys resolved", {
    source:
      platformTokenKeys === undefined
        ? "none (no authentication posture)"
        : extensions.drivers.platformTokenKeys !== undefined
          ? "extension"
          : "open-source ladder",
    signing: platformTokenKeys?.signer !== undefined,
  });
  // Stage: temporal. Construction is sync and connection-free —
  // initialConnect/startWorkers/startHealthMonitor run in start(), all
  // NON-fatal (the server boots and serves with the engine unavailable;
  // the health monitor keeps retrying). The one boot-fatal
  // arm is a PRESENT-but-malformed payload-encryption key: an operator
  // who set the key intended runner history to be encrypted, and failing
  // on the first runner payload read would be worse than failing here.
  //
  // The agent-execution temporal config lives with the controllers stage
  // (not here) because the session update pipeline's execution-target
  // immutability step must resolve UNSPECIFIED through the SAME default
  // dispatch uses — one definition, so policy and dispatch can never
  // disagree (oss#397).
  const temporalConfig = newConfigFromEnv();
  // The sandbox lane: the configured driver — built-in tier or
  // composition-registered — or the default external-runner posture
  // (SANDBOX_PROVISIONER_TYPE unset: no driver constructed, the ensure
  // steps short-circuit, an operator-managed runner polls the queues).
  // Selection is loud-fail inside newSandboxProvisioner; the routing
  // coherence check lives HERE because the temporal config does — a
  // provisioner that no routing mode can ever dispatch to is dark
  // configuration, the validateR2Config class of boot fault.
  const sandboxProvisioner = newSandboxProvisioner(
    config.sandboxProvisionerType,
    {
      config: {
        backendEndpoint: config.sandboxBackendEndpoint,
        mcpPublicEndpoint: config.sandboxMcpPublicEndpoint,
        temporalAddress: config.sandboxTemporalAddress,
        temporalNamespace: config.temporalNamespace,
        temporalConnectionEnv: temporalConnectionEnv(config.temporalConnection),
        runnerImage: config.sandboxRunnerImage,
        runnerCommand: config.sandboxRunnerCommand,
        kubernetesNamespace: config.sandboxKubernetesNamespace,
        runnerEnv: config.sandboxRunnerEnv,
        runnerSecretEnv: config.sandboxRunnerSecretEnv,
        serverRelease: isReleaseVersion(version) ? version : "",
      },
      logger,
    },
    builtInSandboxProvisionerFactories(),
    extensions.drivers.sandboxProvisionerDrivers,
  );
  if (
    sandboxProvisioner !== undefined &&
    temporalConfig.activityRouting !== ROUTING_SESSION
  ) {
    throw new Error(
      `SANDBOX_PROVISIONER_TYPE='${config.sandboxProvisionerType}' requires per-session routing — set STIGMER_ACTIVITY_ROUTING=session (a provisioner no dispatch can reach must fail loudly, not sit dark)`,
    );
  }
  const sandboxLane = newSandboxLane(sandboxProvisioner, runnerCredentials);
  // The deployment's one Environment rule: the Environment save's refusal,
  // the session's resolution and admission, the turn's admission and
  // server info's advertisement all read this object, so none of them can
  // disagree with another (domain/run/environment-admission.ts).
  const environmentPolicy = newEnvironmentPolicy(sandboxLane, temporalConfig);
  // Which model providers serve an organization: the composed provider
  // (the cloud's, over its keys), else the built-in answer from what this
  // server's runners were declared to reach. One instance, read by the run
  // create chain's refusal and by getModelReadiness alike.
  const providerAvailability =
    extensions.drivers.providerAvailability ?? runnerProviderAvailability(config.runnerProviders);
  if (sandboxLane.enabled) {
    logger.info("sandbox provisioner composed", {
      type: config.sandboxProvisionerType,
    });
  }
  // The driver's own background work (an idle sweep), started with the
  // server's other loops and stopped before them (start()/shutdown()).
  let sandboxBackground: SandboxBackgroundHandle | undefined;
  const healthState = new HealthState();
  // The model catalog: ONE provider instance feeds the pin checks and
  // the transport's registry lane, so the pickers and the checks can
  // never drift — on either arm. With
  // no extension provider composed, the OSS ModelRegistryStore (the
  // bundled catalog in src/modelcatalog) is constructed and
  // this root owns its refresh lifecycle; with one composed, the OSS store
  // and its hourly upstream refresh are never built — a substituted
  // composition must not keep fetching registry data nobody reads.
  let modelCatalog: ModelCatalogProvider;
  let ossModelRegistryStore: ModelRegistryStore | undefined;
  if (extensions.drivers.modelCatalogProvider !== undefined) {
    modelCatalog = extensions.drivers.modelCatalogProvider;
  } else {
    ossModelRegistryStore = new ModelRegistryStore({
      bundledDocument: bundledModelRegistryDocument(),
      upstreamOrigin: config.modelRegistryUpstream,
      refreshEnabled: config.modelRegistryRefreshEnabled,
      logger,
      fetchImpl: options.fetchImpl,
    });
    modelCatalog = ossModelRegistryStore;
  }
  const registryLanes = createRegistryLanes({
    modelRegistryStore: modelCatalog,
  });
  // One fan-out of each session's event log for both routers and the
  // worker, so an event a worker's write appends reaches every
  // externally-connected streamEvents.
  const sessionEventBroker = new SessionEventBroker(logger);
  // Recover's per-execution turns (stigmer#1672): built here, not inside
  // routes() (which runs twice), so a recover over either router waits
  // for one over the other.
  const agentExecutionRecoverSerializer = new KeyedSerializer();
  // Stage: the routine's schedule clock, in injection order:
  // config → artifact → syncer → run starter → (worker below) →
  // reconciler. The client provider closes over `temporalManager`,
  // declared just below — legal and deliberate: the manager's factory list
  // must include the routine worker at construction, while the syncer and
  // reconciler only READ the client at call time, long after boot (a call
  // before initialization would throw loudly, the composition-root idiom).
  const routineTemporalConfig = newRoutineConfigFromEnv();
  const scheduleClientProvider = (): TemporalClient | undefined =>
    temporalManager.getClient();
  const routineArtifact = new RoutineArtifact(routineTemporalConfig);
  // Grading: a completed run's run-health score, written by the grading
  // workflow on its own queue (temporal/grading/). The observer starts it
  // and runs after every extension's observer, so the hosted edition's
  // own observers (its channel nudge) keep their timing; the score writes
  // and the run-delete cascade ride the in-process lane as the server,
  // resolved lazily for the boot-ordering reason the run worker's are.
  const gradingTemporalConfig = newGradingConfigFromEnv();
  const scoreRecorder = (): ScoreRecorder => requireInProcess().scoreRecorder;
  const scoreDeleter = (): ScoreDeleter => requireInProcess().scoreDeleter;
  const gradingObserver = newGradingObserver({
    client: () => temporalManager.getClient(),
    config: gradingTemporalConfig,
    recorder: scoreRecorder,
    logger,
  });
  // A turn stopped while it waits puts back its undone files at once,
  // through the reconcile turn an undo on an ended turn starts, as the
  // person who decided the undo (domain/session/filereview/stopped-turn.ts).
  const stoppedTurnObserver = newStoppedTurnObserver({
    logger,
    store,
    reconcileTurns: () => requireInProcess().reconcileTurnCreator,
    callerOf: undoDeciderCaller(personAccounts, () => singleOrganizationCaller),
  });
  // A session's queued messages: the turn they wait for starts as the turn
  // that worked ends, in-process AS THE NEWEST SENDER, every create check
  // met again (domain/run/queued-turn.ts). The workflow's last activity is
  // the durable start; the observer starts it at once, and for a turn
  // that ends outside its workflow.
  const queuedTurnDeps = {
    store,
    logger,
    sessionEventBroker,
    creator: () => requireInProcess().queuedTurnCreator,
    callerOf: undoDeciderCaller(personAccounts, () => singleOrganizationCaller),
    queuedSenderLane: extensions.drivers.queuedSenderLane,
  };
  /* v8 ignore next -- @preserve: called only by a run's workflow end and by sendMessage past admission, both needing an engine */
  const queuedTurns: QueuedTurnStarter = (sessionId) => startQueuedTurn(queuedTurnDeps, sessionId);
  const queuedTurnObserver = newQueuedTurnObserver(queuedTurnDeps);
  const runStatusObservers = [
    ...extensions.statusObservers,
    gradingObserver,
    stoppedTurnObserver,
    queuedTurnObserver,
  ];
  const runScores = newRunScoreCascade({
    store,
    logger,
    deleter: scoreDeleter,
  });
  // Eval runs: one suite workflow per eval run (temporal/evals/), started
  // by create and cancelled by cancel, on the eval queue its worker polls.
  // A try's conversation is deleted through the session domain's own
  // delete as the server, the judge session's lane.
  const evalsTemporalConfig = newEvalsConfigFromEnv();
  const evalRunWorkflows = newTemporalEvalRunWorkflows({
    client: () => temporalManager.getClient(),
    taskQueue: evalsTemporalConfig.stigmerQueue,
  });
  /* v8 ignore next -- @preserve: called only by an eval run's delete, after boot */
  const evalRunTrySessions = () => requireInProcess().judgeSessionDeleter;
  const routineSyncer = new RoutineSyncer(
    scheduleClientProvider,
    store,
    routineArtifact,
    logger,
  );
  // Every fire enters the FULL run create pipeline through the in-process
  // run client (the RunStarter's ExecutionCreator edge), propagating the
  // identity the identity stage chose (routineFireIdentity) by the
  // creator's asCaller lane.
  const routineRunStarter = new RunStarter({
    store,
    config: routineTemporalConfig,
    executions: {
      create: (execution, fireCaller) =>
        requireInProcess().routineExecutionCreator.create(
          execution,
          fireCaller,
        ),
    },
    fireIdentity: routineFireIdentity,
    logger,
  });
  const routineReconciler = new RoutineReconciler(
    scheduleClientProvider,
    store,
    routineSyncer,
    routineTemporalConfig,
    logger,
  );
  // The manager owns the connection lifecycle; one factory per domain
  // worker — agent-execution and the routine clock.
  const temporalManager = new TemporalManager({
    hostPort: config.temporalHostPort,
    namespace: config.temporalNamespace,
    connection: config.temporalConnection,
    logger,
    // The composed provider's optional resolvePayloadKey capability rides
    // the decode codec: database-resident rpk_ keys for
    // desktop-runner histories. Absent → env keys only, today's behavior.
    payloadCodecs: loadServerPayloadCodecs(
      runnerCredentials.resolvePayloadKey?.bind(runnerCredentials),
    ),
    workerFactories: [
      newAgentExecutionWorkerFactory({
        store,
        logger,
        // The worker's own-behalf status writes ride the in-process
        // transport (stigmer#979) — the same lane as the RunStarter's
        // create edge above, resolved lazily for the same boot-ordering
        // reason. The lane's position 1 mints the internal caller class
        // the Authorize step honors, and its handler IS the runner's
        // updateStatus path, so the composed Authorizer, the status
        // hooks, and the broadcast reach the run's terminal writes
        // by construction — the worker composes none of them itself.
        statusWriter: () => requireInProcess().executionStatusWriter,
        // The worker's CloseFileReview write appends `decided` events to
        // the session's log; the one fan-out, as for every other writer.
        sessionEventBroker,
        queuedTurns,
        temporalConfig,
      }),
      newRoutineWorkerFactory({
        store,
        config: routineTemporalConfig,
        syncer: routineSyncer,
        runStarter: routineRunStarter,
        logger,
      }),
      newGradingWorkerFactory({
        store,
        config: gradingTemporalConfig,
        recorder: scoreRecorder,
        deleter: scoreDeleter,
        // Resolved when a judge activity runs, which needs a live engine:
        // the execution conformance's AI-judge suite runs them.
        /* v8 ignore next -- @preserve: called only by a judge activity on a live engine */
        judgeRuns: () => requireInProcess().judgeRunCreator,
        /* v8 ignore next -- @preserve: called only by a judge activity on a live engine */
        judgeSessions: () => requireInProcess().judgeSessionDeleter,
        gradingCaller,
        logger,
      }),
      // Eval runs: the suite and case workflows on their own queue
      // (temporal/evals/). The archive reader, the artifact read and the
      // in-process lane are resolved when an activity runs, after the
      // stores below and the routes exist.
      newEvalsWorkerFactory({
        store,
        config: evalsTemporalConfig,
        /* v8 ignore start -- @preserve: called only by an eval activity on a live engine */
        suites: {
          readArchive: (source) =>
            newCaseArchiveReader({ store, plugins: pluginArtifactStorage, evals: evalArtifactStorage }).readArchive(source),
        },
        catalog: evalModelCatalogOf(modelCatalog),
        tries: () => requireInProcess().evalRunTries,
        sessions: evalRunTrySessions,
        readArtifact: (storageKey) => artifactStorage.download(storageKey),
        /* v8 ignore stop */
        recorder: scoreRecorder,
        deleter: scoreDeleter,
        evalRunCaller,
        logger,
      }),
      // Extension workers append after the OSS set — each on its own
      // queue, one worker per queue.
      ...extensions.workers,
    ],
  });
  // The provider IS the injection mechanism (no re-injection on
  // reconnect): controllers observe the manager's CURRENT client at
  // request time, so reconnects propagate with zero re-wiring.
  const executionEngineState = newExecutionEngineStateProvider({
    manager: temporalManager,
    config: temporalConfig,
    store,
    runnerCredentials,
    logger,
  });
  // The artifact blob store (shared by run attachments and run files,
  // and skill push). The health probe runs in start(), a boot check.
  // The factory consults the composition's registered
  // drivers for non-built-in types.
  //
  // The download lane's placement (boot/artifact-lane.ts): the configured
  // port, or the port beside the one the unified listener binds, ephemeral
  // when that one is. Unset, the serve URL reads the port the lane actually
  // bound in start(), before any request can mint a URL.
  const artifactLanePort = resolveArtifactLanePort({
    configured: config.artifactHttpPort,
    unifiedPort: options.portOverride ?? config.grpcPort,
  });
  let artifactLaneBoundPort: number | undefined;
  // The key the local blob backend signs its download links with, and the
  // two lanes that serve them verify by: from the key ladder when either
  // store is local, a key nothing was signed with when both are buckets
  // (artifactstorage/url-signer.ts, downloadUrlSignerFor).
  const downloadUrlSigner = downloadUrlSignerFor(
    config.artifactStorageType === "local" ||
      config.skillArtifactStorageType === "" ||
      config.skillArtifactStorageType === "local",
  );
  const artifactStorage = newArtifactStorage(
    {
      type: config.artifactStorageType,
      localBasePath: config.artifactLocalBasePath,
      localServeUrl: resolveArtifactServeUrl(
        config.artifactLocalServeUrl,
        () => artifactLaneBoundPort,
      ),
      localUrlSigner: downloadUrlSigner,
      r2Bucket: config.r2Bucket,
      r2Endpoint: config.r2Endpoint,
      r2AccessKeyId: config.r2AccessKeyId,
      r2SecretAccessKey: config.r2SecretAccessKey,
      r2Region: config.r2Region,
      r2RunnerEndpoint: config.r2RunnerEndpoint,
    },
    extensions.drivers.artifactStorageDrivers,
  );
  // The artifact download lane: a SECOND loopback listener, local storage
  // only — deliberately not a unified-port lane.
  // Lifecycle rides start()/shutdown().
  const artifactFileServer =
    config.artifactStorageType === "local"
      ? createArtifactFileServer({
          basePath: config.artifactLocalBasePath,
          signer: downloadUrlSigner,
          logger,
        })
      : undefined;
  // The skill artifact store + transfer lane. The
  // store is content-addressed and never-GC at {storagePath}/skills/;
  // the slots registry wipes {storagePath}/skills/staging at boot (orphans
  // from a dead process are useless — the registry died with it). On OSS
  // the lane is ALWAYS configured: the
  // FailedPrecondition lane-absent arms exist for construction-order
  // safety, and the capability matrix pins skillArtifactTransferLane=true.
  //
  // The store is the skill-domain port over a PER-DOMAIN blob
  // driver: skill keeps its own root and its own
  // backend knob (SKILL_ARTIFACT_STORAGE_TYPE), so an r2-configured
  // deployment changes nothing for skill artifacts until it opts in
  // explicitly, and the local skills/ directory keeps serving in place
  // on the default arm.
  //
  // Capability URLs come from the driver through the staging port
  // (domain/skill/transfer/staging.ts, stigmer#1219): the local driver's
  // presignPut reserves a slot here and renders the lane URL below, a
  // bucket driver's signs a PUT straight to the bucket, and the
  // controllers cannot tell which. The slots are constructed on every
  // arm so the HTTP lane always has a registry to consult; on a bucket
  // arm nothing is ever reserved in it.
  //
  // Both URLs render from one base (boot/skill-transfer-origin.ts): the
  // configured SKILL_TRANSFER_BASE_URL, or the unified port's loopback
  // origin, read from the port the listener actually bound in start() when
  // that port is ephemeral (stigmer#1386).
  let unifiedBoundPort: number | undefined;
  const skillTransferBase = resolveSkillTransferBaseUrl({
    configured: config.skillTransferBaseUrl,
    unifiedPort: options.portOverride ?? config.grpcPort,
    boundPort: () => unifiedBoundPort,
  });
  const renderSkillTransferBase = (): string =>
    typeof skillTransferBase === "function"
      ? skillTransferBase()
      : skillTransferBase;
  const skillUploadSlots = new UploadSlots(
    config.storagePath,
    STAGING_KEY_PREFIX,
    DEFAULT_SLOT_TTL_MS,
    MAX_ZIP_SIZE,
  );
  const skillType =
    config.skillArtifactStorageType === ""
      ? "local"
      : config.skillArtifactStorageType;
  const skillStorageDriver = ((): ArtifactStorage => {
    if (skillType === "local") {
      // Layout invariant: {storagePath}/skills exists from boot with
      // 0755 (the generic driver only creates directories on demand).
      mkdirSync(path.join(config.storagePath, "skills"), {
        recursive: true,
        mode: 0o755,
      });
      // The local presigned-PUT arm rides the skill transfer lane's slot
      // mechanism (one upload surface, no new lane). The
      // slots stage inside THIS driver's root under the domain's staging
      // key, so download(key) reads back what the lane received; the
      // serve URL is the lane's download route, so getSignedUrl renders
      // the very URL the lane dispatches.
      return new LocalArtifactStorage(
        config.storagePath,
        typeof skillTransferBase === "function"
          ? () => transferServeUrl(skillTransferBase())
          : transferServeUrl(skillTransferBase),
        downloadUrlSigner,
        {
          reserve: (key, declaredSizeBytes) => {
            const { ttlMs } = skillUploadSlots.reserve(key, declaredSizeBytes);
            return {
              url: skillUploadUrl(renderSkillTransferBase(), uploadRefOf(key)),
              ttlMs,
            };
          },
        },
      );
    }
    // Non-local skill backends share the artifact store's R2 settings for
    // the built-in arm and the composition's registered drivers beyond it.
    return newArtifactStorage(
      {
        type: skillType,
        localBasePath: config.storagePath,
        localServeUrl: "",
        localUrlSigner: downloadUrlSigner,
        r2Bucket: config.r2Bucket,
        r2Endpoint: config.r2Endpoint,
        r2AccessKeyId: config.r2AccessKeyId,
        r2SecretAccessKey: config.r2SecretAccessKey,
        r2Region: config.r2Region,
        r2RunnerEndpoint: config.r2RunnerEndpoint,
      },
      extensions.drivers.artifactStorageDrivers,
    );
  })();
  const skillArtifactStorage = newSkillArtifactStorage(skillStorageDriver);
  // Plugin archives are pushed archives exactly as skills' are, so they
  // ride the same blob driver and backend selection; the key prefix
  // (`plugins/`) keeps the two stores apart and the plugin store owns its
  // keys (src/archive/content-store.ts).
  const pluginArtifactStorage = newContentAddressedArchiveStore(
    skillStorageDriver,
    PLUGIN_ARTIFACT_KEY_PREFIX,
  );
  // Eval archives the same way, under `evals/`.
  const evalArtifactStorage = newContentAddressedArchiveStore(
    skillStorageDriver,
    EVAL_ARTIFACT_KEY_PREFIX,
  );
  // Files (domain/file/): the File store's own driver, built as the
  // skill's is. On the local arm it is a local driver over the ARTIFACT
  // root, where a run's stored attachments already live, and the Files
  // transfer lane serves its upload slots and signed links on the unified
  // port from the same public base as the skill lane, so a sandboxed
  // runner and a person reach it where they reach skill archives. On any
  // other arm it is the generic store itself (ARTIFACT_STORAGE_TYPE, the
  // cloud's registered bucket driver), so bytes stay in the bucket they
  // are in today. The slots exist only on the local arm: they wipe their
  // staging directory at boot.
  const filesLocal = config.artifactStorageType === "" || config.artifactStorageType === "local";
  const fileUploadSlots = filesLocal
    ? new UploadSlots(
        config.artifactLocalBasePath,
        FILE_STAGING_KEY_PREFIX,
        FILE_UPLOAD_URL_TTL_MS,
        config.fileMaxBytes,
        Date.now,
        STAGED_FILE_NAME,
      )
    : undefined;
  const fileStorage: ArtifactStorage =
    fileUploadSlots === undefined
      ? artifactStorage
      : new LocalArtifactStorage(
          config.artifactLocalBasePath,
          typeof skillTransferBase === "function"
            ? () => fileTransferServeUrl(skillTransferBase())
            : fileTransferServeUrl(skillTransferBase),
          downloadUrlSigner,
          {
            reserve: (key, declaredSizeBytes) => {
              const { ttlMs } = fileUploadSlots.reserve(key, declaredSizeBytes);
              return {
                url: fileUploadUrl(renderSkillTransferBase(), fileUploadRefOf(key)),
                ttlMs,
              };
            },
          },
        );
  const fileBlobs = newFileBlobs({
    store,
    storage: fileStorage,
    logger,
    maxBytes: config.fileMaxBytes,
  });
  const fileTransferLane =
    fileUploadSlots === undefined
      ? undefined
      : newFileTransferLane({
          slots: fileUploadSlots,
          root: config.artifactLocalBasePath,
          signer: downloadUrlSigner,
          logger,
        });
  // One staging port for every archive kind, over the one skill blob
  // driver: the controllers mint, consume and sign through it and never
  // meet the slots or the bucket.
  const skillArchiveStaging = newArchiveStaging(skillStorageDriver, logger);
  const skillTransferLane = newSkillTransferLane(
    skillUploadSlots,
    skillArtifactStorage,
    downloadUrlSigner,
    logger,
  );
  // A hosted server relaying bytes through itself from its loopback
  // default mints URLs no caller can reach (stigmer#1219); nothing inside
  // the process can observe that, so the boot says it. Never fatal: the
  // inline push and every other RPC work, and a self-host behind a tunnel
  // it forgot to name deserves a pointer, not an outage.
  const transferOrigin = assessSkillTransferOrigin({
    configured: config.skillTransferBaseUrl,
    relaysThroughServer: skillType === "local" || filesLocal,
    requireAuthentication,
    containerRunners: !SANDBOX_DRIVERS_WITHOUT_RUNNER_IMAGE.includes(config.sandboxProvisionerType),
  });
  if (transferOrigin.kind === "loopback-hosted") {
    logger.warn(
      "the skill and file transfer lanes mint capability URLs on the server's own loopback while the server requires authentication or runs its runners in containers; pushes and uploads above the gRPC message cap, and a sandbox's skills and Files, will fail — set SKILL_TRANSFER_BASE_URL to the origin callers reach this server on",
      { baseUrl: transferOrigin.baseUrl },
    );
  }
  // The console lane (lane 4): present only when a static export
  // is bundled (slim artifacts) or configured (STIGMER_CONSOLE_DIR) —
  // "not bundled" is a modeled state, logged once, with the router
  // behaving exactly as it did before the lane existed.
  const consoleAssets = resolveConsoleAssets(config.consoleDir, logger);
  if (consoleAssets !== undefined) {
    logger.info("web console serving from unified port", {
      dir: consoleAssets.root,
      files: consoleAssets.fileCount,
    });
  } else {
    logger.debug("no web console export bundled; console lane disabled");
  }
  // The console is told how to sign in: the
  // OSS issuer arm of the posture, in the console's vocabulary. A composed
  // unit's own `requireAuthentication` is NOT expressed here — a
  // composition whose verifiers resolve its users serves its console its
  // own way (the cloud's container does). Issuer set but no console
  // client registered is WARN-degrade, the
  // STIGMER_OAUTH_REDIRECT_URI posture: the CLI and SDKs keep working with
  // API keys, and the served console refuses with copy naming the knob.
  const consoleSignIn: ConsoleSignInPosture = authEnabled
    ? {
        posture: "oidc",
        issuer: config.oidcIssuer,
        audience: config.oidcAudience,
        consoleClientId: config.oidcConsoleClientId,
      }
    : { posture: "trusted-local" };
  if (
    consoleAssets !== undefined &&
    consoleSignIn.posture === "oidc" &&
    consoleSignIn.consoleClientId === ""
  ) {
    logger.warn(
      "STIGMER_OIDC_ISSUER is set but STIGMER_OIDC_CONSOLE_CLIENT_ID is not — the web console this server serves cannot sign in; register a public PKCE client for the console at the issuer and set it",
    );
  }
  const consoleLane =
    consoleAssets !== undefined
      ? createConsoleLane({
          assets: consoleAssets,
          signIn: consoleSignIn,
          logger,
        })
      : undefined;
  // The search read side: the 13-kind extractor registry, the query
  // store over the driver's index read (no DB() escape hatch), and
  // the CQRS handler. Registry validation is warn-only — run ONCE here rather than inside routes(), which executes
  // twice (serving router + in-process router).
  const searchRegistry = newSearchableResourceRegistry();
  searchRegistry.validateExpectedKinds(logger);
  const searchQueryStore = new SqliteSearchQueryStore(
    store,
    searchRegistry,
    logger,
  );
  const searchHandler = new SearchHandler({
    store: searchQueryStore,
    rows: store,
    organizationDirectory,
    listReadScope,
    logger,
  });
  // The activity recents feed — pure reads over listResources.
  const activityHandler = new ActivityHandler(store, logger, listReadScope);
  // The plugin tools listing's engine provider — the same manager-backed
  // request-time idiom as executionEngineState above; a listing starts the
  // RUNNER's workflow, so no worker factory is added here.
  const pluginToolsEngineState = newPluginToolsEngineStateProvider({
    manager: temporalManager,
    config: temporalConfig,
    logger,
  });
  // The OAuth callback: configured, or derived from the served console's
  // own origin when it serves one — the public origin the skill transfer
  // lane already renders on, else the known port's loopback
  // (boot/oauth-redirect-uri.ts carries the posture; stigmer#1200). Absent
  // is WARN-degrade, not boot-fatal: a sign-in
  // through the console refuses with the pinned FailedPrecondition copy,
  // and the desktop's loopback sign-in still works.
  const oauthRedirect = resolveOAuthRedirectUri({
    configured: config.oauthRedirectUri,
    servesConsole: consoleAssets !== undefined,
    publicOrigin: config.skillTransferBaseUrl,
    port: options.portOverride ?? config.grpcPort,
  });
  switch (oauthRedirect.kind) {
    case "configured":
      break;
    case "derived":
      logger.info(
        "STIGMER_OAUTH_REDIRECT_URI is not set — deriving the served console's callback for sign-ins",
        {
          redirectUri: oauthRedirect.uri,
          from: oauthRedirect.from,
        },
      );
      break;
    case "absent":
      logger.warn(
        "STIGMER_OAUTH_REDIRECT_URI is not set — sign-ins through the console and Connect links are unavailable (startSignIn will refuse)",
      );
      break;
    default: {
      const exhaustive: never = oauthRedirect;
      throw new Error(String(exhaustive));
    }
  }
  const oauthRedirectUri =
    oauthRedirect.kind === "absent" ? "" : oauthRedirect.uri;
  // The ONE fetch user-supplied URLs are dialled with: the MCP endpoint
  // probed at save time, and every login server a sign-in, a renewal or a
  // Connect link reaches. Every hop is judged under the edition's egress policy
  // (`drivers.outboundEgress`; the default is open source's relaxed
  // posture, installed at this `??` site like the permissive Authorizer),
  // and every socket opens to an address that policy judged, so a name
  // cannot answer one address to the check and another to the connect.
  // `options.fetchImpl` is the test seam under the guard.
  const outboundFetch = nodeGuardedFetch(
    extensions.drivers.outboundEgress ?? relaxedEgressPolicy(),
    { fetchImpl: options.fetchImpl },
  );
  // The run's credential resolver (domain/vault/resolve.ts): the one rule
  // for which login or secret fills each key, used by run create and
  // recover and by the MCP connect lane. The sign-in freshener renews an
  // expired sign-in with the login app it recorded, whose egress rides the
  // guarded fetch.
  const signInFreshener: SignInFreshener = newSignInFreshener({
    vaults: vaultService,
    store,
    secretService,
    loginProviders: config.loginProviders,
    logger,
    fetchImpl: outboundFetch,
  });
  // Stigmer's OAuth Client ID Metadata Document: offered to login servers
  // that take one only when the unified port has a public https origin a
  // login server can fetch it from (domain/vault/sign-in/client-document.ts).
  const clientDocumentUrl = clientDocumentUrlFor(config.skillTransferBaseUrl);
  const vaultResolver = newVaultResolver({
    store,
    logger,
    authorizer,
    secretService,
    vaults: vaultService,
    accounts: identityAccounts,
    freshener: signInFreshener,
  });
  // The SAME `routes` function registers every service on BOTH the serving
  // router and the in-process router transport (createInProcessClients).
  // Handlers are stateless over the same store, so the two routers behave
  // as one server. Chain traversal on
  // internal calls is the point: an in-process apply/get is
  // validated, logged, and kind-tagged exactly like an external one — the
  // one deliberate difference is position 1: internal calls carry the
  // internal caller class, wire calls the verifier chassis's identity.
  //
  // requireInProcess breaks the routes↔clients definition cycle: the lazy
  // domain providers are only invoked at request time, after boot
  // completes, so the throw is the composition-root loudness idiom — never
  // expected to fire.
  // The organization purge (domain/organization/purge/): the core's kind
  // purges over the same stores and drivers the delete chains use, the
  // units' stages after the core's quiesce, and the runner that drives
  // them from the deletion table. Started with the server's loops and
  // stopped before Temporal and the store close.
  const corePurges = newCoreKindPurges({
    store,
    logger,
    grantPath,
    authorizationLifecycle,
    secretService,
    routineClock: () => routineSyncer,
    channelRuntime: extensions.drivers.channelRuntime,
    accounts: identityAccounts,
    accountLifecycle: roleLifecycle,
    runScores,
    evalRunWorkflows,
    fileBlobs,
  });
  const purgeQuiesce = newQuiesceStage({
    store,
    logger,
    routinePurge: corePurges.quiesce,
    agentEngine: executionEngineState,
    sandboxLane,
  });
  const purgeContent = newContentStage(corePurges.content);
  const organizationPurge = new OrganizationPurgeRunner({
    store,
    logger,
    listIndexes: LIST_INDEXES,
    stages: orderOrganizationPurgeStages({
      quiesce: purgeQuiesce,
      units: extensions.orgPurge,
      content: purgeContent,
      shred: newShredStage(secretService),
      children: newChildrenStage(store),
      final: newFinalStage({
        store,
        logger,
        grantPath,
        lifecycle: roleLifecycle,
        // A row a racing create stored after its stage passed.
        sweepFirst: [
          purgeQuiesce,
          ...extensions.orgPurge.stages.map(({ stage }) => stage),
          purgeContent,
        ],
      }),
    }),
  });
  // Access-history retention, only when a host declares a window
  // (`ServerExtension.accessHistoryRetentionDays`; the registry refuses one
  // on open source): the composed grant store's history, the library's
  // adapter or a host's own driver, aged out every hour. No window, no
  // runner: every entry is kept.
  const historyRetention =
    extensions.accessHistoryRetentionDays === undefined
      ? undefined
      : new AccessHistoryRetentionRunner({
          grants,
          retentionDays: extensions.accessHistoryRetentionDays,
          logger,
        });
  let inProcess: InProcessClients | undefined;
  function requireInProcess(): InProcessClients {
    if (inProcess === undefined) {
      throw new Error("in-process clients not wired (boot ordering bug)");
    }
    return inProcess;
  }
  const routes = (router: ConnectRouter): void => {
    registerHealthService(router, healthState);
    // The gate-slot and status-hook extension points ride the same
    // explicit-deps pattern the authorizer established: the three
    // slot-hosting domains receive the
    // merged gateSteps; agentexecution additionally receives the
    // status-transition hooks (both empty in the no-extension composition).
    registerOrganizationServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      gateSteps: extensions.gateSteps,
      // The delete revokes the organization's rows through the one grant
      // path, before its row goes (domain/organization/steps.ts).
      grantPath,
      // The role lifecycle and the directory (the identity stage): the
      // composed drivers, or open source's under the built-in posture.
      authorizationLifecycle: roleLifecycle,
      organizationDirectory,
      // The composition's organization count (ServerExtension.orgLimit).
      orgLimit: extensions.orgLimit,
      // The delete hands an accepted organization to the purge.
      purge: organizationPurge,
      accounts: identityAccounts,
    });
    // ApiKey registers with the tenancy/IAM family at the top. The chassis's apikey VERIFIER shares this
    // domain's lookup module — not the RPC (domain/apikey/lookup.ts).
    registerApiKeyServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
      accounts: identityAccounts,
    });
    // IdentityAccount: served once by open source in every
    // edition over the store PORT bound in the identity-accounts stage; a
    // composition adds what differs per edition through the registry —
    // the federation capability (the four federated RPC arms) and the
    // provision slot's gate steps (the cloud's first-organization step).
    // The membership rules are core, selected by posture.
    registerIdentityAccountServices(router, {
      ...identityAccountPath,
      provisioner: identityAccountProvisioner,
      federation: extensions.drivers.identityFederation,
      gateSteps: extensions.gateSteps,
      membership,
      deleteMyVaults: (person, caller) =>
        deleteAllMyVaultsOf(
          {
            store,
            logger,
            secretService,
            authorizationLifecycle,
            vaults: vaultService,
          },
          person,
          caller,
        ),
      deleteAccountKeys: (owners, caller) =>
        deleteKeysOwnedBy(
          {
            store,
            logger,
            grantPath,
            authorizationLifecycle,
          },
          owners,
          caller,
        ),
      grantPath,
      createAccount: createIdentityAccount,
      // Without sign-in no API-key verifier is composed (the verifier
      // chain below), so no service account could ever authenticate.
      signInRequired: requireAuthentication,
    });
    // Grant: the ROW half served once by open source in
    // every edition over the store port and the grant path bound in the
    // identity stage. A composition adds what differs per edition through
    // the registry — a wider grant scope (`drivers.grantScope`; the
    // default is open source's organization-only scope, installed at this
    // `??` site like the permissive Authorizer) and the tuple-half query
    // engine (`drivers.authorizationQueries`; absent, those RPCs refuse
    // UNIMPLEMENTED). The chains take no lifecycle: a grant is the
    // authorization record, not a protected resource.
    registerGrantServices(router, {
      grantPath,
      grants,
      organizations: store,
      accounts: identityAccounts,
      authorizer,
      grantScope:
        extensions.drivers.grantScope ?? newOrganizationOnlyGrantScope(),
      queries: extensions.drivers.authorizationQueries,
      credentialBinding,
      principalDisplay: extensions.drivers.principalDisplay,
      gateSteps: extensions.gateSteps,
      edition: extensions.edition,
      retentionDays: extensions.accessHistoryRetentionDays,
      logger,
    });
    registerVaultServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      secretService,
      listReadScope,
      vaults: vaultService,
      // A sign-in at an address and Connect links (domain/vault/sign-in,
      // connect-link.ts): every login server dialled through the guarded
      // fetch.
      signIn: {
        store,
        logger,
        secretService,
        authorizer,
        credentialBinding,
        vaults: vaultService,
        pendingOAuthStates: store.pendingOAuthStates,
        clientRegistrations: store.oauthClientRegistrations,
        connectLinks: store.connectLinks,
        loginProviders: config.loginProviders,
        oauthRedirectUri,
        clientDocumentUrl,
        outboundFetch,
      },
      // The runner's fetch of a run's or a connect's values
      // (domain/vault/values.ts).
      values: {
        store,
        logger,
        runnerAuth: runnerCredentials,
        vaultResolver,
      },
    });
    // OAuthApp shares the one SecretService instance every secret kind
    // seals with.
    registerOAuthAppServices(router, {
      store,
      secretService,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
    });
    // The token service, served in every composition, so nothing else may
    // register it (route-shadowing.ts): mintGuestToken dispatches to the
    // composed capability. The mint writes app users through the
    // identity-account create path and the one grant path, as the minting
    // service account (domain/token/mint.ts), and signs with the ring the
    // keys stage resolved (none without a posture: the mint then refuses).
    registerTokenService(router, {
      mint: {
        store,
        authorizer,
        accounts: identityAccounts,
        createAccount: createIdentityAccount,
        grantPath,
        keys: platformTokenKeys,
        logger,
        now: () => new Date(),
      },
      guestTokenMinting: extensions.drivers.guestTokenMinting,
    });
    registerAgentServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
      modelRegistry: modelCatalog,
      evalRuns: {
        store,
        logger,
        authorizationLifecycle,
        sessions: evalRunTrySessions,
        workflows: evalRunWorkflows,
      },
      // The agent's delete tears down its Slack and WhatsApp channels
      // through the same runtime the channel's own delete uses, and its
      // routines' artifacts through the routine clock.
      channelRuntime: extensions.drivers.channelRuntime,
      routineClock: () => routineSyncer,
    });
    registerSessionServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      temporalConfig,
      gateSteps: extensions.gateSteps,
      sandboxLane,
      environmentPolicy,
      authorizationLifecycle,
      listReadScope,
      secretService,
      runScores,
      fileBlobs,
      sessionEventBroker,
      runnerAuth: runnerCredentials,
      // The reconcile turn an undo on an ended turn starts
      // (domain/session/filereview/decide.ts).
      reconcileTurns: () => requireInProcess().reconcileTurnCreator,
      // The answers to waiting tool uses and the session's stop
      // (domain/session/hitl/).
      engineState: executionEngineState,
      statusObservers: runStatusObservers,
    });
    // The channel family registers after the agent family: the channel,
    // its messaging and conversation services, then the channel apps.
    // ChannelApp shares the ONE SecretService instance every secret kind
    // seals with: one key, one enc:v1: format.
    registerChannelServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
      // The SAME composed catalog provider the registry lanes read —
      // the channel model-pin rule
      // (stigmer/stigmer#774) can never drift from the served pickers.
      modelRegistry: modelCatalog,
      // The channel runtime seam: undefined = the byte-pinned refusal
      // posture; a composed runtime serves install + write/delete hooks.
      channelRuntime: extensions.drivers.channelRuntime,
    });
    registerChannelMessageServices(
      router,
      extensions.drivers.channelRuntime,
      credentialBinding,
    );
    registerChannelConversationServices(
      router,
      extensions.drivers.channelRuntime,
      credentialBinding,
    );
    registerChannelAppServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      secretService,
      authorizationLifecycle,
      listReadScope,
    });
    registerEnvironmentServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
      environmentSupport: environmentPolicy.support,
    });
    registerFileServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
      blobs: fileBlobs,
    });
    // The runner's per-turn door to Files, under its run credential: its
    // conversation's Files in, what the agent saved in its outputs folder
    // out (domain/file/run-files.ts).
    registerRunFileService(router, {
      store,
      logger,
      runnerAuth: runnerCredentials,
      blobs: fileBlobs,
      lifecycle: authorizationLifecycle,
    });
    // Routine registers between channelapp and memory. The clock and
    // runner ride constant providers — production wiring always has both;
    // the provider SHAPE exists for embedded/test assemblies
    // that skip Temporal wiring, where undefined degrades to the refusal
    // the provider models.
    registerRoutineServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      modelRegistry: modelCatalog,
      clock: () => routineSyncer,
      runner: () => routineRunStarter,
      ownerAccounts: requireAuthentication ? identityAccounts : undefined,
      authorizationLifecycle,
      listReadScope,
      firesPerHour: config.routineFiresPerHour,
    });
    registerMemoryServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
      personAccounts,
      runnerCredentialProvider: runnerCredentials,
    });
    registerScoreServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      listReadScope,
    });
    registerScoringRuleServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
    });
    registerEvalRunServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      modelCatalog,
      suites: newCaseArchiveReader({ store, plugins: pluginArtifactStorage, evals: evalArtifactStorage }),
      workflows: evalRunWorkflows,
      sessions: evalRunTrySessions,
    });
    registerAgentExecutionServices(router, {
      store,
      logger,
      authorizer,
      credentialBinding,
      authorizationLifecycle,
      fileBlobs,
      listReadScope,
      meteredUsageProvider: extensions.drivers.meteredUsageProvider,
      personAccounts,
      visitorClassifier: extensions.drivers.visitorClassifier,
      runLanes: extensions.drivers.runLanes,
      routineRunProfile: routineTemporalConfig.executionProfile(),
      sessionEventBroker,
      recoverSerializer: agentExecutionRecoverSerializer,
      engineState: executionEngineState,
      modelRegistry: modelCatalog,
      providerAvailability,
      artifactStorage,
      gateSteps: extensions.gateSteps,
      statusObservers: runStatusObservers,
      runScores,
      responseDecorators: extensions.responseDecorators,
      sandboxLane,
      temporalConfig,
      sessionCreator: () => requireInProcess().executionSessionCreator,
      queuedTurns,
      queuedSenderLane: extensions.drivers.queuedSenderLane,
      runValuePlanner: {
        store,
        logger,
        agentLoader: () => requireInProcess().executionAgentLoader,
        sessionLoader: () => requireInProcess().executionSessionLoader,
        vaultResolver,
        localPrograms: newLocalProgramPolicy(sandboxLane, temporalConfig),
        environments: { policy: environmentPolicy, authorizer },
      },
    });
    registerSkillServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope,
      artifactStorage: skillArtifactStorage,
      fileBlobs,
      staging: skillArchiveStaging,
    });
    registerEvalServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope,
      artifactStorage: evalArtifactStorage,
      staging: skillArchiveStaging,
      credentialBinding,
    });
    // The runner's door to its run's eval case, under its run credential:
    // the Eval's archive at the version the run's case names, signed for
    // the runner's address (domain/eval/run-eval-case.ts).
    registerRunEvalCaseService(router, {
      store,
      logger,
      runnerAuth: runnerCredentials,
      artifactStorage: evalArtifactStorage,
      staging: skillArchiveStaging,
    });
    // The staging port is the skill lane's: one upload surface for every
    // archive. A tools listing's deps are wired unconditionally per the
    // composition-root idiom — engine availability is the modeled state
    // the provider answers at request time.
    registerPluginServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope,
      artifactStorage: pluginArtifactStorage,
      outboundFetch,
      staging: skillArchiveStaging,
      tools: {
        store,
        logger,
        authorizer,
        credentialBinding,
        engineState: pluginToolsEngineState,
        runnerAuth: runnerCredentials,
        vaultResolver,
        sandboxLane,
      },
      evalRuns: {
        store,
        logger,
        authorizationLifecycle,
        sessions: evalRunTrySessions,
        workflows: evalRunWorkflows,
      },
    });
    // The two CQRS query services register between the domains and the
    // github/platform tail.
    registerSearchServices(router, { handler: searchHandler, logger });
    registerActivityServices(router, { handler: activityHandler, logger });
    // GitHub: the repository reads use the caller's github.com login
    // server-side, so no page ever holds the token. The login itself is a
    // vault sign-in at github.com.
    registerGitHubServices(router, {
      logger,
      authorizer,
      credentialBinding,
      vaults: vaultService,
      fetchImpl: options.fetchImpl,
    });
    // Platform registers LAST of all controllers.
    registerPlatformServices(router, {
      runnerBootstrapTemporalAddress: config.runnerBootstrapTemporalAddress,
      runnerBootstrapMcpBridgeEndpoint: config.runnerBootstrapMcpBridgeEndpoint,
      temporalNamespace: config.temporalNamespace,
      runnerAuthService: runnerCredentials,
      edition: extensions.edition,
      version,
      authenticationRequired: requireAuthentication,
      singleOrganization,
      // The built-in `absent` answer installs here, at the consumer, when
      // no unit registered a license-status provider: open source and the
      // cloud hold no key, and only an Enterprise unit ever has one.
      licenseStatus: extensions.drivers.licenseStatus ?? ABSENT_LICENSE_STATUS,
      providerAvailability,
      modelCatalog,
      authorizer,
      environmentPolicy,
      now: () => new Date(),
      logger,
    });
    // Extension services register after the whole OSS set, inside the ONE
    // routes closure — so the serving router AND the in-process transport
    // see them by construction (the two routers serve the same set,
    // extension services included). A registration that would
    // shadow a route already served is a boot throw (route-shadowing.ts).
    registerExtensionServicesUnshadowed(router, extensions.services);
  };
  const resourceReferences = createResourceReferenceInterceptor(
    store.resourceNames,
  );
  const inProcessWiring = createInProcessClients(routes, logger, {
    deletingOrganizations,
    resourceReferences,
  });
  inProcess = inProcessWiring.clients;

  // What the posture (resolved in the storage stage) registers, in claim
  // order (opaque keys first — the cheapest claim — then the JWT lanes), ahead of the
  // extension entries ("OSS entries first", the registry contract):
  //   - the API-key verifier rides the POSTURE, not the issuer
  //     (stigmer#984): the apikey domain is open-source tier and mints
  //     `stk_` keys in every composition, so any composition with an
  //     authentication posture must honor the keys it issues. Gating it on
  //     the issuer left a posture-declaring composition minting keys
  //     nothing verified.
  //   - the OIDC verifier rides the ISSUER alone: it is open source's
  //     operator lane, and it claims only tokens its issuer signed
  //     (identity/oidc-verifier.ts), passing every other JWT on. So the
  //     knob and a composition's own lanes for other issuers compose side
  //     by side: the operator signs in through the knob, and a unit's lane
  //     claims the tokens of the issuers it names. A unit lane must refuse
  //     to route the operator's issuer (it is claimed here first).
  //   - both OSS verifiers resolve their subject through the identity-
  //     account domain: a provisioned user is
  //     stamped with the account id whichever credential they present,
  //     an unprovisioned one is admitted idp-shaped. They read the SAME
  //     port the domain writes through (`identityAccounts`, the
  //     identity-accounts stage — a composed driver included), so a row
  //     provisioning creates resolves on the very next request.
  //   - the runner-subject verifier rides the AUTHORIZATION posture
  //     (`built-in`, beside the Authorizer and the fire caller above): it
  //     admits the bearer of the server's own execution-scoped runner
  //     token as the human whose run it is, which only means something
  //     when the server enforces who may report on a run. Its place in
  //     the chain is the contract: BETWEEN `apikey` and `oidc`. Until
  //     2026-09-29 the OIDC verifier claimed any JWT-shaped token and threw
  //     on one it could not verify, so composed after it, ours never saw
  //     its own token and every runner call failed as the OIDC verifier's
  //     fault (stigmer#1137); it now claims only its own issuer's tokens,
  //     and the server's own token is still claimed first, by its own
  //     lane, whatever issuer an operator configures. Until 2026-09-16 this comment read "the
  //     runner's credential in either posture is an operator-minted API
  //     token via STIGMER_TOKEN — no runner-specific verifier"; that
  //     described a server whose Authorizer was permissive. The operator's
  //     key is still the runner's PROCESS credential (bootstrap, registry);
  //     the run credential is how it acts for each run. A unit with its
  //     own Authorizer composes none of this — its credential story is its
  //     own (the cloud's sandbox lanes).
  const identityVerifiers = [
    ...(requireAuthentication
      ? [
          newApiKeyIdentityVerifier({
            store,
            accounts: identityAccounts,
            logger,
            now: () => new Date(),
          }),
        ]
      : []),
    // The user-token lane rides the ring, which the keys stage resolves
    // only under an authentication posture. It sits before `oidc` for the
    // runner-subject verifier's reason (stigmer#1137): the OIDC verifier
    // would claim the platform token and throw on it.
    ...(platformTokenKeys !== undefined
      ? [
          newUserTokenVerifier({
            keys: platformTokenKeys,
            accounts: identityAccounts,
            store,
          }),
        ]
      : []),
    ...(authorizationPosture === "built-in"
      ? [
          newRunnerSubjectIdentityVerifier({
            store,
            accounts: identityAccounts,
            credentials: runnerCredentials,
          }),
        ]
      : []),
    ...(authEnabled
      ? [
          newOidcIdentityVerifier({
            issuer: config.oidcIssuer,
            audience: config.oidcAudience,
            accounts: identityAccounts,
            discovery: issuerDiscovery,
          }),
        ]
      : []),
    ...extensions.identityVerifiers,
  ];
  // A declared posture whose unit registers no verifier OF ITS OWN is a
  // boot fault, not a running server. The API-key lane alone cannot admit
  // the first caller — minting a key requires an authenticated caller, so
  // an apikey-only chain locks everyone out forever (the first-key
  // bootstrap problem, which is why apikey-only mode was
  // deferred). The same class as a misconfigured registry,
  // caught before any side effect.
  if (
    extensions.requireAuthentication !== undefined &&
    extensions.identityVerifiers.length === 0
  ) {
    throw new Error(
      `extension '${extensions.requireAuthentication.declaredBy}' declares the require-authentication posture, but registers no identity verifier of its own — the OSS API-key lane alone cannot admit the first caller (nobody could mint a key), so every non-public request would be refused; register a verifier or omit the declaration`,
    );
  }
  const postureSources = [
    ...(authEnabled ? ["oidc-issuer"] : []),
    ...(extensions.requireAuthentication !== undefined
      ? [`extension '${extensions.requireAuthentication.declaredBy}'`]
      : []),
  ];
  // Caller guards: open source's own first, then the extensions' — the
  // rule the verifier list follows ("OSS entries first"). The origin guard
  // exists only where minted user tokens can be presented, under the
  // posture that verifies them.
  const callerGuards = [
    ...(platformTokenKeys !== undefined
      ? [
          newEmbeddingOriginGuard({
            accounts: identityAccounts,
            store,
            logger,
          }),
        ]
      : []),
    ...extensions.callerGuards,
  ];
  logger.info("authentication posture resolved", {
    posture: requireAuthentication ? "required" : "trusted-local",
    source: postureSources.length > 0 ? postureSources.join(" + ") : "none",
    verifiers: identityVerifiers.map((v) => v.name).join(", "),
  });

  // The serving chain, built once: the network adapter and the Managed
  // Agents lane's in-memory transport below run this same array. Its
  // position-1 identity source is the verifier
  // chassis over the composed verifiers (zero verifiers and no
  // declared posture = trusted-local, byte-identical wire behavior)
  // under the resolved require-authentication posture (issuer OR unit
  // declaration, above), followed by the composed caller guards
  // (zero guards = today's behavior). The in-process
  // transport above carries its own
  // position-1 source — the internal caller class only it can mint
  // and NO guards: the in-process exemption is structural
  // (caller-guards.ts). The serving-only pair: position 0 is the error
  // boundary — the raw-error conversion net plus the
  // composed visitor sanitizer — and the request-metrics emitter sits
  // just inside the identity source. Both
  // are SERVING chain only, so in-process hops keep full diagnostics
  // and are never counted as requests, by construction.
  const servingInterceptors = buildInterceptorChain(
    logger,
    createVerifierChainInterceptor(
      identityVerifiers,
      callerGuards,
      logger,
      requireAuthentication,
    ),
    {
      errorBoundary: createErrorBoundaryInterceptor(
        logger,
        extensions.drivers.visitorErrorPolicy,
      ),
      requestMetrics: createRequestMetricsInterceptor(),
      organizationNames: createOrganizationNameInterceptor(
        newOrganizationNameResolver(store),
      ),
      ...(singleOrganization === undefined
        ? {}
        : {
            singleOrganization:
              createSingleOrganizationInterceptor(singleOrganization),
          }),
    },
    { deletingOrganizations, resourceReferences },
  );
  // The Managed Agents lane (transport/managed-agents/lane.ts) calls the
  // native methods through the serving chain held in memory: the same
  // routes and the same interceptor array as the network adapter, so a
  // lane call meets every guard, check and gate a network call meets, by
  // construction and with no network hop. Unlike the in-process
  // transport, it carries an outside caller's credentials and never the
  // internal caller class, so it is handed to the lane alone.
  const managedAgentsLane = createManagedAgentsLane({
    transport: createRouterTransport(routes, {
      router: {
        interceptors: servingInterceptors,
        readMaxBytes: MAX_MESSAGE_BYTES,
        writeMaxBytes: MAX_MESSAGE_BYTES,
      },
    }),
    authenticationRequired: requireAuthentication,
    logger,
  });

  const server = createUnifiedPortServer({
    logger,
    routes,
    interceptors: servingInterceptors,
    modelRegistryLane: registryLanes.modelRegistryLane,
    ...(clientDocumentUrl === ""
      ? {}
      : {
          oauthClientDocumentLane: createOAuthClientDocumentLane(
            clientDocument(clientDocumentUrl, oauthRedirectUri),
          ),
        }),
    skillTransferLane,
    ...(fileTransferLane === undefined ? {} : { fileTransferLane }),
    managedAgentsLane,
    consoleLane,
  });

  // The hand-over (extensions/composed-services.ts): every unit receives
  // the composition's own instances — the one Authorizer the Authorize
  // step calls, the list read scope, the grant check, the tuple lifecycle,
  // the in-process transport, the identity accounts' store binding and
  // create path, the policy store binding and the grant path's answer to
  // "whose resource is this" — before composeServer returns, because a
  // unit's lanes may be called by anyone from then on. The policy check is
  // the registered engine's, or under the built-in posture the evaluator's.
  const composedServices: ComposedServices = {
    authorizer,
    listReadScope,
    credentialBinding,
    childOrganizations: newChildOrganizations(store),
    authorizationQueries:
      extensions.drivers.authorizationQueries ??
      (authorizationPosture === "built-in"
        ? newBuiltInGrantCheck({
            store,
            grants,
            accounts: identityAccounts,
            rowReaders: extensions.drivers.resourceRowReaders,
          })
        : undefined),
    resourceAuthorizationLifecycle: authorizationLifecycle,
    inProcessTransport: inProcessWiring.transport,
    identityAccounts: {
      store: identityAccounts,
      create: createIdentityAccount,
    },
    grants,
    resourceOrganizations: {
      organizationOf: (resource) => grantPath.organizationOf(resource),
    },
    resourceNames: store.resourceNames,
  };
  for (const { hook } of extensions.onComposed) {
    hook(composedServices);
  }

  return {
    healthState,
    store,
    secrets: secretService,
    temporalManager,
    runnerAuthService,
    sessionEventBroker,
    inProcessTransport: inProcessWiring.transport,
    identityVerifiers,
    routes,
    organizationPurge,

    boundPorts(): BoundPorts | undefined {
      // Both are recorded inside start(): the lane binds before the
      // unified port, so a unified port means start() got past both.
      if (unifiedBoundPort === undefined) return undefined;
      return { grpc: unifiedBoundPort, artifactHttp: artifactLaneBoundPort };
    },

    async start(): Promise<number> {
      // The units' own boot work first, in unit order, before any worker,
      // reconciler or listener can reach their lanes: a repair of a unit's
      // rows must finish before anything serves, and a failed one fails
      // the start, naming its unit.
      for (const { unit, hook } of extensions.start) {
        try {
          await hook();
        } catch (error) {
          throw new Error(
            `extension '${unit}' failed to start: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
      // The one organization of a composition that declares one, made
      // before any background work reads the store and before the port
      // (boot/single-organization.ts). A failure is a boot throw, except a
      // create refused as a duplicate that leaves the store with none, which
      // leaves the fill off with a warning.
      if (singleOrganization !== undefined) {
        await ensureSingleOrganization({
          store,
          creator: inProcessWiring.clients.singleOrganizationCreator,
          caller: singleOrganizationCaller,
          holder: singleOrganization,
          logger,
        });
        // Under sign-in the organization is made as nobody: the people a
        // store already held when it was made get their roles on it here,
        // once (domain/grant/membership.ts).
        if (authorizationPosture === "built-in" && membership !== undefined) {
          await membership.ensureRolesOnServerOrganization();
        }
      }
      // Temporal boot is NON-fatal end to end: a failed
      // initial connect leaves the engine unavailable and the monitor
      // retrying; a failed worker start is a warning. Health below flips
      // SERVING regardless — engine availability is modeled in the
      // agentexecution domain, never in gRPC health.
      const connected = await temporalManager.initialConnect();
      if (connected) {
        await temporalManager.startWorkers();
      }
      temporalManager.startHealthMonitor();
      // Routine reconciliation: an immediate boot pass (the dev server may
      // have restarted with empty state while the daemon was down), the
      // periodic loop, and the reconnect kick.
      const kickRoutineReconcile = routineReconciler.startReconciliation();
      temporalManager.addReconnectHook(kickRoutineReconcile);
      // The organization purge: a first pass over the deletion table now
      // (a purge a stopped server left unfinished resumes), then its loop.
      organizationPurge.start();
      // Access-history retention: a first pass now, then hourly.
      historyRetention?.start();
      // The sandbox driver's background work, when it has any: it reads the
      // store and the sandbox platform, never Temporal.
      if (sandboxLane.enabled) {
        sandboxBackground = sandboxLane.provisioner.startBackground?.({
          sessions: newStoreSessionActivityReader(store, logger),
          logger,
        });
      }
      // Artifact storage must be reachable and writable before the server
      // answers: a failed probe fails the boot.
      await artifactStorage.health();
      // The download lane binds with the store it serves, and on the same
      // terms: a lane that cannot bind fails the boot, never serving on
      // with every download dead (stigmer#1089). Binding here, before SERVING and the unified port,
      // also means the derived serve URL exists before a request can mint
      // one.
      if (artifactFileServer !== undefined) {
        try {
          artifactLaneBoundPort = await artifactFileServer.listen(
            artifactLanePort,
            config.artifactHttpHost,
          );
        } catch (error) {
          throw artifactLaneBindError(
            error,
            config.artifactHttpHost,
            artifactLanePort,
            config.artifactHttpPort !== undefined,
          );
        }
      }
      // Rebuild the search index before the port binds: the index is
      // separate from the resources table, and rebuilding here makes every
      // stored resource discoverable the moment the server accepts
      // connections. Warn-only: a partial
      // rebuild degrades search, never boot.
      try {
        const indexed = await searchQueryStore.rebuildIndex();
        logger.info("Search index rebuilt at startup", { indexed });
      } catch (error) {
        logger.warn("Failed to rebuild search index at startup", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // The request counter is born at zero before the port binds (the
      // heartbeat's premise), and the boot says
      // whether anything will export it: the emitter is library
      // instrumentation on @opentelemetry/api, so "exporting" is the
      // host's meter provider (the cloud composition's bootstrap) and
      // "inert" is the OSS default until an export bootstrap exists —
      // two states an operator must be able to tell apart in the log.
      await initRpcMetrics();
      logger.info("request metrics", {
        posture: await metricsExportPosture(),
        instruments:
          "stigmer.grpc.request.count, stigmer.grpc.request.duration",
      });
      // Wiring complete → SERVING → background refresh → bind. The port
      // must be the LAST observable effect (serverGate contract).
      healthState.setOverall(ServingStatus.SERVING);
      // Undefined when an extension provider substituted the catalog —
      // that implementation owns its own freshness.
      ossModelRegistryStore?.startRefresh();
      const port = await server.listen(
        options.portOverride ?? config.grpcPort,
        options.host,
      );
      // Recorded in the listen continuation, a microtask that runs before
      // the first accepted connection is dispatched, so no wire request
      // can mint a skill transfer URL before the port it names is known.
      unifiedBoundPort = port;
      logger.info("stigmer-server listening", { port });
      return port;
    },

    async shutdown(): Promise<void> {
      healthState.setOverall(ServingStatus.NOT_SERVING);
      // Session event streams end at once with UNAVAILABLE, and new ones
      // are refused, before the seconds the loops, the workers and the
      // transport take to stop: a watcher resumes on the server that stays
      // instead of waiting for this one's socket to be destroyed. Events
      // still appended here until the transport closes are stored, and the
      // watchers' tail read on the other server finds them.
      sessionEventBroker.close();
      ossModelRegistryStore?.stopRefresh();
      await artifactFileServer?.shutdown();
      // The sandbox driver's background work stops first: a pass mid-flight
      // still reads the store, which closes last.
      await sandboxBackground?.stop();
      // The reconciler stops before the manager: a pass mid-flight may
      // still call through the manager's client, and nothing may fire
      // after shutdown.
      await routineReconciler.stop();
      // The purge stops before the manager and the store: a stage in
      // flight may still terminate a run or write through the store.
      await organizationPurge.stop();
      // Retention stops before the store too: a batch in flight deletes
      // through it.
      await historyRetention?.stop();
      // Workers stop before the transport drains: an in-flight activity
      // may still write through the store, which closes LAST.
      await temporalManager.close();
      await server.shutdown();
      // The store closes LAST: in-flight handlers drained above may still
      // be mid-write.
      await store.close();
      logger.info("stigmer-server stopped");
    },
  };
}
