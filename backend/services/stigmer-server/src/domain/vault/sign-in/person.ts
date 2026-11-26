/**
 * A person's sign-in at an address: `VaultCommandController.startSignIn`,
 * `handBackSignIn` and `completeSignIn`. The login is the signer's to
 * place: it lands in the vault the start named, their own My vault (created
 * on this first save) or a shared vault of the organization they may edit
 * (`authorizeSignInVault`, asked at start and again at completion, since a
 * grant can be revoked in between).
 *
 * The login page's answer reaches Stigmer, not the app that started the
 * sign-in: the console's callback page hands it back (`handBackSignIn`,
 * public, the state its only authority), and the signer's own app or
 * terminal collects it by asking `completeSignIn` with no code, under its
 * own session. So a sign-in finishes whatever address the app lives on and
 * whichever login page cuts the window off from its opener, and the page
 * that receives the answer never needs the signer's session. A page of the
 * app's own that receives the code itself (the desktop app's) still
 * completes with the code.
 *
 * The pending state records who started it, and only that caller may finish
 * it: completion checks the signer before anything spends the state, so a
 * state in someone else's hands neither saves into their vault nor burns
 * the signer's sign-in, and the provider's code is never spent on a caller
 * who may not finish. A sign-in has one answer: a second hand-back, or a
 * code passed after one, is refused. A sign-in a Connect link started is
 * not a person's: its own public completion finishes it (connect-link.ts).
 *
 * Proven by __tests__/person.test.ts and the sign-in conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import {
  CompleteSignInOutputSchema,
  HandBackSignInOutputSchema,
  SignInReturn as SignInReturnChoice,
  StartSignInOutputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import type {
  CompleteSignInInput,
  CompleteSignInOutput,
  HandBackSignInInput,
  HandBackSignInOutput,
  StartSignInInput,
  StartSignInOutput,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../../pipeline/errors.js";
import { authorizeResolvedResource } from "../../../pipeline/steps/authorize.js";
import type { OrganizationAdmission } from "../../../pipeline/steps/refuse-bound-elsewhere.js";
import { refuseBoundElsewhere } from "../../../pipeline/steps/refuse-bound-elsewhere.js";
import { EncryptionScope } from "../../../encryption/encryption.js";
import type { PendingSignInAnswer, StoredPendingOAuthState } from "../../../store/interface.js";
import { MY_VAULT_MEMBERS_ONLY } from "../constants.js";
import type { VaultService } from "../service.js";
import { finishSignIn } from "./complete.js";
import { startSignIn } from "./start.js";
import type { SignInDeps, SignInReturn } from "./start.js";

/** What a person's sign-in needs beyond the shared start and completion. */
export interface PersonSignInDeps extends SignInDeps {
  readonly vaults: VaultService;
  readonly authorizer: Authorizer;
  /** The composed credential binding: a login lands only in an organization the credential reaches. */
  readonly credentialBinding: OrganizationAdmission;
}

export async function startPersonSignIn(
  deps: PersonSignInDeps,
  input: StartSignInInput,
  caller: CallerIdentity,
): Promise<StartSignInOutput> {
  // The pending state names its signer, and completion admits only that
  // caller: a state recorded with no signer would be nobody's to finish.
  if (caller.identityId === "") {
    throw new ConnectError(
      "a sign-in is saved for a signed-in caller: sign in to Stigmer first",
      Code.Unauthenticated,
    );
  }
  const org = input.vault?.org ?? "";
  const which = input.vault?.vault;
  const vaultId = which?.case === "id" ? which.value : "";
  // The login lands in this organization's vault.
  await refuseBoundElsewhere(deps.credentialBinding, caller, org);
  await authorizeSignInVault(deps, org, vaultId, caller);

  const started = await startSignIn(deps, {
    org,
    vaultId,
    address: input.address,
    returnTo: returnChoice(input),
    signer: caller.identityId,
    connectLink: "",
  });
  return create(StartSignInOutputSchema, {
    authorizationUrl: started.authorizationUrl,
    state: started.state,
    providerName: started.providerName,
    scopes: [...started.scopes],
  });
}

