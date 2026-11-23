/**
 * Pins how the runner artifact lane (artifactstorage/runner-lane/lane.ts)
 * is composed and handed out, on a composed server with sign-in on:
 *
 *   - on the local store no lane is served, and
 *     `ComposedServer.runnerArtifactLane` is undefined;
 *   - on a store that can presign a runner's upload, the composed server
 *     hands out the handler, and it is the instance the unified port
 *     routes the two paths to: mounted on a second listener, as an edition
 *     serving `/v1/proxy` on a port of its own mounts it, it answers as
 *     the unified port does;
 *   - the composed never-runner classifier reaches the lane
 *     (`drivers.neverRunnerClassifier`): an identity it names is refused
 *     on both listeners, and the classifier was asked about that identity
 *     each time;
 *   - on the second listener a path that is not one of the two is a 404,
 *     where the unified port would have routed it elsewhere.
 *
 * The decision itself is pinned arm by arm in
 * artifactstorage/runner-lane/__tests__/authorize.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { PresignedRunnerUpload } from "../../artifactstorage/artifact-storage.js";
import { testUrlSigner } from "../../artifactstorage/__test-utils__/url-signer.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
} from "../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../extensions/registry.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { loadConfig } from "../config.js";

const UPLOAD = "/v1/proxy/artifacts/presigned-upload-url";
const DOWNLOAD = "/v1/proxy/artifacts/presigned-download-url";

/** A bucket-shaped store: the local driver's bytes, and a runner's upload URL. */
class PresigningStore extends LocalArtifactStorage {
  presignRunnerUpload(
    key: string,
    contentType: string,
  ): Promise<PresignedRunnerUpload> {
    return Promise.resolve({
      url: `https://bucket.test/${key}?put`,
      method: "PUT",
      headers: { "content-type": contentType },
    });
  }
}

const PRESIGNING = "presigning-double";

let server: ComposedServer | undefined;
let second: Server | undefined;
let dir: string | undefined;

afterEach(async () => {
  if (second !== undefined) {
    const closing = second;
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  }
  second = undefined;
  await server?.shutdown();
  server = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function boot(
  units: ReadonlyArray<ServerExtension>,
  env: Record<string, string> = {},
): Promise<number> {
  dir = mkdtempSync(path.join(tmpdir(), "runner-artifact-lane-"));
  server = await composeServer({
    config: loadConfig({ ...baseConfig(dir), ...env }),
    logger: silentLogger,
    extensions: units,
    portOverride: 0,
    host: "127.0.0.1",
  });
  return server.start();
}

async function ask(
  port: number,
  route: string,
  token: string,
): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ key: "artifacts/run_absent/out.txt" }),
  });
  await response.arrayBuffer();
  return response.status;
}

describe("the composed runner artifact lane", () => {
  it("is not served, and not handed out, on the local store", async () => {
    const port = await boot([
      {
        name: "fake-sign-in",
        requireAuthentication: true,
        identityVerifiers: [fakeVerifier],
      },
    ]);
    expect(server?.runnerArtifactLane).toBeUndefined();
    expect(
      await ask(port, UPLOAD, fakeJwt("person", "person@example.com")),
    ).toBe(404);
  });

  it("is handed out as the unified port's own instance, with the composed never-runner classifier inside it", async () => {
    const asked: string[] = [];
    const signer = testUrlSigner(Date.now);
    const port = await boot(
      [
        {
          name: "fake-edition",
          requireAuthentication: true,
          identityVerifiers: [fakeVerifier],
          drivers: {
            artifactStorageDrivers: new Map([
              [
                PRESIGNING,
                () =>
                  new PresigningStore(
                    path.join(dir ?? "", "bucket"),
                    "http://bucket.test",
                    signer,
                  ),
              ],
            ]),
            neverRunnerClassifier: {
              isNeverRunner: (caller) => {
                asked.push(caller.identityId);
                return caller.identityId === "judge";
              },
            },
          },
        },
      ],
      { ARTIFACT_STORAGE_TYPE: PRESIGNING },
    );
    const lane = server?.runnerArtifactLane;
    if (lane === undefined) {
      throw new Error("a presigning store composed no runner artifact lane");
    }
    const listener = createServer(lane);
    second = listener;
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const mounted = (listener.address() as AddressInfo).port;

    const judge = fakeJwt("judge", "judge@example.com");
    expect(await ask(port, UPLOAD, judge)).toBe(403);
    expect(await ask(mounted, UPLOAD, judge)).toBe(403);
    expect(await ask(mounted, DOWNLOAD, judge)).toBe(403);
    // One classifier instance behind both listeners: it heard all three.
    expect(asked).toEqual(["judge", "judge", "judge"]);

    // No credential the server recognizes is a 401 on both, as the lane answers it.
    expect(await ask(port, DOWNLOAD, "stranger")).toBe(401);
    expect(await ask(mounted, DOWNLOAD, "stranger")).toBe(401);

    // The handler guards its own paths where no router does it for it.
    expect(await ask(mounted, "/v1/proxy/artifacts", judge)).toBe(404);
    expect(await ask(mounted, "/v1/proxy/models", judge)).toBe(404);
    expect(asked).toHaveLength(3);
  });
});
