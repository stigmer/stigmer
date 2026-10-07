/**
 * Pins the artifact file server's signature check against links the local
 * backend really mints (LocalArtifactStorage.getSignedUrl over the same
 * signer): a live link serves its bytes, inline or as the named download;
 * an unsigned, tampered, expired or re-targeted link, a filename swapped
 * onto a link, and a link signed by another key are each answered exactly
 * as a missing key is (404, the same body), so a refusal reveals nothing
 * about what exists. The clock is the signer's, pinned, so an expiry is
 * crossed by moving it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalArtifactStorage } from "../artifact-storage.js";
import { DownloadUrlSigner } from "../url-signer.js";
import { testUrlSigner } from "../__test-utils__/url-signer.js";
import { createLogger } from "../../boot/logger.js";
import { createArtifactFileServer } from "../file-server.js";
import type { ArtifactFileServer } from "../file-server.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const NOT_FOUND = "404 page not found\n";
const KEY = "attachments/01SIGN/report #1.txt";
const BODY = "signed-bytes\n";
const HOUR_MS = 3_600_000;

let dir: string;
let now: number;
let server: ArtifactFileServer;
let storage: LocalArtifactStorage;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "artifact-file-server-signing-"));
  now = Date.UTC(2026, 9, 7, 12, 0, 0);
  const signer = testUrlSigner(() => now);
  server = createArtifactFileServer({ basePath: dir, signer, logger: silentLogger });
  const port = await server.listen(0, "127.0.0.1");
  storage = new LocalArtifactStorage(dir, `http://127.0.0.1:${port}`, signer);
  await storage.upload(KEY, Buffer.from(BODY), "text/plain");
});

afterEach(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function expectNotFound(url: string, method = "GET"): Promise<void> {
  const response = await fetch(url, { method });
  expect(response.status, url).toBe(404);
  if (method === "GET") {
    expect(await response.text()).toBe(NOT_FOUND);
  }
}

describe("artifact file server signed links", () => {
  it("serves a live link inline, and as the named download it was minted with", async () => {
    const inline = await fetch(await storage.getSignedUrl(KEY, HOUR_MS, "", "person"));
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toBeNull();
    expect(await inline.text()).toBe(BODY);

    const named = await fetch(await storage.getSignedUrl(KEY, HOUR_MS, "report.txt", "person"));
    expect(named.status).toBe(200);
    expect(named.headers.get("content-disposition")).toBe('attachment; filename="report.txt"');
    expect(await named.text()).toBe(BODY);
  });

  it("answers an unsigned link, and a HEAD of one, as it answers a missing key", async () => {
    const minted = new URL(await storage.getSignedUrl(KEY, HOUR_MS, "", "person"));
    const unsigned = `${minted.origin}${minted.pathname}`;
    await expectNotFound(unsigned);
    await expectNotFound(unsigned, "HEAD");
    await expectNotFound(await storage.getSignedUrl("attachments/01SIGN/missing.txt", HOUR_MS, "", "person"));
  });

  it("refuses a tampered signature, a re-targeted key and a swapped filename", async () => {
    const minted = new URL(await storage.getSignedUrl(KEY, HOUR_MS, "", "person"));

    const tampered = new URL(minted);
    const sig = tampered.searchParams.get("sig") ?? "";
    tampered.searchParams.set("sig", `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`);
    await expectNotFound(tampered.toString());

    await storage.upload("attachments/01SIGN/other.txt", Buffer.from("other"), "text/plain");
    const retargeted = new URL(minted);
    retargeted.pathname = "/attachments/01SIGN/other.txt";
    await expectNotFound(retargeted.toString());

    const swapped = new URL(minted);
    swapped.searchParams.set("download", "invoice.exe");
    await expectNotFound(swapped.toString());

    const extended = new URL(minted);
    extended.searchParams.set("exp", String(Number(extended.searchParams.get("exp")) + 86_400));
    await expectNotFound(extended.toString());
  });

  it("refuses a link once its expiry has passed", async () => {
    const url = await storage.getSignedUrl(KEY, HOUR_MS, "", "person");
    now += HOUR_MS - 1000;
    expect((await fetch(url)).status).toBe(200);
    now += 1000;
    await expectNotFound(url);
  });

  it("refuses a link another key signed", async () => {
    const foreign = new LocalArtifactStorage(
      dir,
      new URL(await storage.getSignedUrl(KEY, HOUR_MS, "", "person")).origin,
      new DownloadUrlSigner(Buffer.alloc(32, 9), () => now),
    );
    await expectNotFound(await foreign.getSignedUrl(KEY, HOUR_MS, "", "person"));
  });
});
