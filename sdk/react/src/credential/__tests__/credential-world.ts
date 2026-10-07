/**
 * A small in-memory credential server for hook and component tests: the
 * credential list, get, create, setFields, removeFields and revealField
 * RPCs over one mutable world, and `whoAmI` for the caller's id. Every
 * write is recorded so a test can pin exactly what was sent (including
 * that nothing else was). The list returns the world as a server would to
 * its caller: their own credentials and the organization's, never another
 * person's.
 *
 * Shared by the credential, agent, composer, GitHub and assignment tests.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { CredentialSchema, type Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialListSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";
import { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialFieldSchema, CredentialSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import type { CredentialTargetRef } from "../model.js";

/** The caller every world answers `whoAmI` with. */
export const ME = "ida_me";

/** One recorded write: the RPC and what it carried. */
export interface CredentialWrite {
  readonly rpc: "create" | "setFields" | "removeFields" | "update" | "delete";
  readonly credential: Credential;
  readonly fields?: readonly string[];
}

/** The world's state: the stored credentials and every write received. */
export interface CredentialWorld {
  credentials: Credential[];
  readonly writes: CredentialWrite[];
  /** Values a reveal answers with, by `${credentialId}#${field}`. */
  readonly secrets: Record<string, string>;
}

/** A fresh world holding `credentials`. */
export function credentialWorld(credentials: Credential[] = []): CredentialWorld {
  return { credentials, writes: [], secrets: {} };
}

function targetProto(ref: CredentialTargetRef) {
  switch (ref.kind) {
    case "agent":
      return create(CredentialTargetSchema, {
        target: { case: "agent", value: { org: ref.org, slug: ref.slug, kind: ApiResourceKind.agent } },
      });
    case "mcp_server":
      return create(CredentialTargetSchema, {
        target: { case: "mcpServer", value: { org: ref.org, slug: ref.slug, kind: ApiResourceKind.mcp_server } },
      });
    case "git_host":
      return create(CredentialTargetSchema, { target: { case: "gitHost", value: ref.host } });
    default: {
      const exhaustive: never = ref;
      throw new Error(`unknown target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Options for {@link storedCredential}. */
export interface StoredCredentialOptions {
  readonly id: string;
  readonly org: string;
  readonly owner: "person" | "org";
  readonly name?: string;
  readonly fields?: readonly string[];
  readonly serves?: readonly CredentialTargetRef[];
  readonly signIn?: boolean;
}

/** A credential as the server stores and returns it, secrets redacted. */
export function storedCredential(o: StoredCredentialOptions): Credential {
  return create(CredentialSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Credential",
    metadata: create(ApiResourceMetadataSchema, {
      id: o.id,
      org: o.org,
      slug: o.id,
      name: o.name ?? o.id,
    }),
    spec: {
      owner: o.owner === "person" ? { case: "person", value: ME } : { case: "org", value: o.org },
      fields: Object.fromEntries(
        (o.fields ?? []).map((name) => [name, create(CredentialFieldSchema, { value: "***REDACTED***" })]),
      ),
      serves: (o.serves ?? []).map(targetProto),
    },
    status: { source: o.signIn ? CredentialSource.oauth : CredentialSource.static },
  });
}

/**
 * Registers the credential and `whoAmI` services over `world` on a router
 * transport's router. Mutations update the world, so a later list sees them.
 */
export function routeCredentials(router: ConnectRouter, world: CredentialWorld): void {
  router.service(IdentityAccountQueryController, {
    whoAmI: () => create(IdentityAccountSchema, { metadata: create(ApiResourceMetadataSchema, { id: ME }) }),
  });
  router.service(CredentialQueryController, {
    list: () => create(CredentialListSchema, { items: world.credentials, totalCount: world.credentials.length }),
    get: (input) => {
      const found = world.credentials.find((c) => c.metadata?.id === input.value);
      if (!found) throw new ConnectError("no such credential", Code.NotFound);
      return found;
    },
    revealField: (input) => {
      const found = world.credentials.find((c) => c.metadata?.id === input.credentialId);
      if (!found || found.spec?.owner.case !== "person") {
        throw new ConnectError("an organization's credential is write-only", Code.FailedPrecondition);
      }
      return create(CredentialFieldSchema, { value: world.secrets[`${input.credentialId}#${input.field}`] ?? "" });
    },
  });
  router.service(CredentialCommandController, {
    create: (input) => {
      const created = clone(CredentialSchema, input);
      created.metadata ??= create(ApiResourceMetadataSchema);
      created.metadata.id = `cred_${world.credentials.length + 1}`;
      created.metadata.slug = `cred-${world.credentials.length + 1}`;
      world.writes.push({ rpc: "create", credential: created });
      world.credentials = [...world.credentials, created];
      return created;
    },
    update: (input) => {
      world.writes.push({ rpc: "update", credential: input });
      world.credentials = world.credentials.map((c) => (c.metadata?.id === input.metadata?.id ? input : c));
      return input;
    },
    setFields: (input) => {
      const found = world.credentials.find((c) => c.metadata?.id === input.credentialId);
      if (!found) throw new ConnectError("no such credential", Code.NotFound);
      const updated = clone(CredentialSchema, found);
      updated.spec ??= create(CredentialSpecSchema);
      updated.spec.fields = { ...updated.spec.fields, ...input.fields };
      world.writes.push({ rpc: "setFields", credential: updated, fields: Object.keys(input.fields) });
      world.credentials = world.credentials.map((c) => (c.metadata?.id === input.credentialId ? updated : c));
      return updated;
    },
    removeFields: (input) => {
      const found = world.credentials.find((c) => c.metadata?.id === input.credentialId);
      if (!found) throw new ConnectError("no such credential", Code.NotFound);
      const updated = clone(CredentialSchema, found);
      updated.spec ??= create(CredentialSpecSchema);
      const fields = { ...updated.spec.fields };
      for (const name of input.fields) delete fields[name];
      updated.spec.fields = fields;
      world.writes.push({ rpc: "removeFields", credential: updated, fields: input.fields });
      world.credentials = world.credentials.map((c) => (c.metadata?.id === input.credentialId ? updated : c));
      return updated;
    },
  });
}
