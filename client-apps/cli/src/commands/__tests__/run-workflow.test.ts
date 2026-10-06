// Command-level contract for `stigmer run workflow`: the run's environment
// carries STIGMER_ORG, naming the organization the command resolved, so a
// workflow's agents and skills can call back into it without being told. A
// value the caller set explicitly wins. The agent path pins the same rule in
// resources/run/__tests__/prepare.test.ts; this is the workflow path.
// Without `--detach` the command streams the created run: the stream is
// handed the run id, the output mode and the approval default the flags
// chose (`--auto-approve` is approve-all).
//
// The workflow lookup and the run create are replaced at their modules
// (the command imports them lazily), and `--detach` returns as soon as the
// run exists, so the test is offline and deterministic. The config is an
// authenticated cloud context; `--org` names the organization.

import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
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
    createWorkflowRun: async (_controller: unknown, input: CreatedExecution) => {
      created.push(input);
      return { metadata: { id: "wfx_1" } };
    },
  };
});

const stream = vi.hoisted(() => ({ streamWorkflowRun: vi.fn() }));
vi.mock("../../resources/run/workflow-stream.js", () => stream);

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
    stream.streamWorkflowRun.mockReset();
  });

  it("names the resolved organization when the caller set none", async () => {
    const execution = await runWorkflow();
    expect(execution?.workflowId).toBe("wfl_nightly");
    expect(execution?.runtimeEnv.STIGMER_ORG).toEqual({ value: "acme", isSecret: false });
  });

  it("streams the created run when not detached, approving all under --auto-approve", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--org", "acme", "run", "workflow", "nightly", "--json", "--auto-approve"]);
    expect(stream.streamWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "wfx_1", outputMode: "json", defaultAction: ApprovalAction.APPROVE_ALL }),
    );
  });

  it("streams with the --approve-default action when approval is not automatic", async () => {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "stigmer", "--org", "acme", "run", "workflow", "nightly", "--json", "--approve-default", "reject"]);
    expect(stream.streamWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "wfx_1", defaultAction: ApprovalAction.REJECT }),
    );
  });

  it("keeps a value the caller set explicitly", async () => {
    const execution = await runWorkflow("--env", "STIGMER_ORG=explicit");
    expect(execution?.runtimeEnv.STIGMER_ORG).toEqual({ value: "explicit", isSecret: false });
  });
});
