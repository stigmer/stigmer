// Command-level contract for `stigmer agent eval` and `stigmer agent
// quality`: the program registers the `agent` group with `eval`, `eval
// cancel` and `quality`; the target and every
// flag reach the dispatch read and checked (a version after @, a repeated
// --plugin and --model collect, --tag takes several values, no --ablation),
// in the organization --org names, with the process's own effects; the
// dispatch's exit code leaves through a silent CliExitError when it is not
// 0; and `agent eval cancel` hands the id to the cancel call with the
// process's stderr; and `agent quality` hands the agent, the checked
// flags and the organization to its dispatch and prints what it returns,
// refusing a flag out of range before connecting. The backend and the
// dispatch are replaced at their module seams (the command imports them
// lazily); the program, the option reading and the effects are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError } from "../../errors/index.js";
import { buildProgram } from "../../program.js";
import type { AgentEvalOptions, AgentTarget } from "../../resources/agent-eval/options.js";
import type { AgentQualityOptions } from "../../resources/agent/quality.js";
import type { EvalIo } from "../../resources/plugin-eval/follow.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
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

const dispatch = vi.hoisted(() => ({ runAgentEval: vi.fn(), cancelAgentEval: vi.fn() }));
vi.mock("../../resources/agent-eval/run.js", () => dispatch);

const quality = vi.hoisted(() => ({ showAgentQuality: vi.fn() }));
vi.mock("../../resources/agent/quality.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../resources/agent/quality.js")>()),
  showAgentQuality: quality.showAgentQuality,
}));

/** Runs `stigmer --org acme agent eval ...`. */
async function agentEval(...args: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "agent", "eval", ...args]);
}

afterEach(() => {
  vi.clearAllMocks();
  backend.connects = 0;
});

describe("the agent group", () => {
  it("registers agent eval, agent eval cancel and agent quality", () => {
    const agent = buildProgram().commands.find((command) => command.name() === "agent");
    const evalCommand = agent?.commands.find((command) => command.name() === "eval");
    expect(agent?.commands.map((command) => command.name())).toEqual(["eval", "quality"]);
    expect(evalCommand?.commands.map((command) => command.name())).toEqual(["cancel"]);
    expect(evalCommand?.options.map((option) => option.long)).not.toContain("--ablation");
  });
});

describe("stigmer agent eval <agent>", () => {
  it("hands the target, the checked options, the organization and the process's effects to the dispatch", async () => {
    dispatch.runAgentEval.mockResolvedValue(0);
    await agentEval(
      "support-desk@v3",
      "--plugin",
      "refund-policy",
      "--plugin",
      "tracker",
      "--model",
      "native/claude-sonnet-4-6",
      "--tag",
      "smoke",
      "fast",
      "--runs",
      "2",
      "--json",
    );

    expect(dispatch.runAgentEval).toHaveBeenCalledTimes(1);
    const [client, org, target, options, io] = dispatch.runAgentEval.mock.calls[0] as [
      unknown,
      string,
      AgentTarget,
      AgentEvalOptions,
      EvalIo,
    ];
    expect(client).toBe(stigmer);
    expect(org).toBe("acme");
    expect(target).toEqual({ ref: "support-desk", version: "v3" });
    expect(options).toMatchObject({
      plugins: ["refund-policy", "tracker"],
      caseTags: ["smoke", "fast"],
      runs: 2,
      targets: [{ modelName: "claude-sonnet-4-6" }],
      json: { kind: "stdout" },
      wait: true,
    });
    expect(io.stdout).toBe(process.stdout);
    expect(io.stderr).toBe(process.stderr);
  });

  it("names no target when no --model is given", async () => {
    dispatch.runAgentEval.mockResolvedValue(0);
    await agentEval("support-desk");
    const options = dispatch.runAgentEval.mock.calls[0]?.[3] as AgentEvalOptions;
    expect(options.targets).toEqual([]);
    expect(options.plugins).toEqual([]);
  });

  it("exits with the dispatch's code, silently, when it is not 0", async () => {
    dispatch.runAgentEval.mockResolvedValue(2);
    const error = await agentEval("support-desk").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(2);
    expect((error as CliExitError).message).toBe("");
  });

  it("refuses a bad option with exit 1 before any call", async () => {
    const error = await agentEval("support-desk@").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect(dispatch.runAgentEval).not.toHaveBeenCalled();
  });
});

describe("stigmer agent eval cancel <eval-id>", () => {
  it("cancels the eval by id and reports on the process's stderr", async () => {
    dispatch.cancelAgentEval.mockResolvedValue(undefined);
    await agentEval("cancel", "aev_1");
    expect(dispatch.cancelAgentEval).toHaveBeenCalledWith(stigmer, "aev_1", { stderr: process.stderr });
    expect(dispatch.runAgentEval).not.toHaveBeenCalled();
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
