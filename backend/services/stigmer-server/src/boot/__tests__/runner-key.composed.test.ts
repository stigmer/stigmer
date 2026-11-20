/**
 * Pins the shared runner's key at boot (boot/runner-key.ts), on a composed
 * open-source server with sign-in on, booted on one store three times:
 *
 *   - the first start stores STIGMER_RUNNER_API_KEY as the key of the
 *     organization's one `runner` service account, and the key reads the
 *     server's organization at once (the runner starts signed in);
 *   - a second start with the same key changes nothing;
 *   - a start with another key deletes the old one (it is refused) and the
 *     new one works;
 *   - a key that is not an `stk_` key is a boot error naming the variable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";

import { generateApiKeyPlaintext } from "../../domain/apikey/keymaterial.js";
import { SINGLE_ORG_KEY } from "../../domain/organization/limit.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  transportFor,
} from "../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../extensions/registry.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";

// One organization, as the open-source edition declares (editions/open-source.ts).
const signIn: ServerExtension = {
  name: "fake-sign-in",
  orgLimit: 1,
  requireAuthentication: true,
  identityVerifiers: [fakeVerifier],
};

interface Started {
  readonly server: ComposedServer;
  readonly port: number;
  readonly messages: string[];
}

let dir: string;

async function start(key: string): Promise<Started> {
  const messages: string[] = [];
  const server = await composeServer({
    config: loadConfig({ ...baseConfig(dir), STIGMER_RUNNER_API_KEY: key }),
    logger: createLogger({
      level: "info",
      pretty: false,
      write: (line) => {
        messages.push(String((JSON.parse(line) as { message?: unknown }).message ?? ""));
      },
    }),
    extensions: [signIn],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  return { server, port, messages };
}

/** The server's organization, read with `key` as the runner reads with its own. */
async function readOrganizationWith(at: Started, key: string, org: string): Promise<string> {
  const read = await createClient(OrganizationQueryController, transportFor(at.port, key)).get({
    value: org,
  });
  return read.metadata?.id ?? "";
}

async function serverOrganization(at: Started): Promise<string> {
  const org = await at.server.store.bootstrapState.get(SINGLE_ORG_KEY);
  if (org === undefined) {
    throw new Error("the server holds no single organization");
  }
  return org;
}

/** The names of the organization's service accounts, as its first person (its owner) lists them. */
async function serviceAccountNames(at: Started, org: string): Promise<string[]> {
  const owner = transportFor(at.port, fakeJwt("owner", "owner@example.com"));
  await createClient(IdentityAccountCommandController, owner).provisionMyAccount({});
  const listed = await createClient(IdentityAccountQueryController, owner).listServiceAccounts({
    org,
  });
  return listed.entries.map((account) => account.metadata?.name ?? "");
}

describe("the shared runner's key at boot", () => {
  const first = generateApiKeyPlaintext();
  const second = generateApiKeyPlaintext();

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "runner-key-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores the key as the runner service account's, and it works on the first call", async () => {
    const at = await start(first);
    try {
      const org = await serverOrganization(at);
      expect(at.messages).toContain("the shared runner's key is stored; the runner signs in with it");
      expect(await readOrganizationWith(at, first, org)).toBe(org);

      expect(await serviceAccountNames(at, org)).toEqual(["runner"]);
    } finally {
      await at.server.shutdown();
    }
  });

  it("changes nothing when the same key starts the server again", async () => {
    const at = await start(first);
    try {
      expect(at.messages).toContain("the shared runner's key is in place");
    } finally {
      await at.server.shutdown();
    }
  });

  it("replaces the key: the old one is refused, the new one works", async () => {
    const at = await start(second);
    try {
      const org = await serverOrganization(at);
      expect(at.messages).toContain(
        "the shared runner's key changed: the old key is deleted and the new one stored",
      );
      expect(await readOrganizationWith(at, second, org)).toBe(org);
      await expect(readOrganizationWith(at, first, org)).rejects.toSatisfy(
        (error: unknown) => error instanceof ConnectError && error.code === Code.Unauthenticated,
      );
    } finally {
      await at.server.shutdown();
    }
  });

  it("refuses a value that is not an stk_ key at boot, naming the variable", () => {
    expect(() =>
      loadConfig({ ...baseConfig(dir), STIGMER_RUNNER_API_KEY: "runner-secret" }),
    ).toThrow(/STIGMER_RUNNER_API_KEY is not an stk_ key/);
  });
});
