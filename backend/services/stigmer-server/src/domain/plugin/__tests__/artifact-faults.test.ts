/**
 * Pins the fault answers of the plugin archive pair (getArtifact,
 * getArtifactDownloadUrl), which the runner mounts an agent's hooks from:
 * a server with no transfer lane answers FailedPrecondition with the lane's
 * copy; a lane that cannot mint, or a store that fails for any reason but a
 * missing archive, is an infrastructure fault answered as a sanitized
 * Internal, never a NotFound that tells the runner the archive does not
 * exist. The composed suites reach only a working lane and store, so these
 * run on an in-process router over ports that fail on demand.
 */
import type { Client, ConnectError } from "@connectrpc/connect";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";

import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { createLogger } from "../../../boot/logger.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { createVerifierChainInterceptor } from "../../../pipeline/interceptors/auth.js";
import { errorOf, failingStore, untouchable } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { ArchiveStaging } from "../../skill/transfer/staging.js";

import { TRANSFER_LANE_NOT_CONFIGURED } from "../constants.js";
import { registerPluginServices } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const KEY = `plugins/${"a".repeat(64)}.zip`;
const DISK_FULL = (): Error => new Error("EIO: i/o error, read");

/** An archive store whose every read fails with `fault`. */
function failingArchives(fault: () => Error): ContentAddressedArchiveStore {
  return {
    store: () => Promise.reject(fault()),
    get: () => Promise.reject(fault()),
    exists: () => Promise.reject(fault()),
    getStorageKey: (hash) => `plugins/${hash}.zip`,
    size: () => Promise.reject(fault()),
  };
}

/** An archive store that holds every key, one byte each. */
const presentArchives: ContentAddressedArchiveStore = {
  store: (hash) => Promise.resolve(`plugins/${hash}.zip`),
  get: () => Promise.resolve(new Uint8Array([1])),
  exists: () => Promise.resolve(true),
  getStorageKey: (hash) => `plugins/${hash}.zip`,
  size: () => Promise.resolve(1),
};

function pluginQuery(artifactStorage: ContentAddressedArchiveStore, staging?: ArchiveStaging): Client<typeof PluginQueryController> {
  const transport = createRouterTransport(
    (router) => {
      registerPluginServices(router, {
        store: failingStore(new Error("the store is not read")),
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        artifactStorage,
        outboundFetch: () => Promise.reject(new Error("no install here")),
        tools: untouchable("tools"),
        ...(staging !== undefined ? { staging } : {}),
      });
    },
    {
      router: {
        interceptors: [createVerifierChainInterceptor([], [], silentLogger), createApiResourceInterceptor()],
      },
    },
  );
  return createClient(PluginQueryController, transport);
}

const failingLane: ArchiveStaging = {
  mint: () => Promise.reject(new Error("not used")),
  consume: () => Promise.reject(new Error("not used")),
  downloadUrl: () => Promise.reject(new Error("bucket unreachable")),
};

describe("the plugin archive pair under faults", () => {
  it("answers FailedPrecondition when the server has no transfer lane", async () => {
    const error: ConnectError = await errorOf(() => pluginQuery(presentArchives).getArtifactDownloadUrl({ artifactStorageKey: KEY }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(TRANSFER_LANE_NOT_CONFIGURED);
  });

  it("answers Internal when the lane cannot mint a URL", async () => {
    const error: ConnectError = await errorOf(() => pluginQuery(presentArchives, failingLane).getArtifactDownloadUrl({ artifactStorageKey: KEY }));
    expect(error.code).toBe(Code.Internal);
  });

  it("answers Internal, never NotFound, when the store fails", async () => {
    const read: ConnectError = await errorOf(() => pluginQuery(failingArchives(DISK_FULL)).getArtifact({ artifactStorageKey: KEY }));
    expect(read.code).toBe(Code.Internal);
    const stat: ConnectError = await errorOf(() =>
      pluginQuery(failingArchives(DISK_FULL), failingLane).getArtifactDownloadUrl({ artifactStorageKey: KEY }),
    );
    expect(stat.code).toBe(Code.Internal);
  });
});
