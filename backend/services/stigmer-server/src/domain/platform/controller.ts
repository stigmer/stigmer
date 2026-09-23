/**
 * Platform controller — ports pkg/domain/platform: the server's
 * self-description surface (NOT a resource domain — no store, no
 * pipelines; four direct handlers on PlatformQueryController).
 *
 * Proven by platform.conformance.test.ts (getServerInfo,
 * getRunnerBootstrapConfig and getLicenseStatus shapes; getRunnerScopedToken
 * is deliberately excluded there — its arms are exercised mid-execution)
 * and __tests__/platform.test.ts (the fail-soft mint matrix, the license
 * status arms, the stated-version arm, the #15 composed-server pattern).
 *
 * getLicenseStatus is the one arm every edition answers from a driver
 * point: a server's license is a fact about the server, like its edition,
 * and the provider behind `deps.licenseStatus` is the one place that
 * knows it (extensions/license-status.ts). The controller owns the clock
 * — it hands the provider one instant and stamps checked_at from the same
 * one — and copies the provider's presence contract to the wire unchanged.
 *
 * getRunnerScopedToken is the mint side of the runner-token lane
 * (oss#535) — the seam src/runnerauth/. What the token IS depends on the
 * server's posture, and so does who may obtain one:
 *
 *   - Under trusted-local (the laptop: one caller, nothing to separate)
 *     the arms below mint a clocked token for any caller naming an
 *     execution. The token is the LANE DISCRIMINATOR that lets the
 *     ExecutionContext read RPCs redact by default without breaking the
 *     runner, not a trust boundary — there is no identity for it to
 *     change.
 *   - Under the built-in authorization posture the same token is an
 *     IDENTITY: the runner-subject verifier admits its bearer as the
 *     human whose run it is (runnerauth/runner-subject-verifier.ts). A
 *     mint for anyone would be impersonation, so the built-in provider
 *     defines exchangeScopedToken and this controller delegates to it:
 *     the run credential is minted for the run's own person and nobody
 *     else (runnerauth/built-in-runner-credential-provider.ts). Runs get
 *     their credential from the dispatch itself (the engine clients put
 *     it on the workflow input); this exchange is the runner's fallback.
 *
 * The C4 capability delegation (20260827.09, gate ruling Q1): when the
 * composed provider defines exchangeScopedToken / bootstrapCredentials,
 * this controller delegates the exchange arms and the bootstrap
 * credential fields to it wholesale — per-arm caller gating, row
 * authorization, and multi-lane minting are POLICY, not contract, and
 * live behind the seam (the cloud's four-arm exchange; open source's
 * built-in gate). With neither defined (the trusted-local default), every
 * arm below behaves exactly as before; the conformance suites pin that
 * byte-identity.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { LicenseState } from "@stigmer/protos/ai/stigmer/platform/v1/license_pb";
import {
  GetLicenseStatusOutputSchema,
  GetRunnerBootstrapConfigOutputSchema,
  GetRunnerScopedTokenOutputSchema,
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type {
  GetLicenseStatusOutput,
  GetRunnerBootstrapConfigOutput,
  GetRunnerScopedTokenInput,
  GetRunnerScopedTokenOutput,
  GetServerInfoOutput,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { Logger } from "../../boot/logger.js";
import type { LicenseStatusProvider } from "../../extensions/license-status.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import type {
  RunnerCredentialProvider,
  RunnerScopedTokenRequest,
} from "../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../runnerauth/runnerauth.js";

export interface PlatformControllerDeps {
  /**
   * Temporal coordinates this server runs against, published to embedded
   * runners. In OSS the server and its runners are co-located, so the
   * address the server itself dials is the one runners should dial too —
   * no internal/external split (unlike Stigmer Cloud).
   */
  readonly temporalHostPort: string;
  readonly temporalNamespace: string;
  /**
   * Mints the execution-scoped tokens getRunnerScopedToken hands to
   * runners for the ExecutionContext decrypt lane (oss#535). Keyless
   * yields the presence-based "not minted" response. (Go also tolerates a
   * nil service in tests; the composition root here always wires one — a
   * keyless instance is the modeled disabled state.)
   */
  readonly runnerAuthService: RunnerCredentialProvider;
  /**
   * The served edition, composition-derived (DD-006; blueprint §11 item
   * 11): the extension registry declares it and defaults to oss, so the
   * cloud composition answers `cloud` without forking this controller.
   */
  readonly edition: ServerEdition;
  /**
   * The release reported beside the edition. The composition root resolves
   * it (ComposeOptions.version, else SERVER_VERSION), so this controller
   * never reads the build stamp itself: a library consumer with no bundle
   * states its installed release and answers exactly as a bundle would.
   */
  readonly version: string;
  /**
   * The resolved require-authentication posture (compose.ts: the OSS
   * issuer OR a unit's declaration), reported so a console can tell a
   * server that verifies its callers from one that trusts every request —
   * the features that hand out credentials only a verifying server
   * honours (PlatformClient token minting) are unavailable on the latter.
   * Always set on the wire, true or false: the field's absence is how a
   * client recognises a server that predates it.
   */
  readonly authenticationRequired: boolean;
  /**
   * What license this server holds (extensions/license-status.ts). The
   * composition root installs the built-in `absent` provider when no unit
   * registers one, so the field is required: a server that cannot answer
   * the question is a wiring error, never a silent no-op.
   */
  readonly licenseStatus: LicenseStatusProvider;
  /**
   * The clock getLicenseStatus evaluates against — injected so a test can
   * pin that the provider's instant and checked_at are the same one.
   */
  readonly now: () => Date;
  readonly logger: Logger;
}

