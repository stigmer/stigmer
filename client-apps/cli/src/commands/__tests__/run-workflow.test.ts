// Command-level contract for `stigmer run workflow`: the run's environment
// carries STIGMER_ORG, naming the organization the command resolved, so a
// workflow's agents and skills can call back into it without being told. A
// value the caller set explicitly wins. The agent path pins the same rule in
// resources/run/__tests__/prepare.test.ts; this is the workflow path.
//
// The workflow lookup and the execution create are replaced at their modules
// (the command imports them lazily), and `--detach` returns as soon as the
// execution exists, so the test is offline and deterministic. The config is an
// authenticated cloud context; `--org` names the organization.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { buildProgram } from "../../program.js";

interface CreatedExecution {
  readonly workflowId: string;
  readonly runtimeEnv: Record<string, { readonly value: string; readonly isSecret: boolean }>;
}

const created: CreatedExecution[] = [];

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  const config: Config = {
    backend: { type: "cloud" },
    backends: { cloud: { type: "cloud", token: "test-token" } },
    current_backend: "cloud",
  };
  return { ...actual, load: () => config };
});

vi.mock("../../resources/run/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/run/resolve.js")>();
  return {
    ...actual,
    resolveWorkflowRef: async () => ({ metadata: { id: "wfl_nightly" } }),
  };
});

vi.mock("../../resources/run/create.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/run/create.js")>();
  return {
    ...actual,
    createWorkflowExecution: async (_controller: unknown, input: CreatedExecution) => {
      created.push(input);
      return { metadata: { id: "wfx_1" } };
    },
  };
});

async function runWorkflow(...flags: string[]): Promise<CreatedExecution | undefined> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--org", "acme", "run", "workflow", "nightly", "--detach", ...flags]);
  return created.at(-1);
}

describe("stigmer run workflow sets STIGMER_ORG in the run's environment", () => {
  beforeEach(() => {
    created.length = 0;
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the resolved organization when the caller set none", async () => {
    const execution = await runWorkflow();
    expect(execution?.workflowId).toBe("wfl_nightly");
    expect(execution?.runtimeEnv.STIGMER_ORG).toEqual({ value: "acme", isSecret: false });
  });

  it("keeps a value the caller set explicitly", async () => {
    const execution = await runWorkflow("--env", "STIGMER_ORG=explicit");
    expect(execution?.runtimeEnv.STIGMER_ORG).toEqual({ value: "explicit", isSecret: false });
  });
});
