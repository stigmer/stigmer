/**
 * Pins how a plugin-eval try returns the files its graders read
 * (`read-files.ts`) on a real temporary workspace: a text file whether or
 * not the turn changed it, a binary file, a missing path and one under a
 * file, a directory, a path outside the workspace, a file past the per-file
 * cap and files past the shared cap, each path once in the order given; and
 * a read the filesystem refuses comes back unreadable with its reason.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EVAL_FILE_MAX_BYTES, EVAL_FILES_MAX_BYTES, readEvalFiles } from "../read-files.js";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "eval-read-files-"));
});

afterEach(() => {
  chmodSync(workspace, 0o755);
  rmSync(workspace, { recursive: true, force: true });
});

/** Each file as `[path, case, value]`. */
async function read(paths: readonly string[]): Promise<(readonly [string, string | undefined, unknown])[]> {
  const files = await readEvalFiles(workspace, paths);
  return files.files.map((file) => [file.path, file.content.case, file.content.value] as const);
}

describe("readEvalFiles", () => {
  it("returns each named file as the turn left it, once per path, in the order given", async () => {
    writeFileSync(join(workspace, "app.txt"), "version = 1\n");
    mkdirSync(join(workspace, "src"));
    writeFileSync(join(workspace, "src", "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    writeFileSync(join(workspace, "notes"), "");
    expect(await read(["app.txt", "./app.txt", "src/logo.png", "missing.md", "app.txt/inner", "src", "notes"])).toEqual([
      ["app.txt", "text", "version = 1\n"],
      ["./app.txt", "text", "version = 1\n"],
      ["src/logo.png", "binary", true],
      ["missing.md", "absent", true],
      ["app.txt/inner", "absent", true],
      ["src", "unreadable", "'src' is not a regular file"],
      ["notes", "text", ""],
    ]);
  });

  it("reads nothing outside the workspace", async () => {
    expect(await read(["/etc/hosts", "../outside.txt", "a/../../outside.txt", ".."])).toEqual([
      ["/etc/hosts", "unreadable", "'/etc/hosts' is outside the workspace"],
      ["../outside.txt", "unreadable", "'../outside.txt' is outside the workspace"],
      ["a/../../outside.txt", "unreadable", "'a/../../outside.txt' is outside the workspace"],
      ["..", "unreadable", "'..' is outside the workspace"],
    ]);
  });

  it("returns a file past its cap, and files past the shared cap, unreadable with the cap named", async () => {
    writeFileSync(join(workspace, "huge.log"), "x".repeat(EVAL_FILE_MAX_BYTES + 1));
    const count = Math.ceil(EVAL_FILES_MAX_BYTES / EVAL_FILE_MAX_BYTES) + 1;
    const paths = Array.from({ length: count }, (_, i) => `part-${i}.txt`);
    for (const path of paths) writeFileSync(join(workspace, path), "y".repeat(EVAL_FILE_MAX_BYTES));
    const files = await read(["huge.log", ...paths]);
    expect(files[0]).toEqual(["huge.log", "unreadable", `'huge.log' is larger than ${EVAL_FILE_MAX_BYTES / 1024} KiB`]);
    const fitting = EVAL_FILES_MAX_BYTES / EVAL_FILE_MAX_BYTES;
    expect(files.slice(1).map(([, kind]) => kind)).toEqual([
      ...Array.from({ length: fitting }, () => "text"),
      ...Array.from({ length: count - fitting }, () => "unreadable"),
    ]);
    expect(files.at(-1)?.[2]).toBe(`the files the graders read pass ${EVAL_FILES_MAX_BYTES / 1024} KiB together`);
  });

  it("returns a file the filesystem refuses unreadable, with the reason", async () => {
    mkdirSync(join(workspace, "locked"));
    writeFileSync(join(workspace, "locked", "secret.txt"), "hidden");
    writeFileSync(join(workspace, "private.txt"), "hidden");
    chmodSync(join(workspace, "private.txt"), 0o000);
    chmodSync(join(workspace, "locked"), 0o000);
    const files = await read(["locked/secret.txt", "private.txt"]);
    chmodSync(join(workspace, "locked"), 0o755);
    expect(files.map(([path, kind]) => [path, kind])).toEqual([
      ["locked/secret.txt", "unreadable"],
      ["private.txt", "unreadable"],
    ]);
    expect(String(files[0]?.[2])).toMatch(/^'locked\/secret\.txt' could not be read: .*EACCES/);
    expect(String(files[1]?.[2])).toMatch(/^'private\.txt' could not be read: .*EACCES/);
  });
});
