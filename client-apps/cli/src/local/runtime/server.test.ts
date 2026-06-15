import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadServerBinary, ensureServerBinary } from "./server.js";

// Build a minimal ustar archive with a single regular-file entry.
function makeTar(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(content.length.toString(8).padStart(11, "0"), 124, "ascii");
  header.write("0", 156, "ascii");
  const data = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(data);
  const trailer = Buffer.alloc(1024);
  return Buffer.concat([header, data, trailer]);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// A fetch double that serves a gzipped tar for the archive URL and a
// shasum-format checksum for the `.sha256` URL. `corruptChecksum` flips the
// returned hash to exercise the verification failure path.
function fakeFetch(archiveGz: Uint8Array, opts: { corruptChecksum?: boolean; capturedUrls?: string[] } = {}): typeof fetch {
  const checksum = opts.corruptChecksum === true ? "0".repeat(64) : sha256(archiveGz);
  return (async (url: string) => {
    opts.capturedUrls?.push(url);
    if (url.endsWith(".sha256")) {
      return { ok: true, status: 200, text: async () => `${checksum}  archive.tar.gz\n` };
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => archiveGz.buffer.slice(archiveGz.byteOffset, archiveGz.byteOffset + archiveGz.byteLength),
    };
  }) as unknown as typeof fetch;
}

const TOUCHED = ["STIGMER_SERVER_BIN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of TOUCHED) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("downloadServerBinary", () => {
  it("downloads, verifies the checksum, extracts, and writes an executable", async () => {
    const payload = Buffer.from("the-stigmer-server-binary");
    const gz = gzipSync(new Uint8Array(makeTar("stigmer-server", payload)));
    const capturedUrls: string[] = [];
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-server-")), "bin", "stigmer-server");

    await downloadServerBinary({
      version: "0.5.0",
      binPath,
      platform: "darwin",
      arch: "arm64",
      fetchImpl: fakeFetch(gz, { capturedUrls }),
    });

    expect(readFileSync(binPath, "utf8")).toBe("the-stigmer-server-binary");
    expect(statSync(binPath).mode & 0o111).not.toBe(0); // executable
    expect(capturedUrls).toContain(
      "https://github.com/stigmer/stigmer/releases/download/v0.5.0/stigmer-server-v0.5.0-darwin-arm64.tar.gz",
    );
    expect(capturedUrls).toContain(
      "https://github.com/stigmer/stigmer/releases/download/v0.5.0/stigmer-server-v0.5.0-darwin-arm64.tar.gz.sha256",
    );
  });

  it("maps a prerelease version to its v-prefixed release tag", async () => {
    const gz = gzipSync(new Uint8Array(makeTar("stigmer-server", Buffer.from("x"))));
    const capturedUrls: string[] = [];
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-server-")), "stigmer-server");

    await downloadServerBinary({
      version: "0.5.0-rc.1",
      binPath,
      platform: "linux",
      arch: "x64",
      fetchImpl: fakeFetch(gz, { capturedUrls }),
    });

    expect(capturedUrls[0]).toBe(
      "https://github.com/stigmer/stigmer/releases/download/v0.5.0-rc.1/stigmer-server-v0.5.0-rc.1-linux-amd64.tar.gz",
    );
  });

  it("refuses a mismatched checksum", async () => {
    const gz = gzipSync(new Uint8Array(makeTar("stigmer-server", Buffer.from("x"))));
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-server-")), "stigmer-server");
    await expect(
      downloadServerBinary({
        version: "0.5.0",
        binPath,
        platform: "darwin",
        arch: "arm64",
        fetchImpl: fakeFetch(gz, { corruptChecksum: true }),
      }),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("fails clearly on a non-OK archive response", async () => {
    const fetchImpl = (async (url: string) => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
    })) as unknown as typeof fetch;
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-server-")), "stigmer-server");
    await expect(
      downloadServerBinary({ version: "9.9.9", binPath, platform: "darwin", arch: "arm64", fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("refuses an unsupported platform with actionable guidance", async () => {
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-server-")), "stigmer-server");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      downloadServerBinary({ version: "0.5.0", binPath, platform: "win32", arch: "x64", fetchImpl }),
    ).rejects.toThrow(/does not support this platform/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ensureServerBinary", () => {
  it("returns an existing override binary without downloading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-server-"));
    const bin = join(dir, "stigmer-server");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.STIGMER_SERVER_BIN = bin;

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const resolved = await ensureServerBinary({ home: dir, version: "0.5.0", fetchImpl });

    expect(resolved).toBe(bin);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