/** Registers the platform query service on the router (routes stage). */
export function registerPlatformServices(
  router: ConnectRouter,
  deps: PlatformControllerDeps,
): void {
  router.service(PlatformQueryController, {
    getServerInfo: () => getServerInfo(deps),
    getLicenseStatus: () => getLicenseStatus(deps),
    getRunnerBootstrapConfig: (_input, ctx) =>
      getRunnerBootstrapConfig(deps, ctx),
    getRunnerScopedToken: (input, ctx) =>
      getRunnerScopedToken(deps, input, ctx),
  });
}

/** Go GetServerInfo: the server edition, release version and authentication posture. */
function getServerInfo(deps: PlatformControllerDeps): GetServerInfoOutput {
  return create(GetServerInfoOutputSchema, {
    edition: deps.edition,
    version: deps.version,
    authenticationRequired: deps.authenticationRequired,
  });
}

/**
 * The state of the license this server holds, as the composed provider
 * reports it at one instant.
 *
 * The report's arm (extensions/license-status.ts) is copied to the wire
 * field for field, so the output's presence contract holds by construction:
 * claims exactly when a ticket verified, key_id whenever one was presented.
 * checked_at is stamped from the SAME instant the provider evaluated
 * against, so the answer can never say "valid as of now" about a moment
 * other than the one it was asked about. No caller check beyond
 * authentication: the annotation is is_skip_authorization because the
 * banner this feeds is for every signed-in person, and the handler adds
 * none (the RPC comment states it).
 */
