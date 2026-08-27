/**
 * Platform controller — ports pkg/domain/platform: the server's
 * self-description surface (NOT a resource domain — no store, no
 * pipelines; three direct handlers on PlatformQueryController).
 *
 * Proven by platform.conformance.test.ts (getServerInfo +
 * getRunnerBootstrapConfig shapes; getRunnerScopedToken is deliberately
 * excluded there — its arms are exercised mid-execution) and
 * __tests__/platform.test.ts (the fail-soft mint matrix, the #15
 * composed-server pattern).
 *
 * getRunnerScopedToken is the mint side of the runner-token lane
 * (oss#535) — the seam src/runnerauth/ reserved for this sub-project. OSS
 * has no caller identity, so unlike the cloud exchange there is no
 * credential to verify: any caller naming an execution receives a token
 * for it. On a single-user server the token is the LANE DISCRIMINATOR that
 * lets the EC read RPCs redact by default without breaking the runner, not
 * a trust boundary (DD-004).
 *
 * The C4 capability delegation (20260827.09, gate ruling Q1): when the
 * composed provider defines exchangeScopedToken / bootstrapCredentials,
 * this controller delegates the exchange arms and the bootstrap
 * credential fields to it wholesale — the cloud's per-arm caller-class
 * gating, row authorization, and multi-lane minting are POLICY, not
 * contract, and live behind the seam. With neither defined (the OSS
 * default), every arm below behaves exactly as before; the conformance
 * suites pin that byte-identity.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import {
  GetRunnerBootstrapConfigOutputSchema,
  GetRunnerScopedTokenOutputSchema,
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type {
  GetRunnerBootstrapConfigOutput,
  GetRunnerScopedTokenInput,
  GetRunnerScopedTokenOutput,
  GetServerInfoOutput,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { Logger } from "../../boot/logger.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import type {
  RunnerCredentialProvider,
  RunnerScopedTokenRequest,
} from "../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../runnerauth/runnerauth.js";
import { SERVER_VERSION } from "./version.js";

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
  readonly logger: Logger;
}

/** Registers the platform query service on the router (routes stage). */
export function registerPlatformServices(
  router: ConnectRouter,
  deps: PlatformControllerDeps,
): void {
  router.service(PlatformQueryController, {
    getServerInfo: () => getServerInfo(deps),
    getRunnerBootstrapConfig: (_input, ctx) =>
      getRunnerBootstrapConfig(deps, ctx),
    getRunnerScopedToken: (input, ctx) =>
      getRunnerScopedToken(deps, input, ctx),
  });
}

/** Go GetServerInfo: the server edition and build version. */
function getServerInfo(deps: PlatformControllerDeps): GetServerInfoOutput {
  return create(GetServerInfoOutputSchema, {
    edition: deps.edition,
    version: SERVER_VERSION,
  });
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
