/**
 * Pins loadOAuthAppClientCredentials (oauth/client-credentials.ts): the
 * client secret and token-endpoint auth method a vendor sign-in refreshes
 * with, read live from the OAuthApp the server's `auth.oauth_app_ref`
 * names.
 *
 * What it pins: a server with no app reference is a public (DCR) client,
 * both values empty, and the store is never read; an app saved before the
 * auth-method field existed (UNSPECIFIED) authenticates with HTTP Basic,
 * and a secret stored plaintext (a keyless deployment) is presented as
 * stored; an app that is not there and a store that cannot be listed are
 * errors naming what failed, which the refresh logs (sign-in.test.ts).
 * The decrypted secret and client_secret_post are pinned through the
 * refresh in sign-in.test.ts.
 */
import { randomBytes } from "node:crypto";

import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import { createLogger } from "../../../../boot/logger.js";
import { SecretService } from "../../../../encryption/encryption.js";
import { untouchable } from "../../../../pipeline/__tests__/support.js";
import type { Store } from "../../../../store/interface.js";
import {
  loadOAuthAppClientCredentials,
  tokenAuthMethodFromSpec,
} from "../client-credentials.js";
import { TOKEN_AUTH_METHOD_BASIC, TOKEN_AUTH_METHOD_POST } from "../token.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const secrets = SecretService.create(randomBytes(32));

function serverReferencing(slug: string) {
  return create(McpServerSchema, {
    metadata: { id: "mcps_vendor", org: "acme", slug: "vendor" },
    spec: {
      auth: {
        targetEnvVar: "VENDOR_TOKEN",
        oauthAppRef: { kind: ApiResourceKind.oauth_app, org: "acme", slug },
      },
    },
  });
}

/** A store whose OAuthApp listing answers `rows`. */
function storeListing(rows: () => Promise<Uint8Array[]>): Store {
  return { listResources: rows } as unknown as Store;
}

describe("loadOAuthAppClientCredentials", () => {
  it("a server with no app reference is a public client, and the store is never read", async () => {
    const server = create(McpServerSchema, {
      metadata: { slug: "public" },
      spec: { auth: { targetEnvVar: "TOKEN" } },
    });

    const loaded = await loadOAuthAppClientCredentials(
      {
        store: untouchable("store"),
        logger: silentLogger,
        secretService: secrets,
      },
      server,
    );

    expect(loaded).toEqual({ clientSecret: "", tokenAuthMethod: "" });
  });

  it("an app with no auth method uses Basic, and a plaintext secret is presented as stored", async () => {
    const app = create(OAuthAppSchema, {
      metadata: {
        id: "oap_legacy",
        org: "acme",
        slug: "legacy",
        name: "legacy",
      },
      spec: { clientId: "client-1", clientSecret: "plain-secret" },
    });

    const loaded = await loadOAuthAppClientCredentials(
      {
        store: storeListing(() =>
          Promise.resolve([toBinary(OAuthAppSchema, app)]),
        ),
        logger: silentLogger,
        secretService: secrets,
      },
      serverReferencing("legacy"),
    );

    expect(loaded).toEqual({
      clientSecret: "plain-secret",
      tokenAuthMethod: TOKEN_AUTH_METHOD_BASIC,
    });
  });

  it("an app that is not there names its slug", async () => {
    await expect(
      loadOAuthAppClientCredentials(
        {
          store: storeListing(() => Promise.resolve([])),
          logger: silentLogger,
          secretService: secrets,
        },
        serverReferencing("missing"),
      ),
    ).rejects.toThrow("OAuthApp 'missing' not found");
  });

  it("a store that cannot list the apps is an error naming the listing", async () => {
    await expect(
      loadOAuthAppClientCredentials(
        {
          store: storeListing(() => Promise.reject(new Error("SQLITE_BUSY"))),
          logger: silentLogger,
          secretService: secrets,
        },
        serverReferencing("any"),
      ),
    ).rejects.toThrow("failed to list oauth apps: SQLITE_BUSY");
  });
});

describe("tokenAuthMethodFromSpec", () => {
  it.each([
    [TokenEndpointAuthMethod.UNSPECIFIED, TOKEN_AUTH_METHOD_BASIC],
    [TokenEndpointAuthMethod.CLIENT_SECRET_BASIC, TOKEN_AUTH_METHOD_BASIC],
    [TokenEndpointAuthMethod.CLIENT_SECRET_POST, TOKEN_AUTH_METHOD_POST],
  ])("maps %s to %s", (method, expected) => {
    expect(tokenAuthMethodFromSpec(method)).toBe(expected);
  });
});
