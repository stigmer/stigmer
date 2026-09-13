import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  TEMPORAL_CHECKSUMS_FILE,
  downloadTemporalCli,
  extractTarEntry,
  temporalArchiveName,
  temporalReleaseAssetUrl,
} from "./download.js";

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

// A release as GitHub serves it: the archive for the requested platform plus a
// release-wide checksums.txt listing every asset. `fetchImpl` routes by URL so
// the checksum arm is exercised against a realistic multi-line file.
function release(version: string, archives: Record<string, Buffer>, checksums: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const name = url.slice(url.lastIndexOf("/") + 1);
    if (name === TEMPORAL_CHECKSUMS_FILE) {
      return { ok: true, status: 200, text: async () => checksums } as unknown as Response;
    }
    const gz = archives[name];
    if (gz === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function archiveFor(payload: Buffer): Buffer {
  return Buffer.from(gzipSync(new Uint8Array(makeTar("temporal", payload))));
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("downloadTemporalCli", () => {
  const linuxArm = temporalArchiveName("1.5.1", "linux", "arm64");
  const linuxAmd = temporalArchiveName("1.5.1", "linux", "x64");

  it("names the release assets the way Temporal publishes them", () => {
    expect(linuxArm).toBe("temporal_cli_1.5.1_linux_arm64.tar.gz");
    expect(linuxAmd).toBe("temporal_cli_1.5.1_linux_amd64.tar.gz");
    expect(temporalArchiveName("1.5.1", "darwin", "arm64")).toBe("temporal_cli_1.5.1_darwin_arm64.tar.gz");
    expect(temporalReleaseAssetUrl("1.5.1", TEMPORAL_CHECKSUMS_FILE)).toBe(
      "https://github.com/temporalio/cli/releases/download/v1.5.1/checksums.txt",
    );
  });

  it("downloads, verifies against the matching checksums.txt line, gunzips, untars, and writes the binary", async () => {
    const arm = archiveFor(Buffer.from("the-arm64-binary"));
    const amd = archiveFor(Buffer.from("the-amd64-binary"));
    // amd64 listed FIRST: a first-token parser would verify arm64 against it.
    const checksums = `${sha256(amd)}  ${linuxAmd}\n${sha256(arm)}  ${linuxArm}\n`;
    const fetchImpl = release("1.5.1", { [linuxArm]: arm, [linuxAmd]: amd }, checksums);

    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "bin", "temporal");
    await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl });

    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
  });

  it("refuses an archive whose digest does not match its checksums.txt line", async () => {
    const arm = archiveFor(Buffer.from("tampered"));
    const checksums = `${"0".repeat(64)}  ${linuxArm}\n`;
    const fetchImpl = release("1.5.1", { [linuxArm]: arm }, checksums);

    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "temporal");
    await expect(
      downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl }),
    ).rejects.toThrow(/checksum mismatch/);
    expect(existsSync(binPath)).toBe(false);
  });

  it("refuses an archive the checksums.txt has no entry for", async () => {
    const arm = archiveFor(Buffer.from("unlisted"));
    const checksums = `${sha256(arm)}  some_other_asset.tar.gz\n`;
    const fetchImpl = release("1.5.1", { [linuxArm]: arm }, checksums);

    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "temporal");
    await expect(
      downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl }),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("fails clearly on a non-OK response", async () => {
    const fetchImpl = release("9.9.9", {}, "");
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "temporal");
    await expect(downloadTemporalCli({ version: "9.9.9", binPath, fetchImpl })).rejects.toThrow(/HTTP 404/);
  });
});
