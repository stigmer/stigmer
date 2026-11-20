/**
 * Pins local artifact storage's download lane on the unified port
 * (file-server.ts, createArtifactDownloadLane): a server reached at one
 * hostname mints its links under `<origin>/artifacts`, and the lane serves
 * them there. Driven through the unified port's own lane router
 * (transport/server.ts), so the prefix is proven to win over the console
 * and the RPC adapter:
 *
 *   - a live link minted under the prefix serves its bytes, as the named
 *     download it carries;
 *   - an unsigned link under the prefix is answered as a missing key;
 *   - the same key without the prefix never reaches the lane (the adapter's
 *     404), so a key cannot meet a console route.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalArtifactStorage } from "../artifact-storage.js";
import { testUrlSigner } from "../__test-utils__/url-signer.js";
import { createLogger } from "../../boot/logger.js";
import { createArtifactDownloadLane } from "../file-server.js";
import { createUnifiedPortServer } from "../../transport/server.js";
import type { UnifiedPortServer } from "../../transport/server.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const KEY = "attachments/01LANE/notes.txt";
const BODY = "one-host-bytes\n";
const HOUR_MS = 3_600_000;

let dir: string;
let server: UnifiedPortServer;
let storage: LocalArtifactStorage;
let origin: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "artifact-unified-lane-"));
  const signer = testUrlSigner(() => Date.UTC(2026, 10, 20, 9, 0, 0));
  server = createUnifiedPortServer({
    logger: silentLogger,
    routes: () => {},
    interceptors: [],
    modelRegistryLane: (_request, response) => {
      response.statusCode = 418;
      response.end();
    },
    artifactDownloadLane: createArtifactDownloadLane({ basePath: dir, signer, logger: silentLogger }),
  });
  const port = await server.listen(0, "127.0.0.1");
  origin = `http://127.0.0.1:${port}`;
  storage = new LocalArtifactStorage(dir, `${origin}/artifacts`, signer);
  await storage.upload(KEY, Buffer.from(BODY), "text/plain");
});

afterEach(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

describe("the download lane under /artifacts/ on the unified port", () => {
  it("serves a link minted under the prefix, as its named download", async () => {
    const link = await storage.getSignedUrl(KEY, HOUR_MS, "notes.txt", "person");
    expect(new URL(link).pathname.startsWith("/artifacts/")).toBe(true);

    const response = await fetch(link);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="notes.txt"');
    expect(await response.text()).toBe(BODY);
  });

  it("answers an unsigned link under the prefix as a missing key", async () => {
    const minted = new URL(await storage.getSignedUrl(KEY, HOUR_MS, "", "person"));

    const response = await fetch(`${minted.origin}${minted.pathname}`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 page not found\n");
  });

  it("never serves the key outside the prefix", async () => {
    const minted = new URL(await storage.getSignedUrl(KEY, HOUR_MS, "", "person"));
    const outside = `${minted.origin}${minted.pathname.replace(/^\/artifacts/, "")}${minted.search}`;

    const response = await fetch(outside);

    expect(response.status).not.toBe(200);
  });
});
