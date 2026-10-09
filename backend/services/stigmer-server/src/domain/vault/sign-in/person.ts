/**
 * A person's sign-in at an address: `VaultCommandController.startSignIn`
 * and `completeSignIn`. The login is the signer's to place: it lands in the
 * vault the start named, their own My vault (created on this first save) or
 * a shared vault of the organization they may edit (`authorizeSignInVault`,
 * asked at start and again at completion, since a grant can be revoked in
 * between). The pending state records who started it, and only that caller
 * may finish it, so a state handed to someone else never saves into their
 * vault and the provider's code is never spent on a caller who may not
 * finish. A sign-in a Connect link started is not a person's: its own
 * public completion finishes it (connect-link.ts).
 *
 * Proven by __tests__/person.test.ts and the sign-in conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  CompleteSignInOutputSchema,
  SignInReturn as SignInReturnChoice,
  StartSignInOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type {
  CompleteSignInInput,
  CompleteSignInOutput,
  StartSignInInput,
  StartSignInOutput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../../pipeline/errors.js";
import { authorizeResolvedResource } from "../../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../../pipeline/steps/refuse-bound-elsewhere.js";
import type { PendingOAuthState } from "../../../store/interface.js";
import type { VaultService } from "../service.js";
import { finishSignIn } from "./complete.js";
import { startSignIn } from "./start.js";
import type { SignInDeps, SignInReturn } from "./start.js";

/** What a person's sign-in needs beyond the shared start and completion. */
export interface PersonSignInDeps extends SignInDeps {
  readonly vaults: VaultService;
  readonly authorizer: Authorizer;
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
  refuseBoundElsewhere(caller, org);
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
  let pending: PendingOAuthState | undefined;
  try {
    pending = await deps.pendingOAuthStates.getAndDelete(input.state);
  } catch (error) {
    throw internalError(error, "failed to load pending OAuth state");
  }
  if (pending === undefined) {
    throw failedPreconditionError(
      "this sign-in has expired or was already used: start it again",
    );
  }
  if (pending.connectLink !== "") {
    throw failedPreconditionError(
      "this sign-in was started by a Connect link: it finishes on the link's own page",
    );
  }
  if (pending.identityAccountId === "" || pending.identityAccountId !== caller.identityId) {
    throw failedPreconditionError(
      "this sign-in was started by another account; start it again from your own session",
    );
  }
  refuseBoundElsewhere(caller, pending.org);
  // Settled before the exchange: a refused completion leaves no live token
  // minted at the provider. A signer's first sign-in creates their My vault
  // here, so an exchange that then fails leaves it, empty.
  const shared = await authorizeSignInVault(deps, pending.org, pending.vaultId, caller);
  const target = shared ?? (await deps.vaults.ensureMine(pending.org, caller));

  const finished = await finishSignIn(deps, pending, input.code, target, caller);
  return create(CompleteSignInOutputSchema, {
    address: finished.address,
    description: finished.description,
  });
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
      "unauthorized to keep a My vault in this organization: only its members do",
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
