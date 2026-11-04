// The Temporal CLI download end to end over a scripted `fetch`: asset naming,
// verification against the release's checksums.txt, extraction, and the retry
// contract `../artifact.ts` gives every release download. The retry cases pin
// which failures are transient (a dropped connection before or during the body,
// a 5xx, a 429) and which are answers (a 404, a bad digest), the backoff, and
// the error a persistent failure ends in. A recording `sleep` keeps them instant.
// The cache-directory cases pin what lets a CI lane install through a release-host
// outage: a matching cached pair installs with no request at all, a miss keeps
// the pair it verified, a copy that does not match (or belongs to another
// version) is downloaded again, and a directory that cannot be written fails.
// The version reader and the replace cases pin what moves an installed binary to
// a new pin (stigmer#1319): the binary is asked its version, and a replace puts
// a new file in place by rename, so a running binary keeps its inode and a
// failed write leaves neither a truncated binary nor a temp file behind.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CliExitError } from "../../../errors/cli-exit-error.js";
import { fetchTarballBinary } from "../../artifact.js";
import {
  TEMPORAL_CHECKSUMS_FILE,
  downloadTemporalCli,
  extractTarEntry,
  installedTemporalVersion,
  temporalArchiveName,
  temporalReleaseAssetUrl,
} from "../download.js";

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
    const result = await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl });

    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(result).toEqual({ source: "network", cache: "unused" });
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

describe("installedTemporalVersion", () => {
  function script(body: string): string {
    const path = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-version-")), "temporal");
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    chmodSync(path, 0o755);
    return path;
  }

  it("reads the version from the line the CLI prints", () => {
    expect(installedTemporalVersion(script("echo 'temporal version 1.10.0 (Server 1.32.2, UI 2.56.1)'"))).toBe("1.10.0");
    expect(installedTemporalVersion(script("echo 'temporal version 1.5.1 (Server 1.29.1, UI 2.42.1)'"))).toBe("1.5.1");
  });

  it("is null for output it cannot read", () => {
    expect(installedTemporalVersion(script("echo 'not a version line'"))).toBeNull();
  });

  it("is null for a binary that fails", () => {
    expect(installedTemporalVersion(script("echo 'temporal version 1.10.0'; exit 1"))).toBeNull();
  });

  it("is null for a missing file", () => {
    expect(installedTemporalVersion(join(tmpdir(), "stigmer-no-such-dir", "temporal"))).toBeNull();
  });
});

describe("downloadTemporalCli over an installed binary", () => {
  const linuxArm = temporalArchiveName("1.5.1", "linux", "arm64");
  const arm = archiveFor(Buffer.from("the-new-binary"));
  const good = release("1.5.1", { [linuxArm]: arm }, `${sha256(arm)}  ${linuxArm}\n`);

  it("puts the new binary in place as a new file, executable, with no temp file left", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-temporal-replace-"));
    const binPath = join(dir, "temporal");
    writeFileSync(binPath, "the-old-binary", { mode: 0o755 });
    const before = statSync(binPath).ino;

    await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl: good });

    expect(readFileSync(binPath, "utf8")).toBe("the-new-binary");
    expect(statSync(binPath).ino).not.toBe(before);
    expect(statSync(binPath).mode & 0o777).toBe(0o755);
    expect(readdirSync(dir)).toEqual(["temporal"]);
  });

  it("leaves no temp file when the binary cannot be put in place", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-temporal-replace-"));
    const binPath = join(dir, "temporal");
    // A non-empty directory where the binary goes: the rename over it fails.
    mkdirSync(join(binPath, "occupied"), { recursive: true });

    await expect(
      downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl: good }),
    ).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["temporal"]);
    expect(readdirSync(binPath)).toEqual(["occupied"]);
  });
});

type Failure = "reject" | "body" | number;

