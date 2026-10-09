/**
 * Connect links: a one-time page an integrator sends its customer, where
 * the customer signs in at an address and the login is saved into the
 * integrator's vault for that customer, with no Stigmer account involved.
 *
 * `createConnectLink` (VaultCommandController, can_edit on the vault) makes
 * one: a shared vault only (My vault is its person's own, and a link is for
 * someone else), an address something can sign in to (a login app, or a
 * login server it leads to that gives Stigmer a client, asked without
 * registering anything, so a link never sends a customer to a dead end), and
 * a return URL that is an absolute https URL (http only for this machine)
 * with no credentials in it. The link lives 30 minutes unless asked
 * otherwise, a day at most. Its secret is 32 random bytes; only its SHA-256
 * is stored, as a platform client's secret is
 * (domain/platformclient/credentials.ts).
 *
 * `ConnectLinkController` serves the page, every method public with the
 * link's secret as the authority (the share link's `getSharedProfile`
 * precedent), kept in its own service so the anonymous surface is one file
 * to audit. An unknown, expired or used link answers NOT_FOUND, the same for
 * all three. The link's creator must still be able to edit the vault when
 * the link starts and when it completes, as an invitation's creator's
 * standing is re-checked when it is redeemed. The sign-in itself is the
 * shared start and completion (sign-in/start.ts, sign-in/complete.ts), its
 * pending state bound to the link and to no signer; the person door refuses
 * such a state, and this door refuses any state that is not its link's.
 *
 * Completion spends the link before the code is exchanged (record before
 * grant, as an invitation is marked redeemed before its grant is written),
 * so two completions racing save at most one login; a sign-in that then
 * fails makes the link usable again, since nothing was saved. The saved
 * login's `saved_by` is the link's creator. Once the login page has been
 * shown, the customer is sent back to the return URL whatever happens, with
 * `stigmer_connect=connected` or `stigmer_connect=error&reason=...`.
 *
 * Proven by __tests__/connect-link.test.ts and the sign-in conformance suite.
 */
