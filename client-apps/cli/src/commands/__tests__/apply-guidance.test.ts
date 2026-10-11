// Command-level contract for a bare `stigmer apply` in a directory that holds
// no plugin manifest: it applies nothing and prints what the command does,
// naming the resource files `-f` applies. Runs the real program in an empty
// temporary directory, so no backend is reached and nothing is stubbed but the
// working directory and stderr.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../program.js";

let dir: string;
let stderr: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-apply-guidance-"));
  stderr = [];
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("stigmer apply with no plugin manifest", () => {
  it("prints what the command does, naming the resource files -f applies", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--standalone", "apply"]);

    const out = stderr.join("");
    expect(out).toContain(`No plugin manifest in ${dir}`);
    expect(out).toContain("stigmer apply -f <file>        apply a resource file (agent, schedule, ...)");
  });
});
