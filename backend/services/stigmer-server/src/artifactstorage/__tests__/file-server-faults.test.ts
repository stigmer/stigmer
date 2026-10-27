/**
 * Pins how the local download lane (file-server.ts) answers a file it
 * cannot read: a signed link whose stat fails for any reason but "missing"
 * (a permission refused, a disk error) is a 500 with a static body and one
 * server log naming the key and the error's code, so a client never takes
 * a broken artifact for a gone one (stigmer#1352). A key that is missing,
 * or that runs under a regular file, is still the 404 a missing key gets.
 *
 * The stat fault is stubbed through `node:fs/promises`, the real module
 * spread beneath it: a chmod cannot make a file unreadable to a CI runner
 * that runs as root.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { testUrlSigner } from "../__test-utils__/url-signer.js";
import { createLogger } from "../../boot/logger.js";
import { createArtifactFileServer } from "../file-server.js";
import type { ArtifactFileServer } from "../file-server.js";

/** The paths whose stat fails, and with which code. */
const faults = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    stat: (target: string, ...rest: unknown[]) => {
      const code = faults.get(String(target));
      if (code !== undefined) {
        return Promise.reject(Object.assign(new Error(`${code}: stat '${String(target)}'`), { code }));
      }
      return (real.stat as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
    },
  };
});

let dir: string;
let server: ArtifactFileServer | undefined;
let lines: string[];

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
  faults.clear();
  rmSync(dir, { recursive: true, force: true });
});

/** A lane over <tmp>/artifacts holding probe.txt, logging into `lines`. */
async function lane(): Promise<{ readonly url: (key: string) => string; readonly root: string }> {
  dir = mkdtempSync(path.join(tmpdir(), "artifact-file-server-faults-"));
  const root = path.join(dir, "artifacts");
  mkdirSync(root);
  writeFileSync(path.join(root, "probe.txt"), "probe-bytes\n");
  lines = [];
  const logger = createLogger({ level: "error", pretty: false, write: (line) => lines.push(line) });
  server = createArtifactFileServer({ basePath: root, signer: testUrlSigner(), logger });
  const port = await server.listen(0, "127.0.0.1");
  const signer = testUrlSigner();
  return {
    url: (key) => `http://127.0.0.1:${port}/${key}?${signer.signedQuery(key, 60_000, "")}`,
    root,
  };
}

describe("artifact file server, a file it cannot read", () => {
  it("answers 500 with a static body and logs the key and the error's code once", async () => {
    const { url, root } = await lane();
    faults.set(path.join(root, "probe.txt"), "EACCES");

    const response = await fetch(url("probe.txt"));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("500 internal server error\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("probe.txt");
    expect(lines[0]).toContain("EACCES");
  });

  it("still answers 404 for a missing key and for a key under a regular file", async () => {
    const { url } = await lane();
    expect((await fetch(url("nope.txt"))).status).toBe(404);
    expect((await fetch(url("probe.txt/inner"))).status).toBe(404);
    expect(lines).toEqual([]);
  });
});