import { createHash, randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  CompleteConnectLinkOutputSchema,
  ConnectLinkInfoSchema,
  StartConnectLinkOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import type {
  CompleteConnectLinkInput,
  CompleteConnectLinkOutput,
  ConnectLinkInfo,
  ConnectLinkTokenInput,
  StartConnectLinkOutput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { ConnectLinkSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type {
  ConnectLink,
  CreateConnectLinkInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ConnectLinkRecord, ConnectLinkStore, PendingOAuthState } from "../../store/interface.js";
import { findLoginAppName } from "./login-app.js";
import { isMyVault } from "./service.js";
import type { VaultService } from "./service.js";
import { finishSignIn } from "./sign-in/complete.js";
import {
  hostOf,
  noLoginRefusal,
  signInAddress,
  signInAvailable,
  startSignIn,
} from "./sign-in/start.js";
import type { SignInDeps } from "./sign-in/start.js";

/** How long a link lives when its maker does not say: 30 minutes. */
export const CONNECT_LINK_DEFAULT_LIFETIME_SECONDS = 30 * 60;

/** The console page a link opens, before the link's secret. */
export const CONNECT_LINK_PAGE_PATH = "/connect/";

/** The query parameter the return URL carries the outcome in. */
export const CONNECT_OUTCOME_PARAM = "stigmer_connect";

/** Why a link's sign-in did not save, as the return URL says it. */
export type ConnectLinkFailure = "denied" | "provider_error" | "expired" | "failed" | "not_allowed";

/** What a Connect link needs from the composition. */
export interface ConnectLinkDeps extends SignInDeps {
  readonly vaults: VaultService;
  readonly authorizer: Authorizer;
  readonly connectLinks: ConnectLinkStore;
}

/** Makes a Connect link; the caller's can_edit on the vault was asked by the annotation. */
export async function createConnectLink(
  deps: ConnectLinkDeps,
  input: CreateConnectLinkInput,
  caller: CallerIdentity,
): Promise<ConnectLink> {
  if (caller.identityId === "") {
    throw new ConnectError("a Connect link is made by a signed-in caller", Code.Unauthenticated);
  }
  refuseBoundElsewhere(caller, input.org);
  const vault = await deps.vaults.findById(input.vaultId);
  if (vault === undefined || (vault.metadata?.org ?? "") !== input.org) {
    throw notFoundError("vault", input.vaultId);
  }
  if (isMyVault(vault)) {
    throw failedPreconditionError(
      "a Connect link saves into a shared vault: My vault is its person's own, and a link is for someone else",
    );
  }
  const address = signInAddress(input.address);
  const returnUrl = checkedReturnUrl(input.returnUrl);
  const available = await signInAvailable(deps, input.org, address);
  if (!available.available) {
    throw noLoginRefusal(address, available.why);
  }
  const pageOrigin = consolePageOrigin(deps.oauthRedirectUri);

  const now = nowSeconds();
  const lifetime =
    input.expiresInSeconds > 0 ? input.expiresInSeconds : CONNECT_LINK_DEFAULT_LIFETIME_SECONDS;
  const token = randomBytes(32).toString("base64url");
  const record: ConnectLinkRecord = {
    tokenHash: hashLinkToken(token),
    org: input.org,
    vaultId: input.vaultId,
    address,
    returnUrl,
    createdBy: caller.identityId,
    createdAt: now,
    expiresAt: now + lifetime,
    usedAt: 0,
  };
  // Links expire unused more often than they are spent; each new one
  // sweeps the dead ones (nothing else reads them).
  await deps.connectLinks.deleteExpired(now);
  await deps.connectLinks.create(record);
  deps.logger.info("Connect link created", {
    org: input.org,
    vault: input.vaultId,
    address,
    expires_at: record.expiresAt,
  });
  return create(ConnectLinkSchema, {
    url: `${pageOrigin}${CONNECT_LINK_PAGE_PATH}${token}`,
    expiresAt: timestampFromMs(record.expiresAt * 1000),
  });
}

/** What a link is for. Public: the link's secret is the authority. */
export async function getConnectLink(
  deps: ConnectLinkDeps,
  input: ConnectLinkTokenInput,
): Promise<ConnectLinkInfo> {
  const link = await usableLink(deps, input.token);
  const name = await findLoginAppName(deps, link.org, link.address);
  return create(ConnectLinkInfoSchema, {
    providerName: name ?? hostOf(link.address),
    address: link.address,
    organizationName: await organizationName(deps, link.org),
  });
}

/** Starts a link's sign-in. Public: the link's secret is the authority. */
export async function startConnectLink(
  deps: ConnectLinkDeps,
  input: ConnectLinkTokenInput,
): Promise<StartConnectLinkOutput> {
  const link = await usableLink(deps, input.token);
  if ((await linkVault(deps, link)) === undefined) {
    throw unknownLink();
  }
  const started = await startSignIn(deps, {
    org: link.org,
    vaultId: link.vaultId,
    address: link.address,
    returnTo: { kind: "web" },
    signer: "",
    connectLink: link.tokenHash,
  });
  return create(StartConnectLinkOutputSchema, {
    authorizationUrl: started.authorizationUrl,
    state: started.state,
  });
}

/**
 * Finishes a link's sign-in and spends the link. Public: the link's secret
 * is the authority, and the state must be the one this link started.
 */
export async function completeConnectLink(
  deps: ConnectLinkDeps,
  input: CompleteConnectLinkInput,
): Promise<CompleteConnectLinkOutput> {
  const link = await usableLink(deps, input.token);
  const pending = input.state === "" ? undefined : await consume(deps, input.state);
  if (pending !== undefined && pending.connectLink !== link.tokenHash) {
    throw failedPreconditionError("this sign-in was not started by this Connect link");
  }
  if (input.error !== "") {
    return outcome(link, input.error === "access_denied" ? "denied" : "provider_error");
  }
  if (pending === undefined) {
    return outcome(link, "expired");
  }
  const vault = await linkVault(deps, link);
  if (vault === undefined) {
    return outcome(link, "not_allowed");
  }

  const spentAt = nowSeconds();
  if (!(await deps.connectLinks.spend(link.tokenHash, spentAt))) {
    throw unknownLink();
  }
  try {
    await finishSignIn(deps, pending, input.code, vault, creatorOf(link));
  } catch (error) {
    await deps.connectLinks.restore(link.tokenHash, spentAt);
    deps.logger.warn("A Connect link's sign-in failed after the login page; the link stays usable", {
      org: link.org,
      vault: link.vaultId,
      address: link.address,
      error: error instanceof Error ? error.message : String(error),
    });
    return outcome(link, "failed");
  }
  return outcome(link, undefined);
}

/** The base64url SHA-256 a link is stored and found by. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * The return URL, checked: absolute, https (http only for localhost,
 * 127.0.0.1 or [::1]), and no user name or password in it. The rule is said
 * without repeating the value.
 */
export function checkedReturnUrl(input: string): string {
  if (!URL.canParse(input)) {
    throw invalidArgumentError("return_url must be an absolute https URL");
  }
  const url = new URL(input);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw invalidArgumentError(
      "return_url must be an https URL (http only for localhost or 127.0.0.1)",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw invalidArgumentError("return_url must not carry a user name or password");
  }
  return url.href;
}

/** The return URL with the outcome added: connected, or an error and its reason. */
function outcome(link: ConnectLinkRecord, failure: ConnectLinkFailure | undefined): CompleteConnectLinkOutput {
  const url = new URL(link.returnUrl);
  url.searchParams.set(CONNECT_OUTCOME_PARAM, failure === undefined ? "connected" : "error");
  if (failure !== undefined) {
    url.searchParams.set("reason", failure);
  }
  return create(CompleteConnectLinkOutputSchema, { returnUrl: url.href });
}

/** The link behind a secret, usable now, or NOT_FOUND. */
async function usableLink(deps: ConnectLinkDeps, token: string): Promise<ConnectLinkRecord> {
  const link = await deps.connectLinks.findUsable(hashLinkToken(token), nowSeconds());
  if (link === undefined) {
    throw unknownLink();
  }
  return link;
}

/** The same answer for an unknown, an expired and a used link. */
function unknownLink(): ConnectError {
  return new ConnectError("Connect link not found: it has expired or was already used", Code.NotFound);
}

/**
 * The link's vault, while it is still in the link's organization and the
 * link's creator may still edit it; undefined otherwise.
 */
async function linkVault(deps: ConnectLinkDeps, link: ConnectLinkRecord): Promise<Vault | undefined> {
  const vault = await deps.vaults.findById(link.vaultId);
  if (vault === undefined || (vault.metadata?.org ?? "") !== link.org) {
    return undefined;
  }
  const decision = await deps.authorizer.authorize(creatorOf(link), {
    permission: IamPermission.can_edit,
    resourceKind: ApiResourceKind.vault,
    resourceId: link.vaultId,
  });
  if (decision.kind === "unavailable") {
    throw internalError(decision.cause, "failed to check the Connect link's maker");
  }
  return decision.kind === "allow" ? vault : undefined;
}

/** The link's creator, as the identity the save and the re-check act as. */
function creatorOf(link: ConnectLinkRecord): CallerIdentity {
  return { identityId: link.createdBy, callerClass: "user", issuer: "", rawToken: "" };
}

async function consume(deps: ConnectLinkDeps, state: string): Promise<PendingOAuthState | undefined> {
  try {
    return await deps.pendingOAuthStates.getAndDelete(state);
  } catch (error) {
    throw internalError(error, "failed to load pending OAuth state");
  }
}

async function organizationName(deps: ConnectLinkDeps, org: string): Promise<string> {
  try {
    const organization = await deps.store.getResource(ApiResourceKind.organization, org, OrganizationSchema);
    return organization.metadata?.name ?? "";
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return "";
    }
    throw error;
  }
}

/** The console's origin, from its callback page: where a link's page is served. */
function consolePageOrigin(oauthRedirectUri: string): string {
  if (!URL.canParse(oauthRedirectUri)) {
    throw failedPreconditionError(
      "Connect links need the console's address: STIGMER_OAUTH_REDIRECT_URI is not set",
    );
  }
  return new URL(oauthRedirectUri).origin;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
