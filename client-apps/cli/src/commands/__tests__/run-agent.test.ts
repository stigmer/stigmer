// Command-level contract for `stigmer run <agent>`: the spec of the agent
// the command resolved reaches the prelude, so the agent's run defaults seed
// the run. An agent naming the claude engine runs on claude with no flag, and
// its model is left to the server (the run carries none), ahead of any
// account preference. The built-in assistant names no agent and so seeds
// nothing. The layering itself is pinned in
// resources/run/__tests__/prepare.test.ts; this proves the command wires it.
//
// How the run ends reaches the execute step: --until (exit unless turn; any
// other word refused), the download directory and the output mode; and
// --download with --detach is refused, since a detached run never waits for
// its turn.
//
// The backend client, the agent lookup and the execute step are replaced at
// their modules (the command imports them lazily), so the test is offline and
// deterministic. The fake server serves no account preferences, so the only
// seed in play is the agent's.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { Config } from "../../config/index.js";
import type { BackendClient } from "../../client/index.js";
import type { PreparedRun } from "../../resources/run/prepare.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const prepared: PreparedRun[] = [];
const executed: Array<{ readonly until?: string; readonly downloadDir: string; readonly outputMode: string }> = [];

vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  return { ...actual, load: () => CONFIG };
});

vi.mock("../../backend.js", () => ({
  connectBackend: (): BackendClient =>
    ({
      stigmer: { run: {} },
      config: CONFIG,
      isResourceAvailable: () => Promise.resolve(false),
    }) as unknown as BackendClient,
}));

vi.mock("../../resources/run/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/run/resolve.js")>();
  return {
    ...actual,
    resolveAgentRef: async () =>
      create(AgentSchema, {
        metadata: { id: "agt_reviewer" },
        spec: { harness: Harness.CLAUDE, runConfig: { modelName: "claude-sonnet-5" } },
      }),
  };
});

vi.mock("../../resources/run/agent-exec.js", () => ({
  executeResolvedAgent: async (input: { readonly prepared: PreparedRun; readonly until?: string; readonly downloadDir: string; readonly outputMode: string }) => {
    prepared.push(input.prepared);
    executed.push(input);
  },
}));

async function run(...args: string[]): Promise<PreparedRun | undefined> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--org", "acme", "run", ...args]);
  return prepared.at(-1);
}

describe("stigmer run seeds the run from the resolved agent's run defaults", () => {
  beforeEach(() => {
    prepared.length = 0;
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs on the engine the agent names and leaves its model to the server", async () => {
    const started = await run("reviewer", "-m", "review this");
    expect(started?.harness).toBe("claude");
    expect(started?.model).toBe("");
  });

  it("an explicit --harness outranks the agent's engine", async () => {
    const started = await run("reviewer", "-m", "review this", "--harness", "stigmer");
    expect(started?.harness).toBe("stigmer");
  });

  it("the built-in assistant names no agent, so nothing seeds the engine", async () => {
    const started = await run("-m", "hello");
    expect(started?.harness).toBe("");
  });
});

describe("CLI-11 stigmer run takes how it ends from --until", () => {
  beforeEach(() => {
    executed.length = 0;
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns at the turn's end under --until turn, and stays a conversation by default", async () => {
    await run("reviewer", "-m", "review this", "--until", "turn", "--download", "./out");
    expect(executed.at(-1)).toMatchObject({ until: "turn", downloadDir: "./out", outputMode: "inline" });
    await run("reviewer", "-m", "review this");
    expect(executed.at(-1)).toMatchObject({ until: "exit", downloadDir: "" });
  });

  it("streams JSON lines for -o json and for --json", async () => {
    await run("reviewer", "-m", "review this", "-o", "json");
    expect(executed.at(-1)?.outputMode).toBe("json");
    await run("reviewer", "-m", "review this", "--json");
    expect(executed.at(-1)?.outputMode).toBe("json");
  });

  it("refuses an --until it does not know, and --download with --detach, before anything runs", async () => {
    await expect(run("reviewer", "-m", "x", "--until", "done")).rejects.toMatchObject({
      exitCode: 2,
      message: 'invalid --until value "done" (expected turn or exit)',
    });
    await expect(run("reviewer", "-m", "x", "--detach", "--download", "./out")).rejects.toMatchObject({
      exitCode: 2,
      message: "--download waits for the turn; --detach does not",
    });
    expect(executed).toEqual([]);
  });
});
