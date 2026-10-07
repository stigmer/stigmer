/**
 * Pins the sign-in credential seam (credential/sign-in.ts) on the arms the
 * composed handshake suite (mcpserver/__tests__/oauth-handshake.test.ts)
 * cannot steer: a client that fails at a chosen moment and a store that
 * faults.
 *
 * SignInCredentials, over a real store and a recording credential client:
 *   - a sign-in is saved into the credential its grant names only while
 *     that credential is still a sign-in of the same owner; a credential
 *     that is gone or was never a sign-in gets a new sign-in beside it;
 *   - a store fault reading the grant's credential is thrown, never read
 *     as "gone" (which would save a second sign-in);
 *   - removing a sign-in with no credential asks nothing; a delete that
 *     fails because the credential is already gone is no fault, and one
 *     that fails with the credential still there is thrown.
 *
 * EndSignInWithCredential (the credential delete chain's last step) ends
 * only the grant that names the deleted credential: a git host target and
 * a server that is gone are skipped, a grant naming another credential is
 * kept, and a store fault is logged, never the delete's failure.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { CredentialTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { createLogger } from "../../../boot/logger.js";
import type { LogFields } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { OAuthGrant, Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { SignInCredentialClient } from "../sign-in.js";
import {
  SignInCredentials,
  newEndSignInWithCredentialStep,
} from "../sign-in.js";

const ORG = "acme";
const ANA = "acc_ana";
const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "credential-sign-in-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;

async function saveCredential(init: {
  readonly signIn: boolean;
  readonly owner?: string;
  readonly serves?: ReadonlyArray<
    MessageInitShape<typeof CredentialTargetSchema>
  >;
}): Promise<Credential> {
  counter += 1;
  const id = `cred_${counter}`;
  const credential = create(CredentialSchema, {
    metadata: { id, org: ORG, slug: `cred-${counter}` },
    spec: {
      owner: { case: "person", value: init.owner ?? ANA },
      fields: { TOKEN: { value: "sealed" } },
      serves: [...(init.serves ?? [])],
    },
    status: {
      source: init.signIn ? CredentialSource.oauth : CredentialSource.static,
    },
  });
  await store.saveResource(
    ApiResourceKind.credential,
    id,
    CredentialSchema,
    credential,
  );
  return credential;
}

interface RecordedCalls {
  readonly created: Array<MessageInitShape<typeof CredentialSchema>>;
  readonly setFields: string[];
  readonly deleted: string[];
}

/** A credential client that records each call; `deleteFails` makes the delete throw. */
function recordingClient(options: { deleteFails?: Error } = {}): {
  client: SignInCredentialClient;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = { created: [], setFields: [], deleted: [] };
  return {
    calls,
    client: {
      create: async (credential) => {
        calls.created.push(credential);
        return create(CredentialSchema, { metadata: { id: "cred_created" } });
      },
      setFields: async (input) => {
        calls.setFields.push(input.credentialId ?? "");
        return create(CredentialSchema);
      },
      removeFields: async () => create(CredentialSchema),
      delete: async (input) => {
        calls.deleted.push(input.resourceId ?? "");
        if (options.deleteFails !== undefined) {
          throw options.deleteFails;
        }
        return create(CredentialSchema);
      },
    },
  };
}

const server = create(McpServerSchema, {
  metadata: { id: "mcps_linear", org: ORG, slug: "linear", name: "Linear" },
});

function saveParams(existingCredentialId: string) {
  return {
    existingCredentialId,
    owner: { kind: "person" as const, person: ANA },
    server,
    org: ORG,
    field: "LINEAR_TOKEN",
    token: "at-1",
    caller: testCallerIdentity({ identityId: ANA }),
  };
}