export async function completePersonSignIn(
  deps: PersonSignInDeps,
  input: CompleteSignInInput,
  caller: CallerIdentity,
): Promise<CompleteSignInOutput> {
  // Read, not taken: nothing spends the state before its signer is known.
  const found = await readPending(() => deps.pendingOAuthStates.find(input.state));
  if (found === undefined) {
    throw spentSignIn();
  }
  refuseAllButSigner(found, caller);
  const asked = settle(found, input.code);
  if (asked.kind === "pending") {
    // A wait's ask: one read and the signer check, no authorizer call.
    return create(CompleteSignInOutputSchema, { pending: true });
  }
  if (asked.kind === "conflict") {
    // Left open: the signer can still collect the answer that is there.
    throw alreadyAnswered();
  }
  if (asked.kind === "refused") {
    await readPending(() => deps.pendingOAuthStates.getAndDelete(input.state));
    throw loginPageRefusal(asked.reason);
  }

  await refuseBoundElsewhere(deps.credentialBinding, caller, found.org);
  // Settled before the take and the exchange: a refused completion leaves
  // the sign-in open and no live token minted at the provider. A signer's
  // first sign-in creates their My vault here, so an exchange that then
  // fails leaves it, empty.
  const shared = await authorizeSignInVault(deps, found.org, found.vaultId, caller);
  const target = shared ?? (await deps.vaults.ensureMine(found.org, caller));

  // The take is atomic: of two completions racing, one exchanges. What it
  // took decides, since an answer may have been handed back since the read.
  const pending = await readPending(() => deps.pendingOAuthStates.getAndDelete(input.state));
  if (pending === undefined) {
    throw spentSignIn();
  }
  const taken = settle(pending, input.code);
  if (taken.kind === "refused") {
    throw loginPageRefusal(taken.reason);
  }
  if (taken.kind !== "code") {
    // A hand-back that raced a completion carrying its own code, or (never,
    // since an answer is never cleared) an answer gone since the read.
    throw alreadyAnswered();
  }
  const code = taken.sealed ? await unsealAnswerCode(deps, pending, taken.code) : taken.code;

  const finished = await finishSignIn(deps, pending, code, target, caller);
  return create(CompleteSignInOutputSchema, {
    address: finished.address,
    description: finished.description,
  });
}

/**
 * Records what the login page answered a person's sign-in, for the signer
 * to collect. Public: the state is the authority, as a Connect link's
 * secret is for its page. Reads no credential and exchanges nothing; the
 * code rests sealed under the sign-in's organization, as the row's other
 * secrets do. An unknown, expired or already answered sign-in answers the
 * same refusal, so the method tells a guesser nothing.
 */
export async function handBackSignIn(
  deps: Pick<SignInDeps, "pendingOAuthStates" | "secretService" | "logger">,
  input: HandBackSignInInput,
): Promise<HandBackSignInOutput> {
  const found = await readPending(() => deps.pendingOAuthStates.find(input.state));
  if (found === undefined || found.answer !== undefined) {
    throw spentSignIn();
  }
  if (found.connectLink !== "") {
    throw connectLinksOwnPage();
  }
  const answer: PendingSignInAnswer =
    input.code !== ""
      ? { kind: "code", code: await sealAnswerCode(deps, found.org, input.code) }
      : { kind: "refused", reason: input.errorDescription !== "" ? input.errorDescription : input.error };
  let recorded: boolean;
  try {
    recorded = await deps.pendingOAuthStates.recordAnswer(input.state, answer);
  } catch (error) {
    throw internalError(error, "failed to record the sign-in's answer");
  }
  if (!recorded) {
    throw spentSignIn();
  }
  deps.logger.info("Sign-in answer handed back", {
    address: found.address,
    refused: answer.kind === "refused",
  });
  return create(HandBackSignInOutputSchema, {
    providerName: found.providerName,
    address: found.address,
  });
}

/** What a completion does with a sign-in, from its row and the code it was given. */
type Settled =
  | { readonly kind: "pending" }
  | { readonly kind: "code"; readonly code: string; readonly sealed: boolean }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "conflict" };

function settle(row: StoredPendingOAuthState, givenCode: string): Settled {
  const answer = row.answer;
  if (givenCode !== "") {
    // One sign-in, one answer: a code of the caller's own finishes only a
    // sign-in nothing was handed back for.
    return answer === undefined ? { kind: "code", code: givenCode, sealed: false } : { kind: "conflict" };
  }
  if (answer === undefined) {
    return { kind: "pending" };
  }
  switch (answer.kind) {
    case "code":
      return { kind: "code", code: answer.code, sealed: true };
    case "refused":
      return { kind: "refused", reason: answer.reason };
    default: {
      const unknown: never = answer;
      throw new Error(`unknown sign-in answer: ${JSON.stringify(unknown)}`);
    }
  }
}