async function getLicenseStatus(
  deps: PlatformControllerDeps,
): Promise<GetLicenseStatusOutput> {
  const now = deps.now();
  const report = await deps.licenseStatus.status(now);
  const output = create(GetLicenseStatusOutputSchema, {
    state: report.state,
    checkedAt: timestampFromDate(now),
  });
  switch (report.state) {
    case LicenseState.absent:
      return output;
    case LicenseState.invalid:
      output.keyId = report.keyId;
      return output;
    case LicenseState.valid:
    case LicenseState.expiring:
    case LicenseState.grace:
    case LicenseState.expired:
      output.keyId = report.keyId;
      output.claims = report.claims;
      return output;
    default: {
      const exhaustive: never = report;
      throw new Error(
        `unhandled license report: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * Go GetRunnerBootstrapConfig: the Temporal coordinates an embedded runner
 * should connect to so it can self-bootstrap from a token alone. The
 * RunnerAccessToken / TokenType / RunnerAccessTokenExpiresInSeconds fields
 * are intentionally left empty in OSS: minting an iss=stigmer proxy token
 * is a cloud-only capability (OSS has no Cursor BiDi proxy to authenticate
 * against), so OSS runners keep using the token they already hold. The
 * suite pins the presence-based all-or-nothing coupling of those fields.
 *
 * A composed provider with the bootstrapCredentials capability populates
 * the token and payload-key fields (module header); the coordinates are
 * OSS-owned either way — they describe THIS deployment's Temporal, not a
 * credential policy. Capability failures degrade to the empty fields and
 * never fail the bootstrap the coordinates ride on (the Java handler's
 * best-effort contract).
 */
async function getRunnerBootstrapConfig(
  deps: PlatformControllerDeps,
  ctx: HandlerContext,
): Promise<GetRunnerBootstrapConfigOutput> {
  const output = create(GetRunnerBootstrapConfigOutputSchema, {
    temporalAddress: deps.temporalHostPort,
    temporalNamespace: deps.temporalNamespace,
  });
  const bootstrapCredentials =
    deps.runnerAuthService.bootstrapCredentials?.bind(deps.runnerAuthService);
  if (bootstrapCredentials === undefined) {
    return output;
  }
  try {
    const credentials = await bootstrapCredentials(callerIdentityOf(ctx));
    if (credentials.accessToken !== undefined) {
      output.runnerAccessToken = credentials.accessToken.token;
      output.tokenType = "Bearer";
      output.runnerAccessTokenExpiresInSeconds =
        credentials.accessToken.expiresInSeconds;
    }
    if (credentials.payloadKeys !== undefined) {
      output.payloadEncryptionKey = credentials.payloadKeys.keyBase64;
      output.payloadEncryptionKeyId = credentials.payloadKeys.keyId;
      output.payloadEncryptionSecondaryKey =
        credentials.payloadKeys.secondaryKeyBase64 ?? "";
      output.payloadEncryptionSecondaryKeyId =
        credentials.payloadKeys.secondaryKeyId ?? "";
    }
  } catch (error) {
    deps.logger.warn(
      "Bootstrap credentials unavailable — answering coordinates without them",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  return output;
}

/**
 * Go GetRunnerScopedToken (oss#535): mints a token scoped to one unit of
 * dispatched work, accepted by the ExecutionContext getByExecutionId
 * decrypt lane.
 *
 * Arms:
 *   - agent_execution_id / workflow_execution_id: minted. Both ids ARE the
 *     ExecutionContext's spec.execution_id, so the token binds directly to
 *     the one EC it may decrypt. (Cloud scopes agent tokens to the parent
 *     session for warm-pool multi-turn reuse; OSS runners exchange
 *     immediately before each read, so the tighter per-execution binding
 *     costs nothing.)
 *   - pool_claim / renewal / unset scope: the presence-based "not minted"
 *     shape — OSS has no warm pool, and per-read minting makes renewal
 *     moot.
 *
 * FAIL-SOFT is the contract: empty id, keyless service, or a mint error
 * all answer the empty output rather than a gRPC error — the runner's
 * no-credential path treats absence as "proceed tokenless", which degrades
 * to redacted values (a clear downstream signal), while an error here
 * would abort the activity.
 *
 * With the exchangeScopedToken capability composed, EVERY arm delegates
 * to the provider (module header): its refusals (wrong credential class,
 * failed authorization) propagate as the gRPC errors it throws — the
 * cloud exchange's contract — while its keyless degrade keeps the
 * presence-based empty output.
 */
async function getRunnerScopedToken(
  deps: PlatformControllerDeps,
  input: GetRunnerScopedTokenInput,
  ctx: HandlerContext,
): Promise<GetRunnerScopedTokenOutput> {
  const exchange = deps.runnerAuthService.exchangeScopedToken?.bind(
    deps.runnerAuthService,
  );
  if (exchange !== undefined) {
    const minted = await exchange(
      exchangeRequestOf(input),
      callerIdentityOf(ctx),
    );
    if (!minted.minted) {
      return create(GetRunnerScopedTokenOutputSchema);
    }
    return create(GetRunnerScopedTokenOutputSchema, {
      runnerScopedToken: minted.token,
      tokenType: "Bearer",
      expiresInSeconds: minted.expiresInSeconds,
    });
  }

  let executionId: string;
  switch (input.scope.case) {
    case "agentExecutionId":
      executionId = input.scope.value;
      break;
    case "workflowExecutionId":
      executionId = input.scope.value;
      break;
    case "poolClaim":
    case "renewal":
    case undefined:
      // pool_claim, renewal, or an unset scope: nothing OSS mints for.
      return create(GetRunnerScopedTokenOutputSchema);
    default: {
      const exhaustive: never = input.scope;
      throw new Error(`unhandled scope arm: ${JSON.stringify(exhaustive)}`);
    }
  }

  if (
    executionId === "" ||
    !deps.runnerAuthService.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)
  ) {
    return create(GetRunnerScopedTokenOutputSchema);
  }

  try {
    const minted = deps.runnerAuthService.mint(
      TOKEN_TYPE_EXECUTION_SCOPED,
      executionId,
      0,
    );
    return create(GetRunnerScopedTokenOutputSchema, {
      runnerScopedToken: minted.token,
      tokenType: "Bearer",
      expiresInSeconds: minted.ttlSeconds,
    });
  } catch (error) {
    deps.logger.warn(
      "failed to mint runner scoped token — answering not-minted",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return create(GetRunnerScopedTokenOutputSchema);
  }
}

/**
 * The proto oneof, transcribed to the seam's domain shape (the provider
 * contract deliberately imports no wire types). Every arm maps
 * one-to-one, INCLUDING unset — the implementation owns the unset
 * refusal (Java answers INVALID_ARGUMENT there), so this mapping must
 * never collapse it into a real arm.
 */
function exchangeRequestOf(
  input: GetRunnerScopedTokenInput,
): RunnerScopedTokenRequest {
  switch (input.scope.case) {
    case "agentExecutionId":
      return { arm: "agent-execution", executionId: input.scope.value };
    case "workflowExecutionId":
      return { arm: "workflow-execution", executionId: input.scope.value };
    case "poolClaim":
      return { arm: "pool-claim", sessionId: input.scope.value.sessionId };
    case "renewal":
      return { arm: "renewal" };
    case undefined:
      return { arm: "unset" };
    default: {
      const exhaustive: never = input.scope;
      throw new Error(`unhandled scope arm: ${JSON.stringify(exhaustive)}`);
    }
  }
}
