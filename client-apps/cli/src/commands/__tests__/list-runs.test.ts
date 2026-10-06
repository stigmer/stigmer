// Command-level contract for `stigmer list runs`: runs resolve before the
// registry and list agent runs unless `--type workflow` (or `wf`) asks for
// workflow runs; an unknown `--type` is a usage error naming the valid values;
// the resolved organization and `--limit` reach the list call, and the result
// renders through the run tables on stdout. The backend and the two list
// reads are replaced at their module seams; the program, the alias routing
// and the renderers are real.

import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { WorkflowRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
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

const reads = vi.hoisted(() => ({ listAgentRuns: vi.fn(), listWorkflowRuns: vi.fn() }));
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

const workflowRuns = {
  schema: WorkflowRunListSchema,
  message: create(WorkflowRunListSchema, {
    entries: [
      create(WorkflowRunSchema, {
        metadata: { id: "wex_1" },
        spec: { workflowId: "wfl_nightly" },
        status: { phase: WorkflowRunPhase.RUN_FAILED },
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
  reads.listWorkflowRuns.mockResolvedValue(workflowRuns);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer list runs", () => {
  it("lists agent runs by default, in the resolved organization, with the default limit", async () => {
    const out = await listRuns();
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme");
    expect(reads.listWorkflowRuns).not.toHaveBeenCalled();
    expect(out).toContain("AGENT");
    expect(out).toContain("aex_1");
    expect(out).toContain("completed");
  });

  it("lists workflow runs for --type workflow, honouring --limit", async () => {
    const out = await listRuns("--type", "workflow", "--limit", "5");
    expect(reads.listWorkflowRuns).toHaveBeenCalledWith(stigmer, 5, "acme");
    expect(reads.listAgentRuns).not.toHaveBeenCalled();
    expect(out).toContain("WORKFLOW");
    expect(out).toContain("wex_1");
    expect(out).toContain("wfl_nightly");
    expect(out).toContain("failed");
  });

  it("accepts wf as the workflow filter, in any case", async () => {
    await listRuns("--type", " WF ");
    expect(reads.listWorkflowRuns).toHaveBeenCalledTimes(1);
  });

  it("accepts the singular alias and an explicit agent filter", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "list", "run", "--type", "agent"]);
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme");
  });

  it("refuses an unknown run type filter, naming the valid values", async () => {
    await expect(listRuns("--type", "session")).rejects.toThrow(
      new UsageError("unknown run type filter: session\n\nValid values: agent, workflow"),
    );
    expect(reads.listAgentRuns).not.toHaveBeenCalled();
    expect(reads.listWorkflowRuns).not.toHaveBeenCalled();
  });
});
