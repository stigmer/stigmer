// Command-level contract for `stigmer routine`: `fire` and `resume` hand the
// resource layer the client, the reference and the organization the flags
// resolve to, and render the result it answers: as text, whose status line
// goes to stderr, or as JSON on stdout. The backend and the routine resource
// are replaced at their module seams; the program and the flag parsing are
// real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CommandResult } from "../../output/command-result.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

const routine = vi.hoisted(() => ({
  fireRoutine: vi.fn(),
  resumeRoutine: vi.fn(),
}));
vi.mock("../../resources/routine.js", () => routine);

let stdout: string[];
let stderr: string[];

/** Runs `stigmer ...`, returning what it wrote to stdout. */
async function run(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", ...args]);
  return stdout.join("");
}

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  routine.fireRoutine.mockReset();
  routine.resumeRoutine.mockReset();
});

describe("stigmer routine fire", () => {
  it("fires the routine the reference names in the flag's organization and renders the result", async () => {
    routine.fireRoutine.mockResolvedValue(CommandResult.success("Fired routine Triage new alerts"));
    await run("--org", "acme", "routine", "fire", "triage");
    expect(routine.fireRoutine).toHaveBeenCalledWith(stigmer, "triage", "acme");
    expect(stderr.join("")).toContain("Fired routine Triage new alerts");
  });

  it("renders the result as JSON with --json", async () => {
    routine.fireRoutine.mockResolvedValue(CommandResult.success("Fired routine Triage new alerts"));
    const out = await run("--org", "acme", "routine", "fire", "rtn_01triage", "--json");
    expect(routine.fireRoutine).toHaveBeenCalledWith(stigmer, "rtn_01triage", "acme");
    expect(JSON.parse(out)).toMatchObject({ message: "Fired routine Triage new alerts" });
  });
});

describe("stigmer routine resume", () => {
  it("resumes the routine the reference names in the flag's organization and renders the result", async () => {
    routine.resumeRoutine.mockResolvedValue(CommandResult.success("Resumed routine Triage new alerts"));
    await run("--org", "acme", "routine", "resume", "acme/triage");
    expect(routine.resumeRoutine).toHaveBeenCalledWith(stigmer, "acme/triage", "acme");
    expect(stderr.join("")).toContain("Resumed routine Triage new alerts");
  });
});
