// Command-level contract for `stigmer runs to-eval-case <run-id>`: the run
// id and the flags reach the resource (--dir defaults to evals), and the
// file effects the command hands it are the disk's: `exists` answers for a
// path that is there and one that is not, and `writeFile` creates the case's
// folders and refuses a file that already exists, so a case the author
// edited is never overwritten. The backend and the resource are replaced at
// their module seams (the command imports them lazily); the effects run
// against a temporary directory.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";
import type { CaseFolderIo, ToEvalCaseFlags } from "../../resources/run-to-eval-case.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// The client the command hands to the resource; identity is what is asserted.
const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const resource = vi.hoisted(() => ({ writeEvalCaseFromRun: vi.fn() }));
vi.mock("../../resources/run-to-eval-case.js", () => resource);

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "stigmer-to-eval-case-"));
  resource.writeEvalCaseFromRun.mockResolvedValue("evals/a");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  vi.clearAllMocks();
});

/** Runs `stigmer runs to-eval-case ...` and returns what the resource was handed. */
async function toEvalCase(...args: string[]): Promise<{ client: unknown; runId: string; flags: ToEvalCaseFlags; io: CaseFolderIo }> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "runs", "to-eval-case", ...args]);
  expect(resource.writeEvalCaseFromRun).toHaveBeenCalledTimes(1);
  const [client, runId, flags, io] = resource.writeEvalCaseFromRun.mock.calls[0] as [unknown, string, ToEvalCaseFlags, CaseFolderIo];
  return { client, runId, flags, io };
}

describe("stigmer runs to-eval-case", () => {
  it("passes the run id and the flags, with evals as the default directory", async () => {
    const plain = await toEvalCase("run_1");
    expect(plain.client).toBe(stigmer);
    expect(plain.runId).toBe("run_1");
    expect(plain.flags).toEqual({ dir: "evals" });
    expect(plain.io.stderr).toBe(process.stderr);

    vi.clearAllMocks();
    const named = await toEvalCase("run_2", "--dir", "suite", "--name", "finds-bug", "--skill", "thermos:review");
    expect(named.flags).toEqual({ dir: "suite", name: "finds-bug", skill: "thermos:review" });
  });

  it("answers exists from the disk", async () => {
    const { io } = await toEvalCase("run_1");
    expect(await io.exists(scratch)).toBe(true);
    expect(await io.exists(join(scratch, "missing"))).toBe(false);
  });

  it("writes a file under folders it creates, and refuses to overwrite one", async () => {
    const { io } = await toEvalCase("run_1");
    const path = join(scratch, "evals", "a", "graders", "criteria.md");
    await io.writeFile(path, "FAIL: missed the off-by-one\n");
    expect(readFileSync(path, "utf8")).toBe("FAIL: missed the off-by-one\n");
    await expect(io.writeFile(path, "edited by nobody")).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(path, "utf8")).toBe("FAIL: missed the off-by-one\n");
  });
});
