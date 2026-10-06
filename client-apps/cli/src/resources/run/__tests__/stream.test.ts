// Tests for streamAgentRun's renderer dispatch: `--json` drives the headless
// driver with the NDJSON renderer, an inline run on a terminal hands the live
// view to Ink, and an inline run off a terminal drives the headless driver
// with the plaintext renderer; every path ends in the epilogue for the run it
// followed and returns the epilogue's final run. The headless driver is wired
// to the run: it subscribes to the run's id and submits approvals naming it.
// The driver, Ink, the terminal probe and the epilogue are doubles.

import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadlessStreamDeps } from "../../stream/headless.js";
import { NdjsonRenderer } from "../../stream/render-ndjson.js";
import { PlaintextRenderer } from "../../stream/render-plaintext.js";
import type { StreamDeps } from "../stream.js";

const headless = vi.hoisted(() => ({ runHeadlessStream: vi.fn() }));
const ink = vi.hoisted(() => ({ runInkSession: vi.fn() }));
const tty = vi.hoisted(() => ({ supported: false }));
const epilogue = vi.hoisted(() => ({ runEpilogue: vi.fn() }));

vi.mock("../../stream/headless.js", () => headless);
vi.mock("../../stream/ink.js", () => ink);
vi.mock("../../stream/tty.js", () => ({ isInkSupported: () => tty.supported }));
vi.mock("../epilogue.js", () => epilogue);

import { streamAgentRun } from "../stream.js";

const FINAL = create(AgentRunSchema, { metadata: { id: "aex_1" } });

let subscribed: string[];
let approvals: SubmitApprovalInput[];

const client = {
  agentRun: {
    subscribe: (runId: string) => {
      subscribed.push(runId);
      return (async function* () {})();
    },
    submitApproval: async (input: SubmitApprovalInput) => {
      approvals.push(input);
      return FINAL;
    },
  },
} as unknown as Stigmer;

function deps(overrides: Partial<StreamDeps> = {}): StreamDeps {
  return {
    client,
    sessionId: "ses_1",
    runId: "aex_1",
    org: "acme",
    mode: "plan",
    defaultAction: ApprovalAction.UNSPECIFIED,
    outputMode: "inline",
    header: { agentName: "Helper", sessionId: "ses_1", model: "", mode: "plan", workspaces: [] },
    ...overrides,
  };
}

/** The deps the stubbed headless driver was last called with. */
function driverDeps(): HeadlessStreamDeps {
  const call = headless.runHeadlessStream.mock.calls.at(-1);
  if (call === undefined) throw new Error("the headless driver was not called");
  return call[0] as HeadlessStreamDeps;
}

beforeEach(() => {
  subscribed = [];
  approvals = [];
  tty.supported = false;
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  headless.runHeadlessStream.mockImplementation(async (d: HeadlessStreamDeps) => {
    // Exercise the run-bound callbacks the way the driver does.
    for await (const _snapshot of d.subscribe(d.signal)) {
      // The double's stream is empty.
    }
    await d.submitApproval("tc_1", ApprovalAction.APPROVE);
    return { phase: "completed", error: "" };
  });
  ink.runInkSession.mockResolvedValue(undefined);
  epilogue.runEpilogue.mockResolvedValue(FINAL);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("streamAgentRun", () => {
  it("drives the NDJSON renderer for --json and ends in the epilogue with the driver's result", async () => {
    const result = await streamAgentRun(deps({ outputMode: "json" }));

    expect(driverDeps().renderer).toBeInstanceOf(NdjsonRenderer);
    expect(driverDeps().sessionId).toBe("ses_1");
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "aex_1", { phase: "completed", error: "" });
    expect(result).toBe(FINAL);
    expect(ink.runInkSession).not.toHaveBeenCalled();
  });

  it("binds the driver's subscription and approvals to the run", async () => {
    await streamAgentRun(deps({ outputMode: "json" }));

    expect(subscribed).toEqual(["aex_1"]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.agentRunId).toBe("aex_1");
    expect(approvals[0]?.toolCallId).toBe("tc_1");
    expect(approvals[0]?.action).toBe(ApprovalAction.APPROVE);
  });

  it("hands an inline run on a terminal to Ink, then prints the epilogue", async () => {
    tty.supported = true;
    const result = await streamAgentRun(deps());

    expect(ink.runInkSession).toHaveBeenCalledWith({ client, sessionId: "ses_1", org: "acme", mode: "plan" });
    expect(headless.runHeadlessStream).not.toHaveBeenCalled();
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "aex_1", { phase: "", error: "" });
    expect(result).toBe(FINAL);
  });

  it("opens Ink in agent mode for any mode but plan", async () => {
    tty.supported = true;
    await streamAgentRun(deps({ mode: "" }));
    expect(ink.runInkSession).toHaveBeenCalledWith(expect.objectContaining({ mode: "agent" }));
  });

  it("drives the plaintext renderer for an inline run off a terminal", async () => {
    const result = await streamAgentRun(deps());

    expect(driverDeps().renderer).toBeInstanceOf(PlaintextRenderer);
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "aex_1", { phase: "completed", error: "" });
    expect(result).toBe(FINAL);
    expect(ink.runInkSession).not.toHaveBeenCalled();
  });
});