/** The store, with every credential read failing with `error`. */
function storeFailingReads(error: Error): Store {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "getResource") {
        return () => Promise.reject(error);
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("SignInCredentials.save — which credential a sign-in is saved into", () => {
  it("the grant's credential, while it is still a sign-in of the same owner", async () => {
    const held = await saveCredential({ signIn: true });
    const { client, calls } = recordingClient();

    const id = await new SignInCredentials(client, store, silentLogger).save(
      saveParams(held.metadata?.id ?? ""),
    );

    expect(id).toBe(held.metadata?.id);
    expect(calls.setFields).toEqual([held.metadata?.id]);
    expect(calls.created).toHaveLength(0);
  });

  it("a new sign-in when the grant's credential is gone", async () => {
    const { client, calls } = recordingClient();

    const id = await new SignInCredentials(client, store, silentLogger).save(
      saveParams("cred_never_saved"),
    );

    expect(id).toBe("cred_created");
    expect(calls.setFields).toHaveLength(0);
    expect(calls.created).toHaveLength(1);
  });

  it("a new sign-in when the grant names a credential a person saved by hand", async () => {
    const typed = await saveCredential({ signIn: false });
    const { client, calls } = recordingClient();

    const id = await new SignInCredentials(client, store, silentLogger).save(
      saveParams(typed.metadata?.id ?? ""),
    );

    expect(id).toBe("cred_created");
    expect(calls.setFields).toHaveLength(0);
  });

  it("a store fault reading the grant's credential is thrown, never read as gone", async () => {
    const fault = new Error("SQLITE_BUSY");
    const { client, calls } = recordingClient();

    await expect(
      new SignInCredentials(
        client,
        storeFailingReads(fault),
        silentLogger,
      ).save(saveParams("cred_any")),
    ).rejects.toBe(fault);
    expect(calls.created).toHaveLength(0);
  });
});

describe("SignInCredentials.remove", () => {
  it("a sign-in with no credential asks nothing", async () => {
    const { client, calls } = recordingClient();

    await new SignInCredentials(client, store, silentLogger).remove("");

    expect(calls.deleted).toHaveLength(0);
  });

  it("a delete that fails because the credential is already gone is no fault", async () => {
    const { client, calls } = recordingClient({
      deleteFails: new ConnectError("credential not found", Code.NotFound),
    });

    await new SignInCredentials(client, store, silentLogger).remove(
      "cred_already_gone",
    );

    expect(calls.deleted).toEqual(["cred_already_gone"]);
  });

  it("a delete that fails with the credential still there is thrown", async () => {
    const held = await saveCredential({ signIn: true });
    const failure = new ConnectError("database is locked", Code.Internal);
    const { client } = recordingClient({ deleteFails: failure });

    await expect(
      new SignInCredentials(client, store, silentLogger).remove(
        held.metadata?.id ?? "",
      ),
    ).rejects.toBe(failure);
  });
});

describe("EndSignInWithCredential", () => {
  function grantFor(serverId: string, credentialId: string): OAuthGrant {
    return {
      identityAccountId: ANA,
      resourceId: serverId,
      resourceKind: "mcp_server",
      orgId: ORG,
      accessTokenExpiresAt: 0,
      clientId: "client-1",
      authMethod: "mcp_oauth",
      tokenEndpoint: "https://auth.example.test/token",
      accessTokenEnvVar: "TOKEN",
      credentialId,
      refreshToken: "",
      createdAt: 0,
      updatedAt: 0,
    };
  }

  async function saveServer(slug: string): Promise<string> {
    const id = `mcps_${slug}`;
    await store.saveResource(
      ApiResourceKind.mcp_server,
      id,
      McpServerSchema,
      create(McpServerSchema, { metadata: { id, org: ORG, slug, name: slug } }),
    );
    return id;
  }

  function serving(...slugs: string[]) {
    return [
      { target: { case: "gitHost" as const, value: "github.com" } },
      ...slugs.map((slug) => ({
        target: {
          case: "mcpServer" as const,
          value: { kind: ApiResourceKind.mcp_server, org: ORG, slug },
        },
      })),
    ];
  }

  async function runStep(
    deleted: Credential,
    onStore: Store = store,
    logger = silentLogger,
  ) {
    const ctx = new RequestContext(
      ApiResourceDeleteInputSchema,
      create(ApiResourceDeleteInputSchema, {
        resourceId: deleted.metadata?.id ?? "",
      }),
      testCallerIdentity(),
    );
    ctx.set(EXISTING_RESOURCE_KEY, deleted);
    await newEndSignInWithCredentialStep(onStore, logger).execute(ctx);
  }

  it("ends the grant naming the deleted sign-in, skipping a git host and a server that is gone", async () => {
    const serverId = await saveServer(`ends-${counter}`);
    const deleted = await saveCredential({
      signIn: true,
      serves: serving("gone-server", `ends-${counter}`),
    });
    await store.oauthGrants.upsert(
      grantFor(serverId, deleted.metadata?.id ?? ""),
    );

    await runStep(deleted);

    expect(await store.oauthGrants.find(ANA, serverId, ORG)).toBeUndefined();
  });

  it("keeps a grant that names another credential", async () => {
    const slug = `kept-${counter}`;
    const serverId = await saveServer(slug);
    const deleted = await saveCredential({
      signIn: true,
      serves: serving(slug),
    });
    await store.oauthGrants.upsert(grantFor(serverId, "cred_the_live_one"));

    await runStep(deleted);

    expect(
      (await store.oauthGrants.find(ANA, serverId, ORG))?.credentialId,
    ).toBe("cred_the_live_one");
  });

  it("a store fault is logged, never the delete's failure", async () => {
    const deleted = await saveCredential({
      signIn: true,
      serves: serving("any"),
    });
    const warnings: Array<{ message: string; fields: LogFields | undefined }> =
      [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: ({ level, message, fields }) => {
        if (level === "warn") {
          warnings.push({ message, fields });
        }
      },
    });
    const faulty = new Proxy(store, {
      get(target, prop) {
        if (prop === "listResources") {
          return () => Promise.reject(new Error("SQLITE_BUSY"));
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await runStep(deleted, faulty, logger);

    expect(warnings).toEqual([
      {
        message:
          "Failed to end the sign-in of a deleted credential (non-fatal)",
        fields: { credentialId: deleted.metadata?.id, error: "SQLITE_BUSY" },
      },
    ]);
  });
});
