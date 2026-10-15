// Command-level contract for `stigmer runs to-eval-case <run-id>`: the run
// id, the flags as written (no --dir unless given, so the resource can tell
// --dir beside --eval) and the organization (--org, else none) reach the
// resource, and the file effects the command hands it are the disk's:
// `exists` answers for a path that is there and one that is not, and
// `extract` is `download eval`'s checked unzip, writing the case's files
// under the directory given. The backend and the resource are replaced at
// their module seams (the command imports them lazily); the effects run
// against a temporary directory.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
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
async function toEvalCase(...args: string[]): Promise<{ client: unknown; runId: string; flags: ToEvalCaseFlags; io: CaseFolderIo; org: string }> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", ...args]);
  expect(resource.writeEvalCaseFromRun).toHaveBeenCalledTimes(1);
  const [client, runId, flags, io, org] = resource.writeEvalCaseFromRun.mock.calls[0] as [unknown, string, ToEvalCaseFlags, CaseFolderIo, string];
  return { client, runId, flags, io, org };
}

describe("stigmer runs to-eval-case", () => {
  it("passes the run id, the flags as written and the organization", async () => {
    const plain = await toEvalCase("runs", "to-eval-case", "run_1");
    expect(plain.client).toBe(stigmer);
    expect(plain.runId).toBe("run_1");
    expect(plain.flags).toEqual({});
    expect(plain.org).toBe("");
    expect(plain.io.stderr).toBe(process.stderr);

    vi.clearAllMocks();
    const named = await toEvalCase("--org", "acme", "runs", "to-eval-case", "run_2", "--dir", "suite", "--name", "finds-bug", "--skill", "thermos:review");
    expect(named.flags).toEqual({ dir: "suite", name: "finds-bug", skill: "thermos:review" });
    expect(named.org).toBe("acme");

    vi.clearAllMocks();
    const added = await toEvalCase("runs", "to-eval-case", "run_3", "--eval", "support-evals");
    expect(added.flags).toEqual({ eval: "support-evals" });
  });

  it("answers exists from the disk", async () => {
    const { io } = await toEvalCase("runs", "to-eval-case", "run_1");
    expect(await io.exists(scratch)).toBe(true);
    expect(await io.exists(join(scratch, "missing"))).toBe(false);
  });

  it("extracts the case's files under the directory given", async () => {
    const { io } = await toEvalCase("runs", "to-eval-case", "run_1");
    const archive = zipSync({ "a/graders/criteria.md": new TextEncoder().encode("FAIL if: missed the off-by-one\n") });
    expect(io.extract(archive, join(scratch, "evals"))).toBe(1);
    expect(readFileSync(join(scratch, "evals", "a", "graders", "criteria.md"), "utf8")).toBe("FAIL if: missed the off-by-one\n");
  });
});