/** Refuses a Connect link's sign-in and any caller but the one who started it. */
function refuseAllButSigner(row: StoredPendingOAuthState, caller: CallerIdentity): void {
  if (row.connectLink !== "") {
    throw connectLinksOwnPage();
  }
  if (row.identityAccountId === "" || row.identityAccountId !== caller.identityId) {
    throw failedPreconditionError(
      "this sign-in was started by another account; start it again from your own session",
    );
  }
}

/** A store read of a pending sign-in, its fault answered as one. */
async function readPending<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw internalError(error, "failed to load pending OAuth state");
  }
}

function spentSignIn(): Error {
  return failedPreconditionError("this sign-in has expired or was already used: start it again");
}

function connectLinksOwnPage(): Error {
  return failedPreconditionError(
    "this sign-in was started by a Connect link: it finishes on the link's own page",
  );
}

function alreadyAnswered(): Error {
  return failedPreconditionError(
    "this sign-in already has the login page's answer: finish it without a code",
  );
}

/** The login page's refusal, in its words, as the completion's failure. */
function loginPageRefusal(reason: string): Error {
  return failedPreconditionError(
    `The login page did not sign you in${reason === "" ? "" : `: ${reason}`}. Nothing was saved`,
  );
}

/**
 * Seals the handed-back code under the sign-in's organization before it
 * rests, as `sealPendingOAuthState` seals the row's other secrets, and with
 * the same posture: plaintext only when the deployment has no key, and a
 * failed seal fails the hand-back rather than rest the code in the clear.
 */
async function sealAnswerCode(
  deps: Pick<SignInDeps, "secretService" | "logger">,
  org: string,
  code: string,
): Promise<string> {
  if (!deps.secretService.isEnabled()) {
    deps.logger.warn("Encryption disabled: a handed-back sign-in code will be stored in plaintext");
    return code;
  }
  try {
    return await deps.secretService.encrypt(code, EncryptionScope.forOrganization(org));
  } catch (error) {
    throw internalError(error, "failed to encrypt the sign-in's code");
  }
}

/** Opens the sealed code at its only use. The row is taken, so a failure costs the person one new start. */
async function unsealAnswerCode(
  deps: Pick<SignInDeps, "secretService" | "logger">,
  pending: StoredPendingOAuthState,
  sealed: string,
): Promise<string> {
  try {
    return await deps.secretService.decrypt(sealed);
  } catch (error) {
    deps.logger.error("Failed to decrypt a handed-back sign-in code", {
      address: pending.address,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to decrypt the sign-in's code — please sign in again");
  }
}

/**
 * The vault a sign-in saves into must be one the caller may change: their
 * own My vault (empty id; created on the first save), or a vault of the
 * request's organization they hold can_edit on. A vault of another
 * organization answers NOT_FOUND, as a missing one does. Answers the shared
 * vault it checked, or undefined for My vault.
 */
export async function authorizeSignInVault(
  deps: Pick<PersonSignInDeps, "vaults" | "authorizer">,
  org: string,
  vaultId: string,
  identity: CallerIdentity,
): Promise<Vault | undefined> {
  if (vaultId === "") {
    await authorizeResolvedResource(
      deps.authorizer,
      identity,
      {
        permission: IamPermission.can_create_vault,
        resourceKind: ApiResourceKind.organization,
        resourceId: org,
      },
      MY_VAULT_MEMBERS_ONLY,
    );
    return undefined;
  }
  const vault = await deps.vaults.findById(vaultId);
  if (vault === undefined || (vault.metadata?.org ?? "") !== org) {
    throw notFoundError("vault", vaultId);
  }
  await authorizeResolvedResource(
    deps.authorizer,
    identity,
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.vault,
      resourceId: vaultId,
    },
    "unauthorized to save a sign-in in this vault",
  );
  return vault;
}

function returnChoice(input: StartSignInInput): SignInReturn {
  switch (input.returnTo) {
    case SignInReturnChoice.desktop:
      return { kind: "desktop" };
    case SignInReturnChoice.loopback:
      return { kind: "loopback", port: input.loopbackPort };
    default:
      return { kind: "web" };
  }
}