// Wraps a release so requests for one asset fail as scripted before the real
// release answers: each entry of `failures` is consumed by one request for
// `asset`. "reject" is a connection that never answers (Node's fetch rejects
// with the socket error as `cause`), "body" one that drops after the headers,
// a number an HTTP status. `calls` counts the requests for `asset`.
function flaky(inner: typeof fetch, asset: string, failures: Failure[]): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (!url.endsWith(`/${asset}`)) return inner(input);
    calls += 1;
    const failure = failures[calls - 1];
    if (failure === "reject") throw new TypeError("fetch failed", { cause: new Error("read ECONNRESET") });
    if (failure === "body") {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          throw new TypeError("terminated", { cause: new Error("other side closed") });
        },
      } as unknown as Response;
    }
    if (typeof failure === "number") {
      return { ok: false, status: failure, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    }
    return inner(input);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe("downloadTemporalCli over an unreliable network", () => {
  const linuxArm = temporalArchiveName("1.5.1", "linux", "arm64");
  const arm = archiveFor(Buffer.from("the-arm64-binary"));
  const good = release("1.5.1", { [linuxArm]: arm }, `${sha256(arm)}  ${linuxArm}\n`);

  function install(fetchImpl: typeof fetch): { binPath: string; delays: number[]; run: Promise<unknown> } {
    const binPath = join(mkdtempSync(join(tmpdir(), "stigmer-temporal-")), "temporal");
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    const run = downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", fetchImpl, sleep });
    return { binPath, delays, run };
  }

  it("retries a connection that never answers, then installs the verified binary", async () => {
    const net = flaky(good, linuxArm, ["reject"]);
    const { binPath, delays, run } = install(net.fetchImpl);
    await run;
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(net.calls()).toBe(2);
    expect(delays).toEqual([1000]);
  });

  it("retries a connection that drops after the headers", async () => {
    const net = flaky(good, linuxArm, ["body"]);
    const { binPath, run } = install(net.fetchImpl);
    await run;
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(net.calls()).toBe(2);
  });

  it("retries a 5xx and a 429, doubling the wait", async () => {
    const net = flaky(good, linuxArm, [503, 429]);
    const { binPath, delays, run } = install(net.fetchImpl);
    await run;
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(net.calls()).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it("retries the checksums.txt fetch the same way", async () => {
    const net = flaky(good, TEMPORAL_CHECKSUMS_FILE, ["reject"]);
    const { binPath, run } = install(net.fetchImpl);
    await run;
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(net.calls()).toBe(2);
  });

  it("takes a 404 as the answer and does not retry it", async () => {
    const net = flaky(good, linuxArm, [404]);
    const { delays, run } = install(net.fetchImpl);
    await expect(run).rejects.toThrow(/HTTP 404/);
    expect(net.calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it("gives up after four attempts, saying what failed and what to do", async () => {
    const net = flaky(good, linuxArm, ["reject", "reject", "reject", "reject"]);
    const { binPath, delays, run } = install(net.fetchImpl);
    const err: unknown = await run.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliExitError);
    const exit = err as CliExitError;
    expect(exit.message).toBe(
      `failed to download Temporal CLI from ${temporalReleaseAssetUrl("1.5.1", linuxArm)} after 4 attempts: fetch failed: read ECONNRESET`,
    );
    expect(exit.hints).toEqual(["check the network connection, then run the command again"]);
    expect(net.calls()).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(existsSync(binPath)).toBe(false);
  });
});

describe("downloadTemporalCli with a cache directory", () => {
  const linuxArm = temporalArchiveName("1.5.1", "linux", "arm64");
  const arm = archiveFor(Buffer.from("the-arm64-binary"));
  const checksums = `${sha256(arm)}  ${linuxArm}\n`;
  const good = release("1.5.1", { [linuxArm]: arm }, checksums);

  // The release host mid-outage: every request answers 504, and each is counted.
  function hostDown(): { fetchImpl: typeof fetch; calls: () => number } {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: false, status: 504, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  }

  function dirs(): { binPath: string; cacheDir: string } {
    const root = mkdtempSync(join(tmpdir(), "stigmer-temporal-cache-"));
    return { binPath: join(root, "bin", "temporal"), cacheDir: join(root, "cache") };
  }

  function seed(cacheDir: string, archiveName: string, archive: Buffer, checksumFile: string): void {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, archiveName), archive);
    writeFileSync(join(cacheDir, `${archiveName}.${TEMPORAL_CHECKSUMS_FILE}`), checksumFile);
  }

  const noWait = async (): Promise<void> => {};

  it("installs from a matching cached pair while the release host is down, sending no request", async () => {
    const { binPath, cacheDir } = dirs();
    seed(cacheDir, linuxArm, arm, checksums);
    const host = hostDown();

    const result = await downloadTemporalCli({
      version: "1.5.1",
      binPath,
      platform: "linux",
      arch: "arm64",
      cacheDir,
      fetchImpl: host.fetchImpl,
      sleep: noWait,
    });

    expect(result).toEqual({ source: "cache" });
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(host.calls()).toBe(0);
  });

  it("on a miss, downloads, installs, and keeps the verified archive beside its checksums.txt", async () => {
    const { binPath, cacheDir } = dirs();

    const result = await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", cacheDir, fetchImpl: good });

    expect(result).toEqual({ source: "network", cache: "absent" });
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(readFileSync(join(cacheDir, linuxArm))).toEqual(arm);
    expect(readFileSync(join(cacheDir, `${linuxArm}.${TEMPORAL_CHECKSUMS_FILE}`), "utf8")).toBe(checksums);
  });

  it("downloads again over a cached archive that does not match its line, and repairs the cache", async () => {
    const { binPath, cacheDir } = dirs();
    seed(cacheDir, linuxArm, archiveFor(Buffer.from("tampered")), checksums);

    const result = await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", cacheDir, fetchImpl: good });

    expect(result).toEqual({ source: "network", cache: "mismatch" });
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(readFileSync(join(cacheDir, linuxArm))).toEqual(arm);
  });

  it("downloads when the cached checksums.txt has no line for the archive", async () => {
    const { binPath, cacheDir } = dirs();
    seed(cacheDir, linuxArm, arm, `${sha256(arm)}  some_other_asset.tar.gz\n`);

    const result = await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", cacheDir, fetchImpl: good });

    expect(result).toEqual({ source: "network", cache: "mismatch" });
    expect(readFileSync(join(cacheDir, `${linuxArm}.${TEMPORAL_CHECKSUMS_FILE}`), "utf8")).toBe(checksums);
  });

  it("counts an archive cached without its checksums.txt as absent", async () => {
    const { binPath, cacheDir } = dirs();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, linuxArm), arm);

    const result = await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", cacheDir, fetchImpl: good });

    expect(result).toEqual({ source: "network", cache: "absent" });
    expect(readFileSync(join(cacheDir, `${linuxArm}.${TEMPORAL_CHECKSUMS_FILE}`), "utf8")).toBe(checksums);
  });

  it("fails, naming the directory, when a cached pair cannot be read, and sends no request", async () => {
    const { binPath, cacheDir } = dirs();
    mkdirSync(join(cacheDir, linuxArm), { recursive: true });
    writeFileSync(join(cacheDir, `${linuxArm}.${TEMPORAL_CHECKSUMS_FILE}`), checksums);
    const host = hostDown();

    const err: unknown = await downloadTemporalCli({
      version: "1.5.1",
      binPath,
      platform: "linux",
      arch: "arm64",
      cacheDir,
      fetchImpl: host.fetchImpl,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CliExitError);
    const exit = err as CliExitError;
    expect(exit.message).toBe("could not read the cached Temporal CLI");
    expect(exit.hints?.[0]).toBe(`path:  ${cacheDir}`);
    expect(host.calls()).toBe(0);
  });

  it("reports a cached archive without the binary against the cached file", async () => {
    const { binPath, cacheDir } = dirs();
    const wrong = Buffer.from(gzipSync(new Uint8Array(makeTar("not-temporal", Buffer.from("x")))));
    seed(cacheDir, linuxArm, wrong, `${sha256(wrong)}  ${linuxArm}\n`);
    const host = hostDown();

    const err: unknown = await downloadTemporalCli({
      version: "1.5.1",
      binPath,
      platform: "linux",
      arch: "arm64",
      cacheDir,
      fetchImpl: host.fetchImpl,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CliExitError);
    const exit = err as CliExitError;
    expect(exit.message).toBe("temporal not found in the Temporal CLI archive");
    expect(exit.hints).toEqual([`archive: ${join(cacheDir, linuxArm)}`]);
  });

  it("never caches an archive nothing verified: without a checksum URL the directory is ignored", async () => {
    const { binPath, cacheDir } = dirs();
    // Built once: gzip stamps the current second into its header, so two builds can differ.
    const cachedCopy = archiveFor(Buffer.from("a cached copy"));
    seed(cacheDir, linuxArm, cachedCopy, checksums);

    const result = await fetchTarballBinary({
      url: temporalReleaseAssetUrl("1.5.1", linuxArm),
      entryName: "temporal",
      binPath,
      label: "Temporal CLI",
      cacheDir,
      fetchImpl: good,
    });

    expect(result).toEqual({ source: "network", cache: "unused" });
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
    expect(readFileSync(join(cacheDir, linuxArm))).toEqual(cachedCopy);
  });

  it("does not take another version's cached pair for this one", async () => {
    const { binPath, cacheDir } = dirs();
    const older = temporalArchiveName("1.5.0", "linux", "arm64");
    const olderArchive = archiveFor(Buffer.from("the-1.5.0-binary"));
    seed(cacheDir, older, olderArchive, `${sha256(olderArchive)}  ${older}\n`);

    const result = await downloadTemporalCli({ version: "1.5.1", binPath, platform: "linux", arch: "arm64", cacheDir, fetchImpl: good });

    expect(result).toEqual({ source: "network", cache: "absent" });
    expect(readFileSync(binPath, "utf8")).toBe("the-arm64-binary");
  });

  it("fails, naming the directory, when the cache cannot be written", async () => {
    const { binPath, cacheDir } = dirs();
    writeFileSync(cacheDir, "a file where the cache directory should be");
    const unwritable = join(cacheDir, "temporal-cli");

    const err: unknown = await downloadTemporalCli({
      version: "1.5.1",
      binPath,
      platform: "linux",
      arch: "arm64",
      cacheDir: unwritable,
      fetchImpl: good,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(CliExitError);
    const exit = err as CliExitError;
    expect(exit.message).toBe("could not write the Temporal CLI cache");
    expect(exit.hints?.[0]).toBe(`path:  ${unwritable}`);
  });
});
