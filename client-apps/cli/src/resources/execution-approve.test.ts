import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import { readFormData } from "./execution-approve.js";

const dirs: string[] = [];

async function tempFile(name: string, contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "stigmer-approve-"));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, contents, "utf8");
  return path;
}

afterAll(() => {
  // mkdtemp dirs are small and OS-cleaned; nothing to do but keep the ref alive.
  void dirs;
});

describe("readFormData", () => {
  it("returns undefined when no path is given", async () => {
    expect(await readFormData(undefined)).toBeUndefined();
    expect(await readFormData("")).toBeUndefined();
  });

  it("parses a JSON object", async () => {
    const path = await tempFile("form.json", JSON.stringify({ approved: true, note: "ok" }));
    expect(await readFormData(path)).toEqual({ approved: true, note: "ok" });
  });

  it("rejects a missing file with a usage error", async () => {
    const err = await readFormData("/no/such/file.json").catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });

  it("rejects malformed JSON with a usage error", async () => {
    const path = await tempFile("bad.json", "{ not valid");
    const err = await readFormData(path).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });

  it("rejects a non-object JSON value with a usage error", async () => {
    const path = await tempFile("array.json", "[1, 2, 3]");
    const err = await readFormData(path).catch((e) => e);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
  });
});
