// Command-level contract for `stigmer list runs`: runs resolve before the
// registry and list runs; the resolved organization, `--limit` and the
// `--label` filter reach the list call, and the result renders through the
// run table on stdout. A malformed or repeated label is refused before any
// call, and `list types` refuses a label it has nothing to filter by. The backend and the list read are replaced at their module seams;
// the program, the alias routing and the renderer are real.

import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunListSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
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
  schema: RunListSchema,
  message: create(RunListSchema, {
    entries: [
      create(RunSchema, {
        metadata: { id: "run_1" },
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
  it("lists runs in the resolved organization, with the default limit", async () => {
    const out = await listRuns();
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme", {});
    expect(out).toContain("AGENT");
    expect(out).toContain("run_1");
    expect(out).toContain("completed");
  });

  it("honours --limit", async () => {
    await listRuns("--limit", "5");
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 5, "acme", {});
  });

  it("passes every --label pair as the request's labels, a value split at the first =", async () => {
    await listRuns("--label", "team=support", "-l", "tier=", "-l", "query=a=b");
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme", {
      team: "support",
      tier: "",
      query: "a=b",
    });
  });

  it("refuses a label that is not key=value, before any call", async () => {
    for (const bad of ["team", "=support"]) {
      await expect(listRuns("--label", bad)).rejects.toThrow(`invalid --label "${bad}": want key=value`);
    }
    expect(reads.listAgentRuns).not.toHaveBeenCalled();
  });

  it("refuses one key given twice", async () => {
    await expect(listRuns("-l", "team=a", "-l", "team=b")).rejects.toThrow('--label "team" is given twice');
    expect(reads.listAgentRuns).not.toHaveBeenCalled();
  });

  it("keeps a __proto__ key as a label, not the map's prototype", async () => {
    await listRuns("-l", "__proto__=x");
    const labels = reads.listAgentRuns.mock.calls[0]?.[3] as Record<string, string>;
    expect(Object.keys(labels)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
  });

  it("refuses --label on list types", async () => {
    const program = buildProgram();
    program.exitOverride();
    await expect(
      program.parseAsync(["node", "stigmer", "--standalone", "list", "types", "--label", "team=a"]),
    ).rejects.toThrow("--label filters resources; 'list types' has none to filter");
  });

  it("accepts the singular alias", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "list", "run"]);
    expect(reads.listAgentRuns).toHaveBeenCalledWith(stigmer, 50, "acme", {});
  });
});
