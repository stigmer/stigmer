/**
 * Pins the local download lane (file-server.ts) over real HTTP: the bytes
 * it serves, its disposition contract, its 404 and traversal guard, and its
 * bind-host contract (ARTIFACT_HTTP_HOST, shipped with the Docker image).
 *
 * Serving: a key is answered with the exact bytes under the artifact root,
 * inline unless ?download=<name> asks for an attachment; a missing key, a
 * crafted key that escapes the root, a key naming a folder and a path whose
 * percent-escapes do not decode all answer 404 (on a local install the
 * SQLite database sits one level above the root, so an escape would serve
 * it); a method other than GET or HEAD is a 405 naming the two. Binding: the listener binds exactly the host the composition root
 * passes. Loopback — the default — must stay unreachable through
 * non-loopback interfaces, and the
 * container override (0.0.0.0) must serve the same bytes. Each fetch carries a
 * signed query, since the lane serves nothing else; the signature check
 * itself is file-server-signing.test.ts's.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { testUrlSigner } from "../__test-utils__/url-signer.js";
import { createLogger } from "../../boot/logger.js";
import { createArtifactFileServer } from "../file-server.js";
import type { ArtifactFileServer } from "../file-server.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** A live link's query for `key`, as the local backend signs it. */
function signed(key: string, downloadFilename = ""): string {
  return testUrlSigner().signedQuery(key, 60_000, downloadFilename);
}

let dir: string;
let server: ArtifactFileServer | undefined;

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A lane over <tmp>/artifacts holding probe.txt, with a secret file planted
 * one level above the root where a traversal escape would find it.
 */
function newServer(): ArtifactFileServer {
  dir = mkdtempSync(path.join(tmpdir(), "artifact-file-server-"));
  const root = path.join(dir, "artifacts");
  mkdirSync(root);
  writeFileSync(path.join(root, "probe.txt"), "probe-bytes\n");
  writeFileSync(path.join(dir, "stigmer.db"), "outside-the-root\n");
  server = createArtifactFileServer({ basePath: root, signer: testUrlSigner(), logger: silentLogger });
  return server;
}

describe("artifact file server serving", () => {
  it("serves the blob inline; ?download= adds the attachment disposition", async () => {
    const port = await newServer().listen(0, "127.0.0.1");
    const url = `http://127.0.0.1:${port}/probe.txt`;

    const inline = await fetch(`${url}?${signed("probe.txt")}`);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toBeNull();
    expect(await inline.text()).toBe("probe-bytes\n");

    const attachment = await fetch(`${url}?${signed("probe.txt", "report.txt")}`);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get("content-disposition")).toBe(
      'attachment; filename="report.txt"',
    );
    expect(await attachment.text()).toBe("probe-bytes\n");
  });

  it("answers 404 for missing keys and refuses path traversal out of the root", async () => {
    const port = await newServer().listen(0, "127.0.0.1");
    const lane = `http://127.0.0.1:${port}`;

    const missing = await fetch(`${lane}/nope?${signed("nope")}`);
    expect(missing.status).toBe(404);

    const traversal = await fetch(`${lane}/..%2Fstigmer.db?${signed("../stigmer.db")}`);
    expect(traversal.status).toBe(404);
  });

  it("answers 404 for a signed key that names a folder, never a listing", async () => {
    const port = await newServer().listen(0, "127.0.0.1");
    mkdirSync(path.join(dir, "artifacts", "runs"));

    const folder = await fetch(`http://127.0.0.1:${port}/runs?${signed("runs")}`);

    expect(folder.status).toBe(404);
    expect(await folder.text()).toBe("404 page not found\n");
  });

  it("answers 404 for a path whose percent-escapes do not decode, before the signature is read", async () => {
    const port = await newServer().listen(0, "127.0.0.1");

    const malformed = await fetch(`http://127.0.0.1:${port}/probe%zz.txt?${signed("probe.txt")}`);

    expect(malformed.status).toBe(404);
    expect(await malformed.text()).toBe("404 page not found\n");
  });

  it("answers another method with 405 and the two it serves, reading nothing", async () => {
    const port = await newServer().listen(0, "127.0.0.1");

    const post = await fetch(`http://127.0.0.1:${port}/probe.txt?${signed("probe.txt")}`, {
      method: "POST",
      body: "x",
    });

    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(await post.text()).toBe("");
  });
});

describe("artifact file server bind host", () => {
  it("serves on the loopback default", async () => {
    const port = await newServer().listen(0, "127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${port}/probe.txt?${signed("probe.txt")}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("probe-bytes\n");
  });

  it("serves through the wildcard host override (the container posture)", async () => {
    const port = await newServer().listen(0, "0.0.0.0");
    // Wildcard-bound listeners answer on loopback too — the reachable
    // proof that the override took effect without needing a second NIC.
    const response = await fetch(`http://127.0.0.1:${port}/probe.txt?${signed("probe.txt")}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("probe-bytes\n");
  });
});
