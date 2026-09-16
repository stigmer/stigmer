/**
 * The runner-subject identity verifier — the third open-source entry on
 * the chassis's verifier chain, composed under the built-in authorization
 * posture ONLY (boot/compose.ts; authorization/posture.ts), between
 * `apikey` and `oidc`. It admits the bearer of an execution-scoped runner
 * token AS THE HUMAN WHOSE RUN IT IS: the person the execution row's
 * creator stamp names, in the `runner` caller class, for as long as that
 * run lives (runnerauth.ts header: the lane the token gains under this
 * posture; bound-execution.ts: what "lives" means).
 *
 * Why a verifier reads the store: the token is a capability for one
 * execution, not an identity assertion. Its claims name only the
 * execution; the server resolves the person from the row the way the
 * schedule fire caller resolves a schedule's creator (`accountForStamp`:
 * the account id stamped since 3.15.0, the raw issuer subject the 3.14.x
 * verifiers stamped) and mints the account acting as itself
 * (`accountAsRunnerCaller`), so the audit actor on every row the runner
 * writes carries the person's email and display name that no token
 * could. The API-key verifier is the precedent for a store-reading
 * verifier (domain/apikey/verifier.ts: the key row, then the owner's
 * account); this one pays the same two primary-key reads. No cache: a
 * run that ends stops admitting on the very next request.
 *
 * The execution's creator IS the session's owner on every path open
 * source has today. `agent_execution.can_edit` derives from the SESSION's
 * owner, not the execution's stamp, so the person this verifier admits
 * must be the session's owner for the runner to report at all. They
 * coincide because a session's `can_create_execution_in` is its viewers,
 * and in open source a session has no viewer but its owner: the contract
 * lists `viewer` as grantable on a session, but open source's grant scope
 * is organization-only (domain/iampolicy/grant-scope.ts) and the session
 * model derives no organization-wide viewer. A scheduled run is created
 * as the schedule's creator, who owns the session the fire creates. The
 * verifier test pins the grant-scope fact by name; an edition that grants
 * `viewer` on sessions (the cloud does) has the cloud's own credential
 * story, and a change to open source's scope must revisit this sentence.
 *
 * Claim rule: exactly `token_type === "execution_scoped"`, read from the
 * UNTRUSTED payload (`peekTokenType`). Everything else passes — the
 * API-key lane's `stk_`, the OIDC verifier's JWTs, garbage. The ORDER on
 * the chain is the contract, not a detail: the OIDC verifier claims any
 * JWT-shaped token and throws when it cannot verify one, and the server's
 * own HS256 token is JWT-shaped, so composed after `oidc` this verifier
 * would never see its own token; that is precisely what a 3.15.x
 * self-host with sign-in on did (stigmer#1137: every agent execution
 * failed INTERNAL). A token that names our type and fails the HMAC is
 * CLAIMED and refused, never passed to a laxer verifier (the identity.ts
 * contract); an OIDC-issued JWT never carries the claim, so there is no
 * downgrade path.
 *
 * Refusals are UNAUTHENTICATED with exactly two sentences (constants.ts):
 * the token sentence for anything wrong with the credential itself — the
 * HMAC, a present `exp` in the past, a binding that names no execution
 * kind or no row (the run is not the caller's to learn about, so never
 * NOT_FOUND) — and the liveness sentence for a genuine credential whose
 * run is over or was created by nobody this server recognizes. A store
 * fault propagates as the fault it is: the chassis maps it INTERNAL
 * (pipeline/interceptors/auth.ts), so an outage never reads as a bad
 * credential.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import { accountAsRunnerCaller } from "../domain/identityaccount/actor.js";
import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../extensions/identity.js";
import { loadBoundExecution } from "./bound-execution.js";
import type { BoundExecutionStore } from "./bound-execution.js";
import {
  RUNNER_CREDENTIAL_INVALID_MESSAGE,
  RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE,
  RUNNER_VERIFIER_NAME,
} from "./constants.js";
import type { RunnerCredentialProvider } from "./runner-credential-provider.js";
import { peekTokenType, TOKEN_TYPE_EXECUTION_SCOPED } from "./runnerauth.js";

export interface RunnerSubjectVerifierDeps {
  /** Where the executions live — one primary-key read per claimed token. */
  readonly store: BoundExecutionStore;
  /** The account port the creator stamp resolves through (by id, then by subject). */
  readonly accounts: AccountsByCaller;
  /** The provider whose execution_scoped lane signed the token — verification goes through the seam. */
  readonly credentials: Pick<RunnerCredentialProvider, "verify">;
}

export function newRunnerSubjectIdentityVerifier(
  deps: RunnerSubjectVerifierDeps,
): IdentityVerifier {
  return {
    name: RUNNER_VERIFIER_NAME,
    async verify(token: string): Promise<CallerIdentity | null> {
      if (peekTokenType(token) !== TOKEN_TYPE_EXECUTION_SCOPED) {
        return null;
      }
      let executionId: string;
      try {
        executionId = deps.credentials.verify(
          TOKEN_TYPE_EXECUTION_SCOPED,
          token,
        );
      } catch {
        // Every verify failure is the one InvalidTokenError by contract;
        // the sentence on the wire is ours, not the service's.
        throw invalidCredential();
      }
      const execution = await loadBoundExecution(deps.store, executionId);
      if (execution === undefined) {
        throw invalidCredential();
      }
      if (!execution.live) {
        throw notLive();
      }
      const account = await accountForStamp(deps.accounts, execution.createdBy);
      if (account === undefined) {
        throw notLive();
      }
      return accountAsRunnerCaller(account, token);
    },
  };
}

function invalidCredential(): ConnectError {
  return new ConnectError(
    RUNNER_CREDENTIAL_INVALID_MESSAGE,
    Code.Unauthenticated,
  );
}

function notLive(): ConnectError {
  return new ConnectError(
    RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE,
    Code.Unauthenticated,
  );
}
