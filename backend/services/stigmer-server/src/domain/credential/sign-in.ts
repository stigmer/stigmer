/**
 * Sign-in credentials — where an MCP server sign-in keeps its access
 * token: a Credential of the person who signed in (or of the
 * organization, for a server with organization sign-in), serving that
 * server, with one field named by the server's `auth.target_env_var`. A
 * run finds it the way it finds any credential (resolve.ts), so the token
 * needs no lane of its own; the refresh token is not here, it is sealed on
 * the sign-in's grant, where no run receives it and no person reveals it.
 *
 * Every write rides the credential domain's in-process client, so
 * validation, encryption, the one-default-per-target rule, audit and the
 * authorization tuples come from the credential pipeline (full
 * interceptor traversal). The create propagates the person who signed in
 * (an admin, for the organization's sign-in), so the audit names them and
 * a personal sign-in's owner link is theirs; the create
 * says it is a sign-in (`source: oauth`), which the pipeline admits only
 * from a request the server composed. Token rewrites (refresh) run as the
 * server, the only writer a sign-in's fields admit.
 *
 * A credential's delete ends its sign-in (newEndSignInWithCredentialStep):
 * the grant, and the refresh token sealed on it, leave with the
 * credential, so the refresh lane never writes to a credential that is
 * gone.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";

import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import {
  RemoveCredentialFieldsInputSchema,
  SetCredentialFieldsInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { fittedName } from "../../pipeline/steps/slug.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { CredentialOwner } from "./steps.js";
import { isSignIn, ownerOf } from "./steps.js";
import type { CredentialValues } from "./values.js";

/**
 * The narrow in-process credential surface the sign-in lane consumes —
 * satisfied by the composition root's in-process clients.
 */
export interface SignInCredentialClient {
  /** `caller` propagates the person who signed in; absent = the server's own class. */
  create(
    credential: MessageInitShape<typeof CredentialSchema>,
    caller?: CallerIdentity,
  ): Promise<Credential>;
  setFields(
    input: MessageInitShape<typeof SetCredentialFieldsInputSchema>,
  ): Promise<Credential>;
  removeFields(
    input: MessageInitShape<typeof RemoveCredentialFieldsInputSchema>,
  ): Promise<Credential>;
  delete(
    input: MessageInitShape<typeof ApiResourceDeleteInputSchema>,
  ): Promise<Credential>;
}

/** The owner a sign-in to a server is saved for, from the grant's key. */
export function signInOwner(identityAccountId: string, org: string): CredentialOwner {
  return identityAccountId === ""
    ? { kind: "org", org }
    : { kind: "person", person: identityAccountId };
}

export class SignInCredentials {
  constructor(
    private readonly client: SignInCredentialClient,
    private readonly store: Store,
    private readonly values: CredentialValues,
    private readonly logger: Logger,
  ) {}

