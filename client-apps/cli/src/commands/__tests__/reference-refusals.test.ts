// Command-level contract for the references a command refuses before any
// server call: `search` names the one type it searches (agent) when given a
// type it does not know; `resume` refuses an agent id as not a session and
// points at `run`; `run` refuses a full id of any kind but an agent, since only
// agents run, while an agent slug that starts with a prefix word ("run-…")
// stays an agent reference, and refuses a second argument, so the retired `run <type> <ref>`
// form fails instead of running an agent named by its first word. The
// backend, the agent lookup and the session opener are replaced at their
// module seams (the commands import them lazily) so a refusal is proven to
// stop before any of them is reached; the program, the flag parsing and the
// reference classification are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const backend = vi.hoisted(() => ({ connectBackend: vi.fn() }));
vi.mock("../../backend.js", () => backend);

const resolve = vi.hoisted(() => ({ resolveAgentRef: vi.fn() }));
vi.mock("../../resources/run/resolve.js", () => resolve);

const session = vi.hoisted(() => ({ openSession: vi.fn() }));
vi.mock("../../resources/run/resume.js", () => session);

const AGENT_ID = "agt_01abc123xyz456789012345678";
const SCHEDULE_ID = "sch_01abc123xyz456789012345678";

/** Runs `stigmer ...` against the stubbed backend with the context org acme. */
async function stigmer(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", ...args]);
}

beforeEach(() => {
  backend.connectBackend.mockReturnValue({ config: CONFIG, stigmer: { name: "stub-client" } });
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer search", () => {
  it("refuses an unknown type and names agent as the type it searches", async () => {
    await expect(stigmer("search", "bogus", "review")).rejects.toThrow(
      new UsageError("unknown resource type: bogus\n\nAvailable types: agent"),
    );
    expect(backend.connectBackend).not.toHaveBeenCalled();
  });
});

describe("stigmer resume", () => {
  it("refuses an agent id as not a session and points at run", async () => {
    await expect(stigmer("resume", AGENT_ID)).rejects.toThrow(
      new UsageError(
        `Resource IDs like "${AGENT_ID}" are not sessions\n\nTo run a resource:\n  stigmer run ${AGENT_ID}`,
      ),
    );
    expect(session.openSession).not.toHaveBeenCalled();
  });
});

describe("stigmer run", () => {
  it("refuses a full id of a kind that is not an agent: only agents run", async () => {
    await expect(stigmer("run", SCHEDULE_ID)).rejects.toThrow(
      new UsageError(
        `Cannot run resource ID "${SCHEDULE_ID}": only agents run\n\nTo run an agent:\n  stigmer run <agent-id>`,
      ),
    );
    expect(resolve.resolveAgentRef).not.toHaveBeenCalled();
  });

  it("refuses a run id, and reads an agent slug that starts with run- as an agent", async () => {
    const runId = "run_01abc123xyz456789012345678";
    await expect(stigmer("run", runId)).rejects.toThrow(
      new UsageError(`Cannot run resource ID "${runId}": only agents run\n\nTo run an agent:\n  stigmer run <agent-id>`),
    );
    expect(resolve.resolveAgentRef).not.toHaveBeenCalled();

    resolve.resolveAgentRef.mockRejectedValue(new Error("not found"));
    await expect(stigmer("run", "run-nightly-report", "-m", "hello")).rejects.toThrow();
    expect(resolve.resolveAgentRef).toHaveBeenCalledWith({ name: "stub-client" }, "run-nightly-report", "acme");
  });

  it.each([
    ["agent", "reviewer"],
    ["workflow", "nightly-digest"],
  ])(
    "refuses the two-word form `run %s %s` instead of running an agent named by its first word",
    async (first, second) => {
      // Commander exits from the subcommand that refuses, so the override goes there.
      const program = buildProgram();
      program.exitOverride();
      program.commands.find((c) => c.name() === "run")?.exitOverride();
      await expect(
        program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "run", first, second, "-m", "hello"]),
      ).rejects.toMatchObject({
        code: "commander.excessArguments",
        message: "error: too many arguments for 'run'. Expected 1 argument but got 2.",
      });
      expect(backend.connectBackend).not.toHaveBeenCalled();
      expect(resolve.resolveAgentRef).not.toHaveBeenCalled();
    },
  );
});
