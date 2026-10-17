/**
 * The conformance suite's licensed Enterprise server
 * (test/conformance/licensed-server.ts), spawned as the suite spawns it:
 * `node --import tsx` over the file, from source.
 *
 *   - on an empty Postgres database it boots licensed: getServerInfo names
 *     the Enterprise edition, and getLicenseStatus answers `valid` with the
 *     claims and the key id of the license it signed for itself;
 *   - a STIGMER_LICENSE_KEY in the environment refuses the boot, so a real
 *     key never meets the test ring by configuration;
 *   - license terms it does not know, and a term that is not a whole number
 *     of at least its minimum, refuse the boot.
 *
 * The refusals come before the server reads its database and run
 * everywhere; the boot needs Postgres from TEST_DATABASE_URL (unset: skipped
 * by name outside a test gate). tsx is the repository root's, installed
 * before this package (ci.ee.yaml's order).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LicenseState } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import { PlatformQueryController, ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { OPERATOR_AUDIENCE, OPERATOR_ISSUER_NAME } from "./enterprise-harness.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTRY = path.join(PACKAGE_DIR, "test", "conformance", "licensed-server.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(path.join(PACKAGE_DIR, "..", "..", "package.json")).resolve("tsx"),
).href;

/** How long a boot may take to print its ready line or exit. */
const BOOT_DEADLINE_MS = 45_000;

interface Booted {
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * Spawns the entry with `env` in a scratch folder that is also its home (the
 * token key ladder keeps its key there); resolves on its ready line, rejects
 * with its output when it exits first.
 */
function spawnEntry(env: Readonly<Record<string, string>>): Promise<Booted> {
  const scratch = mkdtempSync(path.join(tmpdir(), "licensed-server-"));
  const child = spawn(process.execPath, ["--import", TSX_LOADER, ENTRY], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: scratch,
      STIGMER_LICENSE_KEY: "",
      STIGMER_TEST_LICENSE_TERMS: "",
      GRPC_PORT: "0",
      ARTIFACT_HTTP_PORT: "0",
      ARTIFACT_STORAGE_TYPE: "local",
      ARTIFACT_LOCAL_BASE_PATH: path.join(scratch, "artifacts"),
      STORAGE_PATH: path.join(scratch, "storage"),
      DB_PATH: path.join(scratch, "stigmer.db"),
      STIGMER_READY_LINE: "stdout",
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      LOG_LEVEL: "warn",
      ...env,
    },
  });
  let output = "";
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the licensed server printed no ready line in ${BOOT_DEADLINE_MS} ms:\n${output}`));
    }, BOOT_DEADLINE_MS);
    const read = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const ready = /\{"stigmerServerReady":\{"grpcPort":(\d+)/.exec(output);
      if (ready?.[1] !== undefined) {
        clearTimeout(deadline);
        resolve({
          port: Number(ready[1]),
          stop: () =>
            new Promise((stopped) => {
              child.once("close", () => {
                rmSync(scratch, { recursive: true, force: true });
                stopped();
              });
              child.kill("SIGTERM");
            }),
        });
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    // `close`, not `exit`: the refusal's line is read before the streams end.
    child.once("close", (code) => {
      clearTimeout(deadline);
      rmSync(scratch, { recursive: true, force: true });
      reject(new Error(`exit ${String(code)}:\n${output}`));
    });
  });
}

// Each refusal still loads tsx and the server before it refuses, so an arm
// outlasts the boot's deadline, not vitest's 5 s default.
describe("the conformance suite's licensed server refuses", () => {
  it("a STIGMER_LICENSE_KEY in its environment, naming the shipped entry", async () => {
    await expect(spawnEntry({ STIGMER_LICENSE_KEY: "a.real.key" })).rejects.toThrow(
      /^exit 1:\n[\s\S]*^boot failed: STIGMER_LICENSE_KEY is set, and this test server signs its own license.*dist\/main\.js/m,
    );
  }, BOOT_DEADLINE_MS + 5_000);

  it("license terms it does not know", async () => {
    await expect(spawnEntry({ STIGMER_TEST_LICENSE_TERMS: '{"seats":5}' })).rejects.toThrow(
      /^exit 1:\n[\s\S]*^boot failed: STIGMER_TEST_LICENSE_TERMS has an unknown field "seats"/m,
    );
  }, BOOT_DEADLINE_MS + 5_000);

  it.each([
    ["below its minimum", '{"maxOrgs":0}'],
    ["a fraction", '{"maxOrgs":1.5}'],
    ["a string", '{"maxOrgs":"5"}'],
  ])("a term that is not a whole number of at least its minimum: %s", async (_case, terms) => {
    await expect(spawnEntry({ STIGMER_TEST_LICENSE_TERMS: terms })).rejects.toThrow(
      /^exit 1:\n[\s\S]*^boot failed: STIGMER_TEST_LICENSE_TERMS\.maxOrgs must be a whole number of at least 1$/m,
    );
  }, BOOT_DEADLINE_MS + 5_000);
});

describe.skipIf(TEST_DATABASE_URL === undefined)("the conformance suite's licensed server", () => {
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: Booted;

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    // Unmigrated: the server makes its own schema current, as on a first install.
    db = await provisionEnterpriseDatabase({ migrate: false });
    booted = await spawnEntry({
      DATABASE_URL: db.databaseUrl,
      STIGMER_OIDC_ISSUER: issuer.issuerUrl(OPERATOR_ISSUER_NAME),
      STIGMER_OIDC_AUDIENCE: OPERATOR_AUDIENCE,
    });
  }, BOOT_DEADLINE_MS + 15_000);

  afterAll(async () => {
    await booted?.stop();
    await db?.drop();
    await issuer?.close();
  });

  it("boots licensed on an empty database: the Enterprise edition, and its own license valid", async () => {
    const platform = createClient(
      PlatformQueryController,
      createGrpcTransport({
        baseUrl: `http://127.0.0.1:${booted.port}`,
        interceptors: [
          (next) => async (request) => {
            request.header.set(
              "authorization",
              `Bearer ${issuer.mint(OPERATOR_ISSUER_NAME, { sub: "licensed-server-reader", aud: OPERATOR_AUDIENCE })}`,
            );
            return next(request);
          },
        ],
      }),
    );

    expect((await platform.getServerInfo({})).edition).toBe(ServerEdition.enterprise);
    const status = await platform.getLicenseStatus({});
    expect(status.state).toBe(LicenseState.valid);
    expect(status.claims?.entitlements?.limits?.maxOrgs, "no terms: no organization limit").toBeUndefined();
    expect(status.keyId).toBe("license-signing:test");
    expect(status.checkedAt).toBeDefined();
  });
});
