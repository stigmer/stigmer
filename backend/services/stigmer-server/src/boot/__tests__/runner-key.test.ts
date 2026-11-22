/**
 * Pins how the shared runner's key step (boot/runner-key.ts) fails when it
 * cannot make the `runner` service account, over a real store and faked
 * edges (the composed boots are runner-key.composed.test.ts's):
 *
 *   - a name already taken by an account this server did not make is a
 *     boot error naming it, on a store that never began making one;
 *   - under the `creating` mark, a taken name with no `runner` service
 *     account in the organization is the same boot error: there is nothing
 *     of the server's own to finish;
 *   - any other failure to make the account is the boot error as it came,
 *     and the mark stays `creating`, so the next start finishes the work.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";

import { generateApiKeyPlaintext } from "../../domain/apikey/keymaterial.js";
import { SERVER_RUNNER_ACCOUNT_KEY } from "../../domain/identityaccount/constants.js";
import { SqliteStore } from "../../store/sqlite/store.js";
import { createLogger } from "../logger.js";
import { ensureRunnerKey, RUNNER_ACCOUNT_CREATING } from "../runner-key.js";
import type { RunnerKeyBootDeps } from "../runner-key.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const TAKEN =
  'a service account named "runner" already exists that this server did not make: rename or delete it so the server can make the shared runner\'s own';

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "runner-key-unit-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), silentLogger);
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The step's deps, its account create failing with `failure` and the organization holding `accounts`. */
function depsOf(failure: Error, accounts: ReadonlyArray<IdentityAccount> = []): RunnerKeyBootDeps {
  return {
    plaintext: generateApiKeyPlaintext(),
    org: "org_1",
    store,
    accounts: { findByOrg: () => Promise.resolve(accounts) },
    edges: {
      createServiceAccount: () => Promise.reject(failure),
      deleteApiKey: () => Promise.reject(new Error("no key is deleted before the account exists")),
    },
    provisioner: {
      provision: () => Promise.reject(new Error("no key is stored before the account exists")),
    },
    logger: silentLogger,
  };
}

describe("the runner's account it cannot make", () => {
  it("is a boot error naming the account when another account holds the name", async () => {
    const taken = new ConnectError("service account name taken", Code.AlreadyExists);

    await expect(ensureRunnerKey(depsOf(taken))).rejects.toThrow(TAKEN);
  });

  it("is the same boot error under the creating mark when the organization holds no runner account to finish", async () => {
    await store.bootstrapState.set(SERVER_RUNNER_ACCOUNT_KEY, RUNNER_ACCOUNT_CREATING);
    const taken = new ConnectError("service account name taken", Code.AlreadyExists);

    await expect(ensureRunnerKey(depsOf(taken))).rejects.toThrow(TAKEN);
  });

  it("rethrows any other failure as it came, and leaves the creating mark for the next start", async () => {
    const down = new ConnectError("authorization backend unreachable", Code.Unavailable);

    await expect(ensureRunnerKey(depsOf(down))).rejects.toBe(down);
    expect(await store.bootstrapState.get(SERVER_RUNNER_ACCOUNT_KEY)).toBe(RUNNER_ACCOUNT_CREATING);
  });
});
