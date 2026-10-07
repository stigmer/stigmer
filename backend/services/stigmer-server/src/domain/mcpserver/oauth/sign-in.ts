/**
 * Whose sign-in an MCP server's OAuth lanes act on, and the refresh that
 * keeps a sign-in's access token fresh.
 *
 * A server's `sign_in` says whose account its runs use. With personal
 * sign-in (the default) every lane acts on the CALLER's own sign-in: the
 * grant is keyed by their identity, the token is saved as their
 * credential, and a teammate's sign-in is never touched — the reason a
 * member's run never uses another member's account. With organization
 * sign-in the lanes act on the organization's one sign-in: the grant's
 * identity is empty, the token is the organization's credential, and only
 * an admin (can_create_org_credential, the permission to save the
 * organization's credentials) may sign it in or out.
 *
 * The refresh (SignInRefresher) is the run resolution's and the connect
 * lane's pre-flight: when a sign-in's access token is past its expiry
 * (with the refresh buffer), the refresh token sealed on the grant buys a
 * new one, which is written into the sign-in's credential and the grant
 * before the run reads it. A sign-in that cannot be renewed refuses with
 * FailedPrecondition: an expired token must stop the run at create, not
 * fail it halfway with a 401.
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../../boot/logger.js";
import type { SecretService } from "../../../encryption/encryption.js";
import { EncryptionScope } from "../../../encryption/encryption.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  permissionDeniedError,
} from "../../../pipeline/errors.js";
import { evaluateAuthorizer } from "../../../pipeline/steps/authorize.js";
import { findResourceBySlug } from "../../../pipeline/steps/helpers.js";
import type { OAuthGrant, Store } from "../../../store/interface.js";
import type { SignInFreshener } from "../../credential/resolve.js";
import type { SignInCredentials } from "../../credential/sign-in.js";
import { ownerOf } from "../../credential/steps.js";
import { loadOAuthAppClientCredentials } from "./client-credentials.js";
import { refreshTokenIfExpired } from "./refresh.js";

/** Whether a server's runs use the organization's one sign-in. */
export function isOrganizationSignIn(server: McpServer): boolean {
  return server.spec?.signIn === McpServerSignIn.organization;
}

/**
 * The grant identity a lane naming a server only by id acts on: the
 * server's own sign-in rule when the server can be read, the caller's own
 * otherwise (a server that is gone has no organization sign-in to act on).
 */
export async function signInIdentityById(
  store: Store,
  mcpServerId: string,
  caller: CallerIdentity,
): Promise<{ readonly identity: string; readonly server: McpServer | undefined }> {
  let server: McpServer | undefined;
  try {
    server = await store.getResource(ApiResourceKind.mcp_server, mcpServerId, McpServerSchema);
  } catch {
    server = undefined;
  }
  return {
    identity: server === undefined ? caller.identityId : signInIdentity(server, caller),
    server,
  };
}

/** The grant identity an OAuth lane acts on for `caller`: theirs, or "" for organization sign-in. */
export function signInIdentity(server: McpServer, caller: CallerIdentity): string {
  return isOrganizationSignIn(server) ? "" : caller.identityId;
}

/**
 * Refuses an organization sign-in lane to a caller who is not one of the
 * organization's admins; a personal sign-in lane is every member's own.
 */
