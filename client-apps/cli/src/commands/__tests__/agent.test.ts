// Command-level contract for `stigmer agent quality`: the program
// registers the `agent` group with `quality` alone (its eval moved to
// `eval run --agent`); `agent quality` hands the agent, the checked flags
// and the organization to its dispatch and prints what it returns,
// refusing a flag out of range before connecting. The backend and the
// dispatch are replaced at their module seams (the command imports them
// lazily); the program, the option reading and the effects are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import type { AgentQualityOptions } from "../../resources/agent/quality.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

// The client the command hands to the dispatch; identity is what is asserted.
const stigmer = vi.hoisted(() => ({ name: "stub-client" }));
const backend = vi.hoisted(() => ({ connects: 0 }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => {
    backend.connects += 1;
    return { config: CONFIG, stigmer };
  },
}));

const quality = vi.hoisted(() => ({ showAgentQuality: vi.fn() }));
vi.mock("../../resources/agent/quality.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../resources/agent/quality.js")>()),
  showAgentQuality: quality.showAgentQuality,
}));

afterEach(() => {
  vi.clearAllMocks();
  backend.connects = 0;
});

describe("the agent group", () => {
  it("registers agent quality alone", () => {
    const agent = buildProgram().commands.find((command) => command.name() === "agent");
    expect(agent?.commands.map((command) => command.name())).toEqual(["quality"]);
  });
});

describe("stigmer agent quality <agent>", () => {
  let stdout = "";
  beforeEach(() => {
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Runs `stigmer --org acme agent quality ...`. */
  async function agentQuality(...args: string[]): Promise<void> {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "agent", "quality", ...args]);
  }

  it("hands the agent, the checked flags and the organization to the dispatch, and prints what it returns", async () => {
    quality.showAgentQuality.mockResolvedValue("the report\n");
    await agentQuality("support-desk", "--days", "7", "--flagged", "--limit", "5", "-o", "json");

    expect(quality.showAgentQuality).toHaveBeenCalledTimes(1);
    const [client, org, target, options] = quality.showAgentQuality.mock.calls[0] as [
      unknown,
      string,
      string,
      AgentQualityOptions,
    ];
    expect(client).toBe(stigmer);
    expect(org).toBe("acme");
    expect(target).toBe("support-desk");
    expect(options).toEqual({ days: 7, flagged: true, agreement: false, limit: 5, format: "json" });
    expect(stdout).toBe("the report\n");
  });

  it("reads the totals for 30 days as a table by default", async () => {
    quality.showAgentQuality.mockResolvedValue("");
    await agentQuality("agt_1");
    expect(quality.showAgentQuality.mock.calls[0]?.[3]).toEqual({
      days: 30,
      flagged: false,
      agreement: false,
      limit: 20,
      format: "table",
    });
  });

  it("hands --agreement to the dispatch", async () => {
    quality.showAgentQuality.mockResolvedValue("");
    await agentQuality("agt_1", "--agreement");
    expect(quality.showAgentQuality.mock.calls[0]?.[3]).toMatchObject({ agreement: true, flagged: false });
  });

  it("refuses --days out of range before connecting", async () => {
    const error = await agentQuality("support-desk", "--days", "91").catch((e: unknown) => e);
    expect((error as Error).message).toContain("from 1 to 90");
    expect(backend.connects).toBe(0);
    expect(quality.showAgentQuality).not.toHaveBeenCalled();
  });
});
