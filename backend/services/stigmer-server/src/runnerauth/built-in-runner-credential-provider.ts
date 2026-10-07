/**
 * The built-in RunnerCredentialProvider — the open-source execution-scoped
 * default (runner-credential-provider.ts) plus the two capabilities an
 * ENFORCING self-host needs, composed under the built-in authorization
 * posture beside the runner-subject verifier (boot/compose.ts). The
 * cloud's shape, kept on purpose: one provider object carries the
 * edition's whole credential story, so the composition root binds one
 * thing and every OSS touchpoint that consults the seam sees the same
 * policy. Mint, verify, isEnabled and the dispatch's `mintRunCredential`
 * are the default provider's, byte for byte; under trusted-local the
 * default alone is composed and none of what follows exists.
 *
 * ONE reading of "what is this runner bound to" — `runnerBindingOf` —
 * feeds everything here. It re-verifies the caller's own
 * `rawToken` (the cloud's `verifiedClaims(caller.rawToken)` pattern: one
 * HMAC, no store read) and reads the kind off the bound id's prefix
 * through the contract's table (bound-execution.ts). It checks the
 * caller CLASS first: only the runner-subject verifier mints `runner`,
 * so a person costs nothing here. It never throws: a person, a runner
 * holding no token, a token this server did not sign, or a binding that
 * names no kind is simply "not a runner binding", and each caller
 * answers its own default for that. A CONNECT binding (`mcp-connect`, a
 * runner reading one discovery's secrets as the person who asked) IS a
 * runner binding, and every capability below answers it by name: it
 * captures no memory, and the exchange mints nothing for it.
 *
 * The capabilities, and where they follow or narrow the cloud:
 *
 *   - `authorizeMemoryCapture`: an AGENT-bound runner is ADMITTED with the
 *     human the verifier resolved as the memory's subject — the row's one
 *     principal under the model; without it every memory an enforcing
 *     self-host writes belongs to nobody — and the run's session as the
 *     proved provenance. The cloud reads both off its session-scoped
 *     token; our token names only the execution, so this reads the row
 *     (one primary-key read per `remember` call) and the seam allows the
 *     promise. The cloud's org arm is kept: a capture addressed to an org
 *     that is not the run's is "a forged address, not a routing choice"
 *     (its byte-pinned copy). A connect-bound runner is refused (the
 *     cloud refuses every non-session lane); a person, or a runner whose
 *     token does not verify, is no-opinion and the gate's own logic
 *     applies. A run that has vanished between the verifier's read and
 *     this one is refused: a memory the server cannot attribute to a run
 *     must not be written as nobody's (fail closed).
 *   - `exchangeScopedToken`: the platform exchange (getRunnerScopedToken)
 *     becomes a MINT GATE. Under trusted-local the controller's own arms
 *     mint a clocked decrypt-lane token for any caller naming an
 *     execution, and that is harmless — the token unlocks a decrypt lane
 *     and nothing more. Under this posture the same token IS an identity
 *     (the verifier admits its bearer as the run's human), so minting
 *     one for another person's run would be impersonation. The execution
 *     arm therefore mints only for the run's own person — the account
 *     the row's creator stamp resolves to, the same reading the verifier
 *     makes — and mint the RUN credential (no `exp`; `expires_in_seconds`
 *     0, the proto default), so under the posture there is one credential
 *     shape and the exchange is the runner's true fallback for a dispatch
 *     that carried none. The ladder is the platform's own: a row that
 *     does not exist → NOT_FOUND with the load-first copy (what a `get`
 *     on that id answers), a caller who is not the run's person, or a run
 *     whose stamp names nobody → PERMISSION_DENIED with one sentence
 *     (constants.ts), and a caller bound to another organization than the
 *     run's → PERMISSION_DENIED with the binding's sentence
 *     (authorization/credential-binding.ts; the credential it would mint
 *     is bound to the run's organization, runner-subject-verifier.ts). The
 *     id decides which execution kind is read (the lane's rule
 *     everywhere); an id that resolves to a CONNECT binding is NOT_FOUND
 *     too, because the exchange mints run credentials and a connect is
 *     not a run. Liveness is NOT judged at mint — both lanes that
 *     accept the token judge it, by one rule (bound-execution.ts), and a
 *     third judge here would be a divergence waiting to happen. The
 *     pool-claim, renewal and unset arms answer not-minted, the
 *     controller's arms verbatim; keyless answers not-minted too.
 *
 * Deliberately UNDEFINED here: `bootstrapCredentials`,
 * `mintSandboxCredential`, `authorizeExecutionContextRead`,
 * `resolvePayloadKey`. Their open-source arms stay where they are (the
 * sandbox lane's mint, the decrypt lane's binding-equality decision);
 * this provider adds policy an enforcing server lacks and takes over
 * nothing that already works.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import { BOUND_ELSEWHERE_DENY_REASON } from "../authorization/credential-binding.js";
import { boundOrgOf } from "../extensions/identity.js";
import type { CallerIdentity } from "../extensions/identity.js";
import { getKindName } from "../pipeline/apiresource-meta.js";
import { notFoundError } from "../pipeline/errors.js";
import {
  bindsARun,
  boundExecutionKindOf,
  loadBoundExecution,
} from "./bound-execution.js";
import type {
  BoundExecutionKind,
  BoundExecutionStore,
} from "./bound-execution.js";
import {
  MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE,
  RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE,
} from "./constants.js";
import type {
  MemoryCaptureDecision,
  RunnerCredentialProvider,
  RunnerScopedTokenExchange,
  RunnerScopedTokenRequest,
} from "./runner-credential-provider.js";
import { newExecutionScopedRunnerCredentialProvider } from "./runner-credential-provider.js";
import type { RunnerAuthService } from "./runnerauth.js";

/** What a runner-class caller's credential is bound to. */
export interface RunnerBinding {
  readonly kind: BoundExecutionKind;
  readonly executionId: string;
}

