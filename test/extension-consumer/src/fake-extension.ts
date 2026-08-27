/**
 * The compile-proof fake extension (sub-project 20260826.09/O1, DD-005).
 *
 * This module typechecks a consumer-shaped composition against the
 * @stigmer/server exports map ALONE — every server import below is the
 * bare package name, resolved through the exports map to dist. If a needed
 * type or function is missing from the blessed surface, THIS file fails to
 * compile: the exports map's completeness is enforced by tsc, not by
 * review memory. Deep imports are deliberately absent; a consumer need
 * that cannot be expressed here is a seam request to OSS.
 *
 * It exercises every extension point a consumer can touch today: the
 * seven-point unit shape (services, workers, edition, authorizer,
 * verifiers, status hooks, the O5 driver kinds; gate slots are
 * compile-closed until O4 declares the ratified names), a gate-step body
 * built from the pipeline primitives, the store-fault idiom, and the
 * compose entry itself. It is never executed — the runtime behavior is
 * pinned by the server's own extension suite; execution here would need
 * real infrastructure for no additional proof.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";

import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  ArtifactStorageNotFoundError,
  composeServer,
  createLogger,
  InvalidTokenError,
  loadConfig,
  MintingDisabledError,
  notFoundError,
  ResourceNotFoundError,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "@stigmer/server";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusObserver,
  ArtifactStorage,
  ArtifactStorageDriverFactory,
  Authorizer,
  CallerIdentity,
  ComposedServer,
  IdentityVerifier,
  MintedToken,
  ModelCatalogProvider,
  PipelineStep,
  PresignedUpload,
  RunnerCredentialProvider,
  ServerExtension,
  Store,
  WorkerFactory,
} from "@stigmer/server";

/** A permissive Authorizer in the consumer's own code (the O2 shape). */
const authorizer: Authorizer = {
  authorize: (caller: CallerIdentity) =>
    Promise.resolve(
      caller.callerClass === "user"
        ? { kind: "allow" as const }
        : { kind: "deny" as const, reason: "machine callers are refused here" },
    ),
};

/** A claim-or-pass verifier (the O2 chain-entry shape). */
const verifier: IdentityVerifier = {
  name: "consumer-fake",
  verify: (token) =>
    Promise.resolve(
      token.startsWith("fake_")
        ? {
            identityId: "ida_consumer",
            callerClass: "user",
            issuer: "https://issuer.invalid",
            rawToken: token,
          }
        : null,
    ),
};

/**
 * A gate-step body built from the exported pipeline primitives — the shape
 * every cloud gate (billing preflight, capacity, tier validation) takes
 * once O4 opens the slots. The store-fault idiom rides along: a typed
 * not-found maps to NotFound, anything else rethrows.
 */
export function consumerGateStep(): PipelineStep<DescMessage> {
  return {
    name: "ConsumerFakeGate",
    execute: () => {
      const missing = false as boolean;
      if (missing) {
        throw notFoundError("billing account", "org-fake");
      }
    },
  };
}

/** The typed store not-found classes are importable for the instanceof idiom. */
export function isStoreNotFound(error: unknown): boolean {
  return error instanceof ResourceNotFoundError;
}

const statusObserver: AgentExecutionStatusObserver = (transition) => {
  void transition.execution.metadata?.id;
  void transition.newPhase;
};

const responseDecorator: AgentExecutionResponseDecorator = (
  execution,
  response,
) => {
  void execution.metadata?.id;
  // The control-signal field the §7 decorator contract names — it already
  // exists on the shared reply schema.
  void response.signal;
};

const workerFactory: WorkerFactory = () =>
  Promise.reject(new Error("compile-proof worker — never started"));

/**
 * A consumer-shaped model-catalog provider (the O5 §6a shape — the cloud's
 * DB-resident baseline implements exactly this surface, read per call).
 */
const catalogProvider: ModelCatalogProvider = {
  document: () => `{"models":[]}`,
  isValidModel: () => false,
  hasHarness: () => false,
  hasAnyModels: () => false,
  isValidModelOnAnyHarness: () => false,
  canonicalModelsAcrossHarnesses: () => [],
  canonicalModels: () => [],
  hasPricingVariant: () => false,
  hasPricingVariantForHarness: () => false,
  canonicalModelsWithVariant: () => [],
  canonicalModelsWithVariantForHarness: () => [],
  hasCapabilityForHarness: () => false,
  canonicalModelsWithCapabilityForHarness: () => [],
};

/**
 * A consumer-shaped runner-credential provider (the O5 §6c shape). The
 * per-arm fail posture is contract: verify failures collapse to
 * InvalidTokenError (callers fall closed to redaction); a provided lane
 * that cannot mint throws MintingDisabledError (mapped to the
 * presence-based not-minted response).
 */
const credentialProvider: RunnerCredentialProvider = {
  isEnabled: (lane) => lane === TOKEN_TYPE_EXECUTION_SCOPED,
  mint: (lane, _binding, ttlSeconds): MintedToken => {
    if (lane !== TOKEN_TYPE_EXECUTION_SCOPED) {
      throw new MintingDisabledError();
    }
    return { token: "fake-token", ttlSeconds };
  },
  verify: (): string => {
    throw new InvalidTokenError();
  },
};

/**
 * A consumer-registered blob driver (the O5 §6b registration shape) —
 * lazy factory, typed not-found, the widened size/presignPut surface.
 */
const consumerBlobDriver: ArtifactStorageDriverFactory =
  (): ArtifactStorage => ({
    upload: () => Promise.resolve(),
    download: (key) => Promise.reject(new ArtifactStorageNotFoundError(key)),
    size: (key) => Promise.reject(new ArtifactStorageNotFoundError(key)),
    presignPut: (declaredSizeBytes, ttlMs): Promise<PresignedUpload> =>
      Promise.resolve({
        url: `https://blob.invalid/put?size=${declaredSizeBytes}`,
        stagingKey: "staging/fake",
        ttlMs,
      }),
    getSignedUrl: () => Promise.resolve("https://blob.invalid/get"),
    delete: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    health: () => Promise.resolve(),
  });

const registerBillingService = (router: ConnectRouter): void => {
  router.service(BillingQueryController, {
    getBillingAccount: (input) =>
      create(BillingAccountSchema, { orgId: input.orgId }),
  });
};

/** The whole unit — every point a consumer can populate today. */
export const fakeExtension: ServerExtension = {
  name: "consumer-fake",
  edition: ServerEdition.cloud,
  authorizer,
  identityVerifiers: [verifier],
  statusTransitionHooks: {
    observers: [statusObserver],
    responseDecorators: [responseDecorator],
  },
  drivers: {
    modelCatalogProvider: catalogProvider,
    runnerCredentialProvider: credentialProvider,
    artifactStorageDrivers: new Map([["consumer-blob", consumerBlobDriver]]),
  },
  services: [registerBillingService],
  workers: [workerFactory],
};

/** The thin composition program's exact shape (blueprint §2a). */
export async function composeFakeCloud(): Promise<ComposedServer> {
  return composeServer({
    config: loadConfig(),
    logger: createLogger({ level: "info", pretty: false }),
    extensions: [fakeExtension],
  });
}

/**
 * The exported driver interfaces are consumable in extension signatures —
 * the O5 registrations above populate them; this bundle keeps the plain
 * type positions covered too.
 */
export interface ConsumerDriverBundle {
  readonly store: Store;
  readonly artifactStorage: ArtifactStorage;
  readonly modelCatalog: ModelCatalogProvider;
  readonly runnerCredentials: RunnerCredentialProvider;
}