  /**
   * Saves `token` as the sign-in's field `field` and answers the
   * credential's id: into the credential the grant already names when it
   * is still a sign-in of the same owner (a re-connect), else into a new
   * one serving `server`. The new credential's name is the server's,
   * fitted to the name bound, and its slug is minted with a random suffix
   * by the credential pipeline.
   */
  async save(params: {
    readonly existingCredentialId: string;
    readonly owner: CredentialOwner;
    readonly server: McpServer;
    readonly org: string;
    readonly field: string;
    readonly token: string;
    readonly caller: CallerIdentity;
  }): Promise<string> {
    const existing = await this.reusable(params.existingCredentialId, params.owner);
    if (existing !== undefined) {
      await this.writeToken(existing, params.field, params.token, true);
      return existing;
    }
    const serverName = params.server.metadata?.name ?? params.server.metadata?.slug ?? "";
    const created = await this.client.create(
      create(CredentialSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Credential",
        metadata: {
          name: fittedName(serverName === "" ? "Sign-in" : serverName),
          org: params.org,
        },
        spec: {
          owner:
            params.owner.kind === "person"
              ? { case: "person", value: params.owner.person }
              : { case: "org", value: params.owner.org },
          description: `Sign-in to the MCP server ${serverName}`,
          fields: { [params.field]: { value: params.token, plain: false } },
          serves: [
            {
              target: {
                case: "mcpServer",
                value: {
                  kind: ApiResourceKind.mcp_server,
                  org: params.server.metadata?.org ?? params.org,
                  slug: params.server.metadata?.slug ?? "",
                },
              },
            },
          ],
        },
        status: { source: CredentialSource.oauth },
      }),
      params.caller,
    );
    const id = created.metadata?.id ?? "";
    this.logger.info("Saved an MCP server sign-in as a credential", {
      credentialId: id,
      mcpServerId: params.server.metadata?.id ?? "",
      org: params.org,
      owner: params.owner.kind,
    });
    return id;
  }

  /**
   * Rewrites the access token of a sign-in (the refresh lane). Replaces
   * every other field the sign-in held when `replaceAll` is set (a
   * re-connect whose server now names another variable).
   */
  async writeToken(
    credentialId: string,
    field: string,
    token: string,
    replaceAll = false,
  ): Promise<void> {
    if (replaceAll) {
      const credential = await this.load(credentialId);
      const stale = Object.keys(credential?.spec?.fields ?? {}).filter(
        (name) => name !== field,
      );
      if (stale.length > 0) {
        await this.client.removeFields(
          create(RemoveCredentialFieldsInputSchema, { credentialId, fields: stale }),
        );
      }
    }
    await this.client.setFields(
      create(SetCredentialFieldsInputSchema, {
        credentialId,
        fields: { [field]: { value: token, plain: false } },
      }),
    );
  }

  /** The decrypted access token a sign-in holds, or undefined when the credential or field is gone. */
  async readToken(credentialId: string, field: string): Promise<string | undefined> {
    const credential = await this.load(credentialId);
    return credential === undefined
      ? undefined
      : this.values.fieldValue(credential, field);
  }

  /** Deletes a sign-in's credential; a credential already gone is no fault. */
  async remove(credentialId: string): Promise<void> {
    if (credentialId === "") {
      return;
    }
    try {
      await this.client.delete(
        create(ApiResourceDeleteInputSchema, { resourceId: credentialId }),
      );
    } catch (error) {
      if ((await this.load(credentialId)) === undefined) {
        return;
      }
      throw error;
    }
  }

  /** The grant's credential when it is still a sign-in of `owner`, else undefined. */
  private async reusable(
    credentialId: string,
    owner: CredentialOwner,
  ): Promise<string | undefined> {
    if (credentialId === "") {
      return undefined;
    }
    const credential = await this.load(credentialId);
    if (credential === undefined || !isSignIn(credential)) {
      return undefined;
    }
    const held = ownerOf(credential);
    const same =
      held !== undefined &&
      held.kind === owner.kind &&
      (held.kind === "person"
        ? owner.kind === "person" && held.person === owner.person
        : owner.kind === "org" && held.org === owner.org);
    return same ? credentialId : undefined;
  }

  private async load(credentialId: string): Promise<Credential | undefined> {
    try {
      return await this.store.getResource(
        ApiResourceKind.credential,
        credentialId,
        CredentialSchema,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }
}

/**
 * EndSignInWithCredential (delete, after the row is gone): a sign-in's
 * grant names the credential that holds its access token, so the grant —
 * and the refresh token sealed on it — leave with the credential. Only a
 * sign-in has a grant; best-effort like every post-delete cleanup, since
 * the credential the grant pointed at is already gone either way.
 */
export function newEndSignInWithCredentialStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "EndSignInWithCredential",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const deleted = ctx.get(EXISTING_RESOURCE_KEY) as Credential | undefined;
      if (deleted === undefined || !isSignIn(deleted)) {
        return;
      }
      const id = deleted.metadata?.id ?? "";
      const org = deleted.metadata?.org ?? "";
      const owner = ownerOf(deleted);
      const identity = owner?.kind === "person" ? owner.person : "";
      for (const target of deleted.spec?.serves ?? []) {
        if (target.target.case !== "mcpServer") {
          continue;
        }
        try {
          const serverId = await serverIdOf(store, target.target.value.org, target.target.value.slug);
          if (serverId === undefined) {
            continue;
          }
          const grant = await store.oauthGrants.find(identity, serverId, org);
          if (grant !== undefined && grant.credentialId === id) {
            await store.oauthGrants.delete(identity, serverId, org);
          }
        } catch (error) {
          logger.warn("Failed to end the sign-in of a deleted credential (non-fatal)", {
            credentialId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
}

/** An MCP server's id by organization and slug, or undefined when it is gone. */
async function serverIdOf(
  store: Store,
  org: string,
  slug: string,
): Promise<string | undefined> {
  const server = await findResourceBySlug(
    store,
    ApiResourceKind.mcp_server,
    McpServerSchema,
    slug,
    org,
  );
  return server?.metadata?.id;
}
