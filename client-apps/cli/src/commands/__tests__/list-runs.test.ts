// Command-level contract for `stigmer list runs`: runs resolve before the
// registry and list agent runs; the resolved organization and `--limit`
// reach the list call, and the result renders through the run table on
// stdout. The backend and the list read are replaced at their module seams;
// the program, the alias routing and the renderer are real.

import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
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

const reads = vi.hoisted(() => ({ listAgentRuns: vi.fn() }));
vi.mock("../../resources/runs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/runs.js")>();
  return { ...actual, ...reads };
});

const agentRuns = {
  schema: AgentRunListSchema,
  message: create(AgentRunListSchema, {
    entries: [
      create(AgentRunSchema, {
        metadata: { id: "aex_1" },
        status: { agentId: "agt_1", phase: RunPhase.RUN_COMPLETED },
      }),
    ],
  }),
};

let stdout: string[];

/** Runs `stigmer --org acme list runs ...`, returning what it wrote to stdout. */
async function listRuns(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "list", "runs", ...args]);
  return stdout.join("");
}

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  reads.listAgentRuns.mockResolvedValue(agentRuns);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer list runs", () => {
  it("lists agent runs in the resolved organization, with the default limit", async () => {
    const out = await listRuns();
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme");
    expect(out).toContain("AGENT");
    expect(out).toContain("aex_1");
    expect(out).toContain("completed");
  });

  it("honours --limit", async () => {
    await listRuns("--limit", "5");
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 5, "acme");
  });

  it("accepts the singular alias", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "list", "run"]);
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme");
  });
});
