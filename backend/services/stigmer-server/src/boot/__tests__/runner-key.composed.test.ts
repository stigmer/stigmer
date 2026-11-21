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
 *   - a key another account already holds (a person made it for the runner
 *     before the runner started signed in) is left there with a warning,
 *     the server starts, and both keys keep working;
 *   - a start that stopped between making the `runner` account and
 *     recording it is finished by the next start, which records that
 *     account and stores the key on it;
 *   - a key that is not an `stk_` key is a boot error naming the variable.
 *
 * And where the key is never stored, the server says why and starts:
 *
 *   - a server composed to hold any number of organizations warns that it
 *     never makes the shared runner a key of its own;
 *   - a one-organization server whose store holds several (made while it
 *     held any number) warns that it holds no single organization yet;
 *   - a server with sign-in off says the runner needs no key.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyCommandController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { generateApiKeyPlaintext } from "../../domain/apikey/keymaterial.js";
import { keysOwnedBy } from "../../domain/apikey/queries.js";
import { SERVER_RUNNER_ACCOUNT_KEY } from "../../domain/identityaccount/constants.js";
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
import { RUNNER_ACCOUNT_CREATING } from "../runner-key.js";

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

async function start(
  key: string,
  units: ReadonlyArray<ServerExtension> = [signIn],
  at: string = dir,
): Promise<Started> {
  const messages: string[] = [];
  const server = await composeServer({
    config: loadConfig({ ...baseConfig(at), STIGMER_RUNNER_API_KEY: key }),
    logger: createLogger({
      level: "info",
      pretty: false,
      write: (line) => {
        messages.push(String((JSON.parse(line) as { message?: unknown }).message ?? ""));
      },
    }),
    extensions: units,
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

  it("leaves a key another account holds where it is, starts, and both keys keep working", async () => {
    let held: string;
    let org: string;
    const before = await start(second);
    try {
      org = await serverOrganization(before);
      const owner = transportFor(before.port, fakeJwt("owner", "owner@example.com"));
      await createClient(IdentityAccountCommandController, owner).provisionMyAccount({});
      const ci = await createClient(IdentityAccountCommandController, owner).createServiceAccount({
        org,
        name: "ci",
        role: IamRole.admin,
      });
      const minted = await createClient(ApiKeyCommandController, owner).createForServiceAccount({
        serviceAccountId: ci.metadata?.id ?? "",
        name: "made-by-a-person",
        neverExpires: true,
      });
      held = minted.spec?.keyHash ?? "";
    } finally {
      await before.server.shutdown();
    }
    const at = await start(held);
    try {
      expect(at.messages.some((m) => m.startsWith("STIGMER_RUNNER_API_KEY is already the key of another account, so the server leaves it there"))).toBe(true);
      expect(await readOrganizationWith(at, held, org)).toBe(org);
      expect(await readOrganizationWith(at, second, org)).toBe(org);
    } finally {
      await at.server.shutdown();
    }
  });

  it("finishes a start that made the runner's account and stopped before recording it", async () => {
    const third = generateApiKeyPlaintext();
    const before = await start(second);
    try {
      const store = before.server.store;
      const runner = await store.bootstrapState.get(SERVER_RUNNER_ACCOUNT_KEY);
      const owner = transportFor(before.port, fakeJwt("owner", "owner@example.com"));
      await createClient(IdentityAccountCommandController, owner).provisionMyAccount({});
      for (const key of await keysOwnedBy(store, [runner])) {
        await createClient(ApiKeyCommandController, owner).delete({ value: key.metadata?.id ?? "" });
      }
      await store.bootstrapState.set(SERVER_RUNNER_ACCOUNT_KEY, RUNNER_ACCOUNT_CREATING);
    } finally {
      await before.server.shutdown();
    }
    const at = await start(third);
    try {
      const org = await serverOrganization(at);
      expect(at.messages).toContain(
        "an earlier start made the shared runner's account and stopped before recording it; it is recorded now",
      );
      expect(at.messages).toContain("the shared runner's key is stored; the runner signs in with it");
      expect(await readOrganizationWith(at, third, org)).toBe(org);
      expect((await serviceAccountNames(at, org)).filter((name) => name === "runner")).toHaveLength(1);
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

describe("the shared runner's key where the server never stores it", () => {
  // The same sign-in, composed to hold any number of organizations.
  const anyNumber: ServerExtension = {
    name: "fake-sign-in-any-number",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };
  const key = generateApiKeyPlaintext();
  let own: string;

  beforeAll(() => {
    own = mkdtempSync(path.join(tmpdir(), "runner-key-unstored-"));
  });

  afterAll(() => {
    rmSync(own, { recursive: true, force: true });
  });

  it("warns on a server of any number of organizations, and makes no runner account", async () => {
    const at = await start(key, [anyNumber], own);
    try {
      expect(at.messages).toContain(
        "STIGMER_RUNNER_API_KEY is not stored: the server holds several organizations, so it never makes the shared runner a key of its own; the runner keeps the key it is handed (STIGMER_TOKEN)",
      );
      expect(await at.server.store.bootstrapState.get(SERVER_RUNNER_ACCOUNT_KEY)).toBe("");

      // Two organizations, as people make them on such a server.
      const person = transportFor(at.port, fakeJwt("person", "person@example.com"));
      await createClient(IdentityAccountCommandController, person).provisionMyAccount({});
      for (const slug of ["acme", "globex"]) {
        await createClient(OrganizationCommandController, person).create({
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { name: slug, slug, org: "" },
          spec: { description: slug },
        });
      }
    } finally {
      await at.server.shutdown();
    }
  });

  it("warns on a one-organization server whose store holds several, and starts without storing it", async () => {
    const at = await start(key, [signIn], own);
    try {
      expect(at.messages).toContain(
        "STIGMER_RUNNER_API_KEY is set but the server holds no single organization yet, so the runner's key is not stored this start",
      );
      expect(await at.server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
      expect(await at.server.store.bootstrapState.get(SERVER_RUNNER_ACCOUNT_KEY)).toBe("");
    } finally {
      await at.server.shutdown();
    }
  });

  it("says the key is ignored when sign-in is off", async () => {
    const trusted = mkdtempSync(path.join(tmpdir(), "runner-key-trusted-"));
    try {
      const at = await start(key, [], trusted);
      try {
        expect(at.messages).toContain(
          "STIGMER_RUNNER_API_KEY is ignored: sign-in is off, so the runner needs no key",
        );
        expect(await at.server.store.bootstrapState.get(SERVER_RUNNER_ACCOUNT_KEY)).toBe("");
      } finally {
        await at.server.shutdown();
      }
    } finally {
      rmSync(trusted, { recursive: true, force: true });
    }
  });
});
