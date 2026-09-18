/**
 * The upload path against the CLI's digest. Pins: a folder handed over as
 * browser `File`s prepares to the digest `stigmer push plugin` prints for
 * the same folder (the parity constant recorded in the library's own
 * tripwire); an `<input webkitdirectory>` pick is re-rooted under the picked
 * folder's name; a zip of a folder is re-rooted and says so in its origin;
 * directory entries and macOS resource forks inside a zip are not files; a
 * file that is not a zip, an empty pick and a folder the reader refuses each
 * get their own refusal; the origin an upload carries is `upload`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { LocalPluginError, folderPick, folderPickFromInput, prepareLocalPlugin, zipPick } from "../sources/local.js";
import { PluginReadRefusal } from "../sources/read.js";

// Resolved from the package root (vitest's cwd), not import.meta.url: happy-dom
// rewrites module URLs to a non-file scheme.
const THERMOS = `${resolve(process.cwd(), "../../backend/libs/ts/plugin-package/src/__tests__/fixtures/cursor-plugins/thermos")}/`;
/** The CLI's digest for the thermos fixture (backend/libs/ts/plugin-package/src/__tests__/client-select-archive.test.ts). */
const THERMOS_DIGEST = "51bc4e5450e24762bb8515765c76bfe262f65c57f9afeda015c5818038396d5a";

/** Every file under `root` as `{ path, file }`, the shape a dropped folder is walked into. */
function filesOf(root: string): { path: string; file: File }[] {
  const out: { path: string; file: File }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, path);
      else if (entry.isFile() && statSync(full).isFile()) {
        out.push({ path, file: new File([blobPart(readFileSync(full))], entry.name) });
      }
    }
  };
  walk(root, "");
  return out;
}

/** `File` wants an ArrayBuffer-backed view; a Node `Buffer` slice may share a pool, so copy. */
function blobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/** A `File` as an `<input webkitdirectory>` yields it: named under the picked folder. */
function inputFile(relativePath: string, bytes: Uint8Array): File {
  const file = new File([blobPart(bytes)], relativePath.split("/").pop() ?? relativePath);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

describe("a dropped folder", () => {
  it("prepares to the CLI's digest and carries an upload origin", async () => {
    const prepared = await prepareLocalPlugin(folderPick("thermos", filesOf(THERMOS)));
    expect(prepared.digest).toBe(THERMOS_DIGEST);
    expect(prepared.plugin.name).toBe("thermos");
    expect(prepared.origin).toEqual({ kind: "upload", pick: "folder", name: "thermos" });
  });

  it("refuses an empty folder in its own words", () => {
    expect(() => folderPick("empty", [])).toThrow(LocalPluginError);
  });

  it("returns the reader's refusal, every sentence, for a folder that is not a plugin", async () => {
    const pick = folderPick("notes", [{ path: "README.md", file: new File(["hello"], "README.md") }]);
    const refusal = await prepareLocalPlugin(pick).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(PluginReadRefusal);
    expect((refusal as PluginReadRefusal).subject).toBe("'notes' cannot be installed");
  });
});

describe("an <input webkitdirectory> pick", () => {
  it("strips the picked folder's own name so the manifest is at the root", async () => {
    const pick = folderPickFromInput(
      filesOf(THERMOS).map(({ path }) => inputFile(`my-thermos/${path}`, new Uint8Array(readFileSync(`${THERMOS}${path}`)))),
    );
    expect(pick.name).toBe("my-thermos");
    expect(pick.candidates.map((c) => c.path)).toContain(".cursor-plugin/plugin.json");
    expect((await prepareLocalPlugin(pick)).digest).toBe(THERMOS_DIGEST);
  });
});

describe("a zip", () => {
  function zipOf(files: Record<string, Uint8Array>, name = "plugin.zip"): File {
    return new File([blobPart(zipSync(files))], name);
  }

  function thermosEntries(prefix: string): Record<string, Uint8Array> {
    return Object.fromEntries(
      filesOf(THERMOS).map(({ path }) => [`${prefix}${path}`, new Uint8Array(readFileSync(`${THERMOS}${path}`))]),
    );
  }

  it("of a folder is re-rooted, prepares to the CLI's digest, and its origin says so", async () => {
    const pick = await zipPick(zipOf({ ...thermosEntries("thermos/"), "__MACOSX/thermos/._plugin.json": new Uint8Array(4) }));
    expect(pick.rerooted).toBe("thermos");
    const prepared = await prepareLocalPlugin(pick);
    expect(prepared.digest).toBe(THERMOS_DIGEST);
    expect(prepared.origin).toEqual({ kind: "upload", pick: "zip", name: "plugin.zip", rerooted: "thermos" });
  });

  it("already rooted is taken as it is", async () => {
    const pick = await zipPick(zipOf(thermosEntries("")));
    expect(pick.rerooted).toBeUndefined();
    expect((await prepareLocalPlugin(pick)).digest).toBe(THERMOS_DIGEST);
  });

  it("that is not a zip, or holds no files, is refused in its own words", async () => {
    await expect(zipPick(new File([blobPart(new TextEncoder().encode("plain text"))], "plugin.zip"))).rejects.toMatchObject({
      reason: "not-a-zip",
    });
    await expect(zipPick(zipOf({ "only/": new Uint8Array(0) }))).rejects.toMatchObject({ reason: "empty" });
  });
});
