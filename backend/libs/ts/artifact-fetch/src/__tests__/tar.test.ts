/**
 * Pins the one ustar reader (`tar.ts`) in both its uses.
 *
 * In memory, `extractTarEntry` finds a regular file by basename, as the CLI's
 * Temporal install uses it. Streaming, `extractPackageTarball` unpacks a
 * whole npm-shaped package into a directory and refuses, before writing past
 * the destination, every entry the module header rules out: a symlink, a hard
 * link, a directory, a pax header, an entry outside `package/`, an absolute
 * path, a `..` or empty segment, a corrupt header, a duplicate, an archive cut
 * short. These are the rules that keep a downloaded engine from writing
 * anywhere but its own home.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactFetchError } from "../errors.js";
import { extractPackageTarball, extractTarEntry, parseTarHeader, readTar, TAR_BLOCK } from "../tar.js";
import { buildPackageTarball, buildTar, type TarFixtureEntry } from "../testing.js";

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "artifact-fetch-tar-"));
  dirs.push(dir);
  return dir;
}

function writeArchive(bytes: Buffer): string {
  const path = join(scratch(), "pkg.tgz");
  writeFileSync(path, bytes);
  return path;
}

describe("parseTarHeader", () => {
  it("reads the name with its ustar prefix, the mode, the size, the kind and the checksum", () => {
    const longName = `package/${"d".repeat(60)}/${"e".repeat(60)}/file.txt`;
    const tar = buildTar([{ name: longName, content: "abc", mode: 0o755 }]);
    const header = parseTarHeader(tar.subarray(0, TAR_BLOCK));
    expect(header).toEqual({ name: longName, mode: 0o755, size: 3, kind: "file", typeFlag: "0", checksumValid: true });
  });

  it("reads a blank mode field as no permission bits", () => {
    const tar = buildTar([{ name: "a", content: "x" }]);
    tar.fill(0, 100, 108);
    expect(parseTarHeader(tar.subarray(0, TAR_BLOCK))?.mode).toBe(0);
  });

  it("returns null for a zero block and flags a corrupt checksum", () => {
    expect(parseTarHeader(new Uint8Array(TAR_BLOCK))).toBeNull();
    const tar = buildTar([{ name: "a", content: "x", corruptChecksum: true }]);
    expect(parseTarHeader(tar.subarray(0, TAR_BLOCK))?.checksumValid).toBe(false);
  });

  it("names every kind the extraction refuses", () => {
    const kinds = ["5", "2", "1", "x", "g", "3"].map((typeFlag) => parseTarHeader(buildTar([{ name: "n", typeFlag }]).subarray(0, TAR_BLOCK))?.kind);
    expect(kinds).toEqual(["directory", "symlink", "hardlink", "pax", "pax", "other"]);
  });
});

describe("extractTarEntry", () => {
  it("finds a regular file by basename past other entries, and returns null when it is absent", () => {
    const tar = buildTar([
      { name: "dir/", typeFlag: "5" },
      { name: "dir/readme", content: "r".repeat(700) },
      { name: "dir/temporal", content: "the binary" },
    ]);
    expect(Buffer.from(extractTarEntry(tar, "temporal") ?? new Uint8Array()).toString()).toBe("the binary");
    expect(extractTarEntry(tar, "missing")).toBeNull();
  });
});

describe("readTar", () => {
  it("streams each entry's data across chunk boundaries and skips data nobody read", async () => {
    const big = "b".repeat(5000);
    const tar = buildTar([
      { name: "skip", content: "s".repeat(1300) },
      { name: "big", content: big },
    ]);
    const chunks = Readable.from(Array.from({ length: Math.ceil(tar.length / 333) }, (_, i) => tar.subarray(i * 333, (i + 1) * 333)));
    const seen: Record<string, string> = {};
    for await (const entry of readTar(chunks)) {
      if (entry.header.name === "skip") continue;
      const parts: Buffer[] = [];
      for await (const chunk of entry.data()) parts.push(Buffer.from(chunk));
      seen[entry.header.name] = Buffer.concat(parts).toString();
    }
    expect(seen).toEqual({ big });
  });

  it("throws on an archive that ends inside an entry or before its end block", async () => {
    const tar = buildTar([{ name: "a", content: "x".repeat(2000) }]);
    const walk = async (bytes: Buffer): Promise<void> => {
      for await (const entry of readTar(Readable.from([bytes]))) for await (const _ of entry.data());
    };
    await expect(walk(tar.subarray(0, TAR_BLOCK + 100))).rejects.toThrow("the archive ends inside a");
    await expect(walk(tar.subarray(0, TAR_BLOCK + 2048))).rejects.toThrow("the archive ends without its end-of-archive block");
  });

  it("throws on an archive that ends inside an entry nobody read", async () => {
    const tar = buildTar([{ name: "unread", content: "u".repeat(2000) }]);
    const walk = async (): Promise<void> => {
      for await (const _ of readTar(Readable.from([tar.subarray(0, TAR_BLOCK + 700)])));
    };
    await expect(walk()).rejects.toThrow("the archive ends inside unread");
  });

  it("throws on a size field that is not octal", async () => {
    const tar = buildTar([{ name: "a", content: "x" }]);
    tar.write("9z9", 124, "ascii");
    const walk = async (): Promise<void> => {
      for await (const _ of readTar(Readable.from([tar])));
    };
    await expect(walk()).rejects.toThrow("entry a has a size field that is not octal");
  });
});

describe("extractPackageTarball", () => {
  it("unpacks every file under package/ with its permission bits, less group and other write", async () => {
    const binary = Buffer.alloc(200_000, 7);
    const archive = writeArchive(buildPackageTarball({ "package.json": "{}", "lib/sdk.mjs": "export {}", claude: binary }, { claude: 0o777 }));
    const dest = join(scratch(), "out");
    await expect(extractPackageTarball(archive, dest, { prefix: "package/", label: "engine" })).resolves.toEqual({ files: 3 });
    expect(readFileSync(join(dest, "lib", "sdk.mjs"), "utf8")).toBe("export {}");
    expect(readFileSync(join(dest, "claude")).equals(binary)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(join(dest, "claude")).mode & 0o777).toBe(0o755);
      expect(statSync(join(dest, "package.json")).mode & 0o777).toBe(0o644);
    }
  });

  const refusals: [string, TarFixtureEntry, RegExp][] = [
    ["a symlink", { name: "package/link", typeFlag: "2", linkName: "/etc/passwd" }, /is a symlink, and only regular files are accepted/],
    ["a hard link", { name: "package/hard", typeFlag: "1", linkName: "package/x" }, /is a hardlink/],
    ["a directory", { name: "package/dir/", typeFlag: "5" }, /is a directory/],
    ["a pax header", { name: "PaxHeader/x", typeFlag: "x", content: "30 path=../../../../etc/x\n" }, /is a pax/],
    ["an entry outside package/", { name: "other/x", content: "x" }, /is not under package\//],
    ["a .. segment", { name: "package/../../escape", content: "x" }, /has an empty, \. or \.\. segment/],
    ["an absolute path", { name: "package//etc/x", content: "x" }, /is not a plain relative path/],
    ["a backslash path", { name: "package/..\\x", content: "x" }, /is not a plain relative path/],
    ["the bare prefix", { name: "package/", content: "x" }, /is not a plain relative path/],
    ["a corrupt header", { name: "package/x", content: "x", corruptChecksum: true }, /has a corrupt header/],
  ];

  for (const [what, entry, reason] of refusals) {
    it(`refuses ${what} and writes nothing outside the destination`, async () => {
      const root = scratch();
      const archive = join(root, "pkg.tgz");
      writeFileSync(archive, gzipSync(buildTar([{ name: "package/ok.txt", content: "ok" }, entry])));
      const dest = join(root, "out");
      const err: unknown = await extractPackageTarball(archive, dest, { prefix: "package/", label: "engine" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ArtifactFetchError);
      expect((err as ArtifactFetchError).message).toMatch(/^engine archive refused: /);
      expect((err as ArtifactFetchError).message).toMatch(reason);
      expect((err as ArtifactFetchError).details).toEqual([`archive: ${archive}`]);
      expect(readdirSync(root).sort()).toEqual(["out", "pkg.tgz"]);
      expect(existsSync(join(root, "escape"))).toBe(false);
    });
  }

  it("refuses a duplicate entry rather than replace the file it already wrote", async () => {
    const archive = writeArchive(
      gzipSync(
        buildTar([
          { name: "package/x", content: "first" },
          { name: "package/x", content: "second" },
        ]),
      ),
    );
    const dest = join(scratch(), "out");
    await expect(extractPackageTarball(archive, dest, { prefix: "package/", label: "engine" })).rejects.toThrow(/entry "package\/x" could not be created/);
    expect(readFileSync(join(dest, "x"), "utf8")).toBe("first");
  });

  it("refuses an archive cut short and a file that is not gzip", async () => {
    const whole = buildPackageTarball({ a: "x".repeat(10_000) });
    const dest = join(scratch(), "out");
    await expect(extractPackageTarball(writeArchive(whole.subarray(0, whole.length - 20)), dest, { prefix: "package/", label: "engine" })).rejects.toThrow();
    await expect(extractPackageTarball(writeArchive(Buffer.from("not gzip")), join(scratch(), "o"), { prefix: "package/", label: "engine" })).rejects.toThrow(
      /incorrect header check/,
    );
  });

  it("stops on its signal with the signal's reason", async () => {
    const archive = writeArchive(buildPackageTarball({ a: "x" }));
    const reason = new Error("stopped");
    await expect(extractPackageTarball(archive, join(scratch(), "out"), { prefix: "package/", label: "engine", signal: AbortSignal.abort(reason) })).rejects.toThrow();
  });

  it("refuses a destination file it cannot create", async () => {
    if (process.platform === "win32") return;
    const root = scratch();
    const dest = join(root, "out");
    const archive = writeArchive(buildPackageTarball({ "sub/a": "x" }));
    await extractPackageTarball(writeArchive(buildPackageTarball({ b: "y" })), dest, { prefix: "package/", label: "engine" });
    chmodSync(dest, 0o500);
    try {
      await expect(extractPackageTarball(archive, dest, { prefix: "package/", label: "engine" })).rejects.toThrow();
    } finally {
      chmodSync(dest, 0o700);
    }
  });
});