export async function requireOrganizationSignInAdmin(
  authorizer: Authorizer,
  caller: CallerIdentity,
  server: McpServer,
  org: string,
): Promise<void> {
  if (!isOrganizationSignIn(server)) {
    return;
  }
  const decision = await evaluateAuthorizer(authorizer, caller, {
    permission: IamPermission.can_create_org_credential,
    resourceKind: ApiResourceKind.organization,
    resourceId: org,
  });
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
    case "not-found":
      throw permissionDeniedError(
        `MCP server '${server.metadata?.slug ?? ""}' uses the organization's sign-in; only the organization's admins sign it in or out`,
      );
    case "unavailable":
      throw internalError(decision.cause, "failed to authorize the organization's sign-in");
    default: {
      const exhaustive: never = decision;
      throw new Error(`unknown decision: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Seals a refresh token for the grant row; "" stays "" (no refresh token issued). */
export async function sealRefreshToken(
  secretService: SecretService,
  logger: Logger,
  token: string,
  org: string,
): Promise<string> {
  if (token === "") {
    return "";
  }
  if (!secretService.isEnabled()) {
    logger.warn("Encryption disabled: an OAuth refresh token will be stored in plaintext");
    return token;
  }
  return secretService.encrypt(token, EncryptionScope.forOrganization(org));
}

/** Unseals a grant's refresh token; plaintext (keyless rows) passes through. */
export async function unsealRefreshToken(
  secretService: SecretService,
  sealed: string,
): Promise<string> {
  return sealed === "" ? "" : secretService.decrypt(sealed);
}

export interface SignInRefresherDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly signIns: SignInCredentials;
  /** The one fetch this slice dials user-supplied URLs with. */
  readonly outboundFetch: OutboundFetch;
}

/** The pre-flight refresh of a sign-in (the module header). */
export class SignInRefresher implements SignInFreshener {
  constructor(private readonly deps: SignInRefresherDeps) {}

  /**
   * The sign-in's grant is found by the MCP server the credential serves
   * (a sign-in serves exactly the server it signed in to, and may serve a
   * git host too) and the credential's owner; a grant that names another
   * credential is not this sign-in's.
   */
  async freshen(credential: Credential): Promise<Credential> {
    const credentialId = credential.metadata?.id ?? "";
    const org = credential.metadata?.org ?? "";
    const owner = ownerOf(credential);
    const identity = owner?.kind === "person" ? owner.person : "";
    for (const target of credential.spec?.serves ?? []) {
      if (target.target.case !== "mcpServer") {
        continue;
      }
      const ref = target.target.value;
      let grant: OAuthGrant | undefined;
      try {
        const server = await findResourceBySlug(
          this.deps.store,
          ApiResourceKind.mcp_server,
          McpServerSchema,
          ref.slug,
          ref.org,
        );
        if (server === undefined) {
          continue;
        }
        grant = await this.deps.store.oauthGrants.find(
          identity,
          server.metadata?.id ?? "",
          org,
        );
      } catch (error) {
        throw internalError(error, "failed to read the sign-in's grant");
      }
      if (grant === undefined || grant.credentialId !== credentialId) {
        continue;
      }
      return (await this.refresh(grant))
        ? this.reload(credentialId, credential)
        : credential;
    }
    return credential;
  }

  /**
   * Refreshes `grant` when its token is past expiry: writes the new access
   * token into the grant's credential and the new expiry and refresh token
   * onto the grant. Answers whether it refreshed; FailedPrecondition when
   * the sign-in cannot be renewed.
   */
  async refresh(grant: OAuthGrant): Promise<boolean> {
    let refreshToken: string;
    try {
      refreshToken = await unsealRefreshToken(this.deps.secretService, grant.refreshToken);
    } catch (error) {
      throw internalError(error, "failed to unseal the sign-in's refresh token");
    }
    let clientSecret = "";
    let tokenAuthMethod = "";
    if (grant.authMethod === "vendor_oauth") {
      const server = await this.server(grant.resourceId);
      if (server !== undefined) {
        try {
          ({ clientSecret, tokenAuthMethod } = await loadOAuthAppClientCredentials(
            this.deps,
            server,
          ));
        } catch (error) {
          this.deps.logger.warn("Failed to load the OAuth app's client secret for a refresh", {
            mcpServerId: grant.resourceId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    let result;
    try {
      result = await refreshTokenIfExpired(
        grant,
        refreshToken,
        clientSecret,
        tokenAuthMethod,
        this.deps.logger,
        this.deps.outboundFetch,
      );
    } catch (error) {
      throw failedPreconditionError(error instanceof Error ? error.message : String(error));
    }
    if (!result.refreshed) {
      return false;
    }
    try {
      await this.deps.signIns.writeToken(
        grant.credentialId,
        grant.accessTokenEnvVar,
        result.newAccessToken,
      );
    } catch (error) {
      throw internalError(error, "failed to save the refreshed access token");
    }
    try {
      await this.deps.store.oauthGrants.upsert({
        ...grant,
        accessTokenExpiresAt: result.newExpiresAt,
        refreshToken: await sealRefreshToken(
          this.deps.secretService,
          this.deps.logger,
          result.newRefreshToken,
          grant.orgId,
        ),
      });
    } catch (error) {
      this.deps.logger.warn("Failed to update the OAuth grant after a refresh (non-fatal)", {
        mcpServerId: grant.resourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  private async server(id: string): Promise<McpServer | undefined> {
    try {
      return await this.deps.store.getResource(ApiResourceKind.mcp_server, id, McpServerSchema);
    } catch {
      return undefined;
    }
  }

  private async reload(credentialId: string, fallback: Credential): Promise<Credential> {
    try {
      return await this.deps.store.getResource(
        ApiResourceKind.credential,
        credentialId,
        CredentialSchema,
      );
    } catch {
      return fallback;
    }
  }
}
