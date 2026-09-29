/**
 * Pins the two unit points and the edition's sign-in rule on real boots
 * (extensions/composed-services.ts, boot/compose.ts):
 *
 *   - `onComposed` hands every unit the composition's own instances before
 *     `composeServer` returns: the very Authorizer a unit registered, its
 *     list scope, its engine's check and its lifecycle, and the one
 *     in-process transport; under open source's own authorization, the
 *     built-in Authorizer, list scope and policy check.
 *   - `start` runs in unit order, first in `start()`, before the server
 *     reports SERVING; a failing start fails `start()`, naming its unit.
 *   - An edition above open source with no sign-in is refused at boot,
 *     whichever authorizer it runs.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { HealthCheckResponse_ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { newPermissiveSingleTeamAuthorizer } from "../../pipeline/steps/authorize.js";
import { platformTokenKeyRingFromPem } from "../../platformtoken/key-ring.js";
import type { AuthorizationQueryEngine } from "../authorization-queries.js";
import type { ComposedServices } from "../composed-services.js";
import type { IdentityVerifier } from "../identity.js";
import type { ListReadScope } from "../list-read-scope.js";
import type { ServerExtension } from "../registry.js";
import type { ResourceAuthorizationLifecycle } from "../resource-authorization.js";
import type { ResourceRowReader } from "../resource-row-reader.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const verifier: IdentityVerifier = {
  name: "fixture-verifier",
  verify: () => Promise.resolve(null),
};
const ringKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RING = platformTokenKeyRingFromPem({
  privateKeyPem: ringKeys.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString(),
  publicKeyPems: [
    ringKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  ],
});
const noRows: ResourceRowReader = {
  findById: () => Promise.resolve(undefined),
};

/** An Enterprise unit on open source's own authorization: sign-in, a key ring, a reader per kind. */
function enterpriseUnit(extra: Partial<ServerExtension> = {}): ServerExtension {
  return {
    name: "enterprise-fixture",
    edition: ServerEdition.enterprise,
    requireAuthentication: true,
    identityVerifiers: [verifier],
    drivers: {
      platformTokenKeys: RING,
      resourceRowReaders: new Map([
        [ApiResourceKind.identity_provider, noRows],
        [ApiResourceKind.invitation, noRows],
        [ApiResourceKind.team, noRows],
      ]),
    },
    ...extra,
  };
}

const dirs: string[] = [];
const servers: ComposedServer[] = [];

async function compose(
  extensions: ReadonlyArray<ServerExtension>,
): Promise<ComposedServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "composed-services-"));
  dirs.push(dir);
  const server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    extensions: [...extensions],
    portOverride: 0,
    host: "127.0.0.1",
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.shutdown();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("onComposed: a unit receives the composition's own instances", () => {
  it("hands a unit the very Authorizer, list scope, check and lifecycle a unit registered, and the one in-process transport, before composeServer returns", async () => {
    const authorizer = newPermissiveSingleTeamAuthorizer();
    const listReadScope: ListReadScope = {
      authorizedResourceIds: () => Promise.resolve(new Set()),
      restrictListEntries: () => Promise.resolve(new Set()),
    };
    const queries: AuthorizationQueryEngine = {
      check: () => Promise.resolve(true),
      listResourceIds: () => Promise.resolve([]),
      listPrincipalIds: () => Promise.resolve([]),
    };
    const lifecycle: ResourceAuthorizationLifecycle = {
      onResourceCreated: () => Promise.resolve(),
      onResourceDeleted: () => Promise.resolve(),
      onVisibilityChanged: () => Promise.resolve(),
    };
    let received: ComposedServices | undefined;
    const server = await compose([
      {
        name: "cloud-shaped",
        edition: ServerEdition.cloud,
        requireAuthentication: true,
        identityVerifiers: [verifier],
        authorizer,
        drivers: {
          platformTokenKeys: RING,
          listReadScope,
          authorizationQueries: queries,
          resourceAuthorizationLifecycle: lifecycle,
        },
      },
      {
        name: "consumer",
        onComposed: (composed) => {
          received = composed;
        },
      },
    ]);
    expect(received).toBeDefined();
    expect(received?.authorizer).toBe(authorizer);
    expect(received?.listReadScope).toBe(listReadScope);
    expect(received?.authorizationQueries).toBe(queries);
    expect(received?.resourceAuthorizationLifecycle).toBe(lifecycle);
    expect(received?.inProcessTransport).toBe(server.inProcessTransport);
  });

  it("under open source's own authorization hands the built-in Authorizer, list scope and policy check, and no lifecycle", async () => {
    let received: ComposedServices | undefined;
    await compose([
      enterpriseUnit({
        onComposed: (composed) => {
          received = composed;
        },
      }),
    ]);
    expect(received?.authorizer).toBeDefined();
    expect(received?.listReadScope).toBeDefined();
    expect(received?.authorizationQueries).toBeDefined();
    expect(received?.resourceAuthorizationLifecycle).toBeUndefined();
  });
});

describe("start: a unit's boot work runs before anything serves", () => {
  it("runs each unit's start in unit order, before the server reports SERVING", async () => {
    const seen: string[] = [];
    let server: ComposedServer | undefined;
    const observe = (unit: string) => (): Promise<void> => {
      seen.push(
        `${unit}:${HealthCheckResponse_ServingStatus[server?.healthState.status("") ?? HealthCheckResponse_ServingStatus.UNKNOWN]}`,
      );
      return Promise.resolve();
    };
    server = await compose([
      enterpriseUnit({ start: observe("first") }),
      { name: "second", start: observe("second") },
    ]);
    await server.start();
    expect(seen).toEqual(["first:NOT_SERVING", "second:NOT_SERVING"]);
    expect(server.healthState.status("")).toBe(
      HealthCheckResponse_ServingStatus.SERVING,
    );
  });

  it("a failing start fails the server's start, naming its unit, and the server never reports SERVING", async () => {
    const server = await compose([
      enterpriseUnit({
        start: () => Promise.reject(new Error("repair failed")),
      }),
    ]);
    await expect(server.start()).rejects.toThrowError(
      "extension 'enterprise-fixture' failed to start: repair failed",
    );
    expect(server.healthState.status("")).toBe(
      HealthCheckResponse_ServingStatus.NOT_SERVING,
    );
  });
});

describe("an edition above open source signs its callers in", () => {
  it.each([
    ["on open source's own authorizer", {}],
    [
      "with its own Authorizer",
      { authorizer: newPermissiveSingleTeamAuthorizer() },
    ],
  ])(
    "refuses to boot trusted-local %s",
    async (_label, extra: Partial<ServerExtension>) => {
      await expect(
        compose([
          {
            name: "signed-out-enterprise",
            edition: ServerEdition.enterprise,
            ...extra,
          },
        ]),
      ).rejects.toThrowError(
        "the composition serves edition 'enterprise' without the require-authentication posture — an edition above open source must sign its callers in: declare requireAuthentication on a unit that registers a verifier, or configure STIGMER_OIDC_ISSUER",
      );
    },
  );
});
