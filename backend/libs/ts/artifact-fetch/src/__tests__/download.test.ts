/**
 * Pins the verified download (`download.ts`) against a real loopback HTTP
 * server and Node's own fetch, the stack every consumer runs on: the bytes
 * reach the file only when the whole body matches its digest; a mismatch is
 * refused without a retry and leaves no file; a body cut short of its
 * advertised length is retried; a stop mid-body removes the file and throws
 * the stop's reason; progress counts the bytes against the advertised length.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseIntegrity, sha256Digest } from "../digest.js";
import { downloadToFile } from "../download.js";
import { ArtifactFetchError } from "../errors.js";

const PAYLOAD = randomBytes(300_000);
const INTEGRITY = parseIntegrity(`sha512-${createHash("sha512").update(PAYLOAD).digest("base64")}`);

type Route = (res: ServerResponse, hit: number) => void;
const routes = new Map<string, Route>();
const hits = new Map<string, number>();
let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    const route = routes.get(path);
    if (route === undefined) {
      res.writeHead(404).end();
      return;
    }
    route(res, hit);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  routes.clear();
  hits.clear();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  dir = mkdtempSync(join(tmpdir(), "artifact-fetch-download-"));
  return join(dir, "pkg.tgz");
}

const serve = (bytes: Buffer): Route => (res) => res.writeHead(200, { "content-length": String(bytes.length) }).end(bytes);
const noWait = async (): Promise<void> => {};

describe("downloadToFile", () => {
  it("writes the verified bytes and reports progress against the advertised length", async () => {
    routes.set("/pkg.tgz", serve(PAYLOAD));
    const dest = scratch();
    const progress: [number, number | undefined][] = [];
    const { bytes } = await downloadToFile({
      url: `${base}/pkg.tgz`,
      dest,
      expected: INTEGRITY,
      label: "pkg",
      onProgress: (received, total) => progress.push([received, total]),
    });
    expect(bytes).toBe(PAYLOAD.length);
    expect(readFileSync(dest).equals(PAYLOAD)).toBe(true);
    expect(progress.at(-1)).toEqual([PAYLOAD.length, PAYLOAD.length]);
    expect(progress.every(([, total]) => total === PAYLOAD.length)).toBe(true);
  });

  it("verifies a sha256 hex digest the same way", async () => {
    routes.set("/pkg.tgz", serve(PAYLOAD));
    const dest = scratch();
    await downloadToFile({ url: `${base}/pkg.tgz`, dest, expected: sha256Digest(createHash("sha256").update(PAYLOAD).digest("hex")), label: "pkg" });
    expect(readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });

  it("refuses bytes that do not match, once, and leaves no file behind", async () => {
    const other = Buffer.from(PAYLOAD);
    other[0] = (other[0] ?? 0) ^ 0xff;
    routes.set("/pkg.tgz", serve(other));
    const dest = scratch();
    writeFileSync(dest, "a stale copy");
    const err: unknown = await downloadToFile({ url: `${base}/pkg.tgz`, dest, expected: INTEGRITY, label: "pkg", sleep: noWait }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArtifactFetchError);
    expect((err as ArtifactFetchError).message).toBe("pkg checksum mismatch — refusing to use the download");
    expect((err as ArtifactFetchError).details[0]).toMatch(/^expected: sha512-/);
    expect((err as ArtifactFetchError).details[2]).toBe(`archive:  ${base}/pkg.tgz`);
    expect(hits.get("/pkg.tgz")).toBe(1);
    expect(existsSync(dest)).toBe(false);
  });

  it("retries a body cut short of its advertised length, then keeps the whole one", async () => {
    routes.set("/pkg.tgz", (res, hit) => {
      if (hit === 1) {
        res.writeHead(200, { "content-length": String(PAYLOAD.length) });
        res.write(PAYLOAD.subarray(0, 1000));
        res.destroy();
        return;
      }
      serve(PAYLOAD)(res, hit);
    });
    const dest = scratch();
    await downloadToFile({ url: `${base}/pkg.tgz`, dest, expected: INTEGRITY, label: "pkg", sleep: noWait });
    expect(hits.get("/pkg.tgz")).toBe(2);
    expect(readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });

  it("retries a 503 and takes a 404 as the answer, leaving no file", async () => {
    routes.set("/pkg.tgz", (res, hit) => (hit === 1 ? res.writeHead(503).end() : serve(PAYLOAD)(res, hit)));
    const dest = scratch();
    await downloadToFile({ url: `${base}/pkg.tgz`, dest, expected: INTEGRITY, label: "pkg", sleep: noWait });
    expect(hits.get("/pkg.tgz")).toBe(2);

    await expect(downloadToFile({ url: `${base}/gone.tgz`, dest, expected: INTEGRITY, label: "pkg", sleep: noWait })).rejects.toThrow(/HTTP 404/);
    expect(existsSync(dest)).toBe(false);
  });

  it("stops mid-body on its signal, throwing the reason and removing the file", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped by the person");
    routes.set("/pkg.tgz", (res) => {
      res.writeHead(200, { "content-length": String(PAYLOAD.length) });
      res.write(PAYLOAD.subarray(0, 65_536));
      // The rest never comes: the download waits until the stop.
    });
    const dest = scratch();
    const run = downloadToFile({
      url: `${base}/pkg.tgz`,
      dest,
      expected: INTEGRITY,
      label: "pkg",
      signal: controller.signal,
      onProgress: () => controller.abort(reason),
    });
    await expect(run).rejects.toBe(reason);
    expect(existsSync(dest)).toBe(false);
    expect(hits.get("/pkg.tgz")).toBe(1);
  });

  it("accepts a body with no advertised length and reports an unknown total", async () => {
    routes.set("/pkg.tgz", (res) => {
      res.writeHead(200, { "transfer-encoding": "chunked" });
      res.end(PAYLOAD);
    });
    const dest = scratch();
    const totals = new Set<number | undefined>();
    await downloadToFile({ url: `${base}/pkg.tgz`, dest, expected: INTEGRITY, label: "pkg", onProgress: (_r, total) => totals.add(total) });
    expect([...totals]).toEqual([undefined]);
    expect(readFileSync(dest).equals(PAYLOAD)).toBe(true);
  });
});