export interface BuiltInRunnerCredentialProviderDeps {
  /** The service that signed every token this provider reads. */
  readonly service: RunnerAuthService;
  /** Where the bound executions live — the capture and exchange capabilities' one read each. */
  readonly store: BoundExecutionStore;
  /** Resolves a run's creator stamp to its person — the exchange's owner check, the verifier's reading. */
  readonly accounts: AccountsByCaller;
}

/**
 * The one reading of a runner's binding. `undefined` for anything that
 * is not a runner-class caller holding a token this service signed whose
 * binding names an execution kind; never a throw.
 */
export function runnerBindingOf(
  service: RunnerAuthService,
  caller: CallerIdentity,
): RunnerBinding | undefined {
  if (caller.callerClass !== "runner" || caller.rawToken === "") {
    return undefined;
  }
  let executionId: string;
  try {
    executionId = service.verify(caller.rawToken);
  } catch {
    return undefined;
  }
  const kind = boundExecutionKindOf(executionId);
  return kind === undefined ? undefined : { kind, executionId };
}

export function newBuiltInRunnerCredentialProvider(
  deps: BuiltInRunnerCredentialProviderDeps,
): RunnerCredentialProvider {
  const { service, store, accounts } = deps;
  const lane = newExecutionScopedRunnerCredentialProvider(service);
  const mintRunCredential = lane.mintRunCredential!.bind(lane);
  return {
    isEnabled: lane.isEnabled,
    mint: lane.mint,
    verify: lane.verify,
    mintRunCredential,

    async exchangeScopedToken(
      request: RunnerScopedTokenRequest,
      caller: CallerIdentity,
    ): Promise<RunnerScopedTokenExchange> {
      switch (request.arm) {
        case "agent-execution": {
          if (request.executionId === "" || !service.isEnabled()) {
            return { minted: false };
          }
          const execution = await loadBoundExecution(
            store,
            request.executionId,
          );
          // A connect binding is not a run: the exchange mints RUN
          // credentials, and the requested kind's row does not exist.
          if (execution === undefined || !bindsARun(execution.kind)) {
            throw notFoundError(
              getKindName(ApiResourceKind.run),
              request.executionId,
            );
          }
          const person = await accountForStamp(accounts, execution.createdBy);
          if (
            person === undefined ||
            person.metadata?.id !== caller.identityId
          ) {
            throw new ConnectError(
              RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE,
              Code.PermissionDenied,
            );
          }
          // A credential bound to one organization swaps itself only for
          // a run in that organization; the credential it would mint
          // works in the run's.
          const bound = boundOrgOf(caller);
          if (bound !== undefined && bound !== execution.org) {
            throw new ConnectError(
              BOUND_ELSEWHERE_DENY_REASON,
              Code.PermissionDenied,
            );
          }
          return {
            minted: true,
            token: mintRunCredential(execution.executionId),
            // No `exp` on a run credential; 0 is the proto default and
            // the runner's acquire sites read no expiry from it.
            expiresInSeconds: 0,
          };
        }
        case "pool-claim":
        case "renewal":
        case "unset":
          return { minted: false };
        default: {
          const exhaustive: never = request;
          throw new Error(
            `unhandled exchange arm: ${JSON.stringify(exhaustive)}`,
          );
        }
      }
    },

    async authorizeMemoryCapture(
      caller: CallerIdentity,
      captureOrg: string,
    ): Promise<MemoryCaptureDecision> {
      const binding = runnerBindingOf(service, caller);
      if (binding === undefined) {
        return { verdict: "no-opinion" };
      }
      if (binding.kind !== "agent-execution") {
        return { verdict: "refuse" };
      }
      const execution = await loadBoundExecution(store, binding.executionId);
      if (execution === undefined) {
        return { verdict: "refuse" };
      }
      if (captureOrg !== "" && captureOrg !== execution.org) {
        throw new ConnectError(
          MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE,
          Code.PermissionDenied,
        );
      }
      return {
        verdict: "admit",
        subjectIdentityAccountId: caller.identityId,
        provedSessionId: execution.sessionId,
      };
    },
  };
}
