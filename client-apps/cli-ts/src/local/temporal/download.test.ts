import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { downloadTemporalCli, extractTarEntry } from "./download.js";

// Build a minimal ustar archive containing a single regular-file entry. Only
// the fields the reader uses (name, octal size, type flag) are populated.
function makeTar(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(content.length.toString(8).padStart(11, "0"), 124, "ascii");
  header.write("0", 156, "ascii");
  const data = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(data);
  const trailer = Buffer.alloc(1024); // two zero blocks end the archive
  return Buffer.concat([header, data, trailer]);
}

describe("extractTarEntry", () => {
  it("extracts a named regular file", () => {
    const payload = Buffer.from("#!/bin/sh\necho temporal\n");
    const tar = makeTar("temporal", payload);
    const out = extractTarEntry(new Uint8Array(tar), "temporal");
    expect(out).not.toBeNull();
    expect(Buffer.from(out!).toString("utf8")).toBe(payload.toString("utf8"));
  });

  it("matches by basename for nested entries", () => {
    const payload = Buffer.from("binary-bytes");
    const tar = makeTar("temporal_cli/temporal", payload);
    const out = extractTarEntry(new Uint8Array(tar), "temporal");
    expect(Buffer.from(out!).toString("utf8")).toBe("binary-bytes");
  });

  it("returns null when the entry is absent", () => {
    const tar = makeTar("something-else", Buffer.from("x"));
    expect(extractTarEntry(new Uint8Array(tar), "temporal")).toBeNull();
  });
});

describe("downloadTemporalCli", () => {
  it("downloads, gunzips, untars, and writes an executable binary", async () => {
    const payload = Buffer.from("the-temporal-binary");
    const gz = gzipSync(new Uint8Array(makeTar("temporal", payload)));
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
    })) as unknown as typeof fetch;

    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "bin", "temporal");
    await downloadTemporalCli({ version: "1.5.1", binPath, fetchImpl });

    expect(readFileSync(binPath, "utf8")).toBe("the-temporal-binary");
  });

  it("fails clearly on a non-OK response", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "temporal");
    await expect(downloadTemporalCli({ version: "9.9.9", binPath, fetchImpl })).rejects.toThrow(/HTTP 404/);
  });
});
