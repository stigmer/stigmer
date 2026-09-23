/**
 * The PlatformClient lane on a composed server in the authentication
 * posture with the built-in Authorizer (a unit that vouches for tokens,
 * declares the posture and registers no Authorizer — the open-source OIDC
 * self-host's shape), with the key ring supplied so the run is hermetic:
 *   - the founder creates a client; an anonymous mint answers a token; the
 *     token authenticates as the end user's derived account, which holds the
 *     auto-grant role on the owning organization and sees that one alone;
 *   - the platform-client verifier sits ahead of the unit's verifier and
 *     claims only its lane: the founder's tokens still pass, and a TYPED
 *     platform token (a lane open source does not speak) is refused as
 *     unclaimed;
 *   - the origin guard refuses an unlisted Origin with the cloud's copy and
 *     passes a request without one;
 *   - deleting the client refuses its token on the next request with the
 *     cloud's liveness copy;
 *   - an outsider cannot read the client by reference.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { PlatformClientQueryController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/query_pb";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import {
  DELETED_CLIENT_MESSAGE,
  originRefusalMessage,
} from "../../domain/platformclient/constants.js";
import { signPlatformToken } from "../../platformtoken/envelope.js";
import { platformTokenKeyRingFromPem } from "../../platformtoken/key-ring.js";
import type { SigningPlatformTokenKeyRing } from "../../platformtoken/key-ring.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  bearer,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const FOUNDER = "fake|pc-founder";
const OUTSIDER = "fake|pc-outsider";
const ORG = "pc-org";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const built = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [publicKey.export({ format: "pem", type: "spki" }).toString()],
});
if (built.signer === undefined) throw new Error("fixture ring must sign");
const RING: SigningPlatformTokenKeyRing = { ...built, signer: built.signer };

/** Stamps the lowercase `origin` header a browser attaches to a cross-origin call. */
function browserOrigin(origin: string): Interceptor {
  return (next) => (request) => {
    request.header.set("origin", origin);
    return next(request);
  };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

describe("PlatformClient on a composed server (authentication posture, built-in Authorizer)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;

  const asFounder = (): Transport =>
    transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asOutsider = (): Transport =>
    transportFor(port, fakeJwt(OUTSIDER, "outsider@example.com"));
  const presenting = (token: string, origin?: string): Transport =>
    createGrpcTransport({
      baseUrl: `http://127.0.0.1:${port}`,
      interceptors: [
        bearer(token),
        ...(origin !== undefined ? [browserOrigin(origin)] : []),
      ],
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "platform-client-composed-"));
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      drivers: { platformTokenKeys: RING },
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();

    await createClient(
      IdentityAccountCommandController,
      asFounder(),
    ).provisionMyAccount({});
    await createClient(OrganizationCommandController, asFounder()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    await createClient(
      IdentityAccountCommandController,
      asOutsider(),
    ).provisionMyAccount({});
  });

  afterAll(async () => {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  async function createPlatformClient(allowedOrigins: string[] = []) {
    const created = await createClient(
      PlatformClientCommandController,
      asFounder(),
    ).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "PlatformClient",
      metadata: {
        name: `client-${Math.random().toString(36).slice(2, 8)}`,
        org: ORG,
      },
      spec: {
        autoProvisionAccounts: true,
        autoGrantOnOrg: true,
        autoGrantRole: IamRole.member,
        allowedOrigins,
      },
    });
    return {
      id: created.platformClient?.metadata?.id ?? "",
      slug: created.platformClient?.metadata?.slug ?? "",
      clientId: created.platformClient?.spec?.clientId ?? "",
      clientSecret: created.clientSecret,
    };
  }

  async function mint(
    client: { clientId: string; clientSecret: string },
    userId: string,
  ) {
    const minted = await createClient(
      PlatformClientTokenController,
      transportFor(port),
    ).mintUserToken({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      userId,
      userEmail: `${userId}@product.example`,
      userName: "Product User",
    });
    return minted.accessToken;
  }

  it("mints for the end user's derived account, which sees its owning organization alone", async () => {
    const client = await createPlatformClient();
    const token = await mint(client, "user-1");

    const me = await createClient(
      IdentityAccountQueryController,
      presenting(token),
    ).whoAmI({});
    expect(me.metadata?.id).toBe(accountIdFor(`stgm_pc|${ORG}|user-1`));

    const mine = await createClient(
      OrganizationQueryController,
      presenting(token),
    ).findMyOrganizations({});
    expect(
      mine.entries.map((organization) => organization.metadata?.slug),
    ).toEqual([ORG]);
  });

  it("claims only its lane: the unit's tokens still pass, and a typed platform token is refused as unclaimed", async () => {
    await createClient(
      OrganizationQueryController,
      asFounder(),
    ).findMyOrganizations({});

    const guest = signPlatformToken(RING, {
      sub: "ida_guest",
      token_type: "guest",
    });
    const refused = await refusal(
      createClient(
        OrganizationQueryController,
        presenting(guest),
      ).findMyOrganizations({}),
    );
    expect(refused.code).toBe(Code.Unauthenticated);
  });

  it("refuses an unlisted Origin with the cloud's copy and passes a request without one", async () => {
    const client = await createPlatformClient(["https://app.example"]);
    const token = await mint(client, "user-2");

    const denied = await refusal(
      createClient(
        OrganizationQueryController,
        presenting(token, "https://evil.example"),
      ).findMyOrganizations({}),
    );
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe(
      originRefusalMessage("https://evil.example"),
    );

    await createClient(
      OrganizationQueryController,
      presenting(token),
    ).findMyOrganizations({});
    await createClient(
      OrganizationQueryController,
      presenting(token, "https://app.example"),
    ).findMyOrganizations({});
  });

  it("refuses a deleted client's token on the next request with the liveness copy", async () => {
    const client = await createPlatformClient();
    const token = await mint(client, "user-3");
    await createClient(
      OrganizationQueryController,
      presenting(token),
    ).findMyOrganizations({});

    await createClient(PlatformClientCommandController, asFounder()).delete({
      resourceId: client.id,
    });

    const denied = await refusal(
      createClient(
        OrganizationQueryController,
        presenting(token),
      ).findMyOrganizations({}),
    );
    expect(denied.code).toBe(Code.Unauthenticated);
    expect(denied.rawMessage).toBe(DELETED_CLIENT_MESSAGE);
  });

  it("an outsider cannot read the client by reference", async () => {
    const client = await createPlatformClient();
    const denied = await refusal(
      createClient(PlatformClientQueryController, asOutsider()).getByReference({
        org: ORG,
        slug: client.slug,
        kind: ApiResourceKind.platform_client,
      }),
    );
    expect(denied.code).toBe(Code.PermissionDenied);
    expect(denied.rawMessage).toBe("unauthorized to view platform client");
  });
});
