// Tests for streamAgentRun's renderer dispatch: `--json` drives the headless
// driver with the NDJSON renderer, an inline run on a terminal hands the live
// view to Ink, and an inline run off a terminal drives the headless driver
// with the plaintext renderer; every path ends in the epilogue for the run it
// followed and returns the epilogue's final run. The headless driver is wired
// to the run: it follows the run's session from the start of its log, follows
// the run's turn, carries the run's --approve-default, and answers through the
// session's confirmToolUse. The driver, Ink, the terminal probe and the
// epilogue are doubles.

import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type {
  ConfirmToolUseInput,
  StreamSessionEventsRequest,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
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

const FINAL = create(RunSchema, { metadata: { id: "aex_1" } });

let followed: StreamSessionEventsRequest[];
let confirms: ConfirmToolUseInput[];

const client = {
  session: {
    streamEvents: (input: StreamSessionEventsRequest) => {
      followed.push(input);
      return (async function* () {})();
    },
    confirmToolUse: async (input: ConfirmToolUseInput) => {
      confirms.push(input);
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
    approveDefault: "allow",
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

const DONE = { phase: "completed", error: "", turn: undefined };

beforeEach(() => {
  followed = [];
  confirms = [];
  tty.supported = false;
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  headless.runHeadlessStream.mockImplementation(async (d: HeadlessStreamDeps) => {
    // Exercise the session-bound callbacks the way the driver does: open the
    // follow (the double's stream ends at once), then stop it before it
    // reconnects, and answer one ask.
    const controller = new AbortController();
    const opened = d.follow(controller.signal)[Symbol.asyncIterator]().next();
    controller.abort();
    await opened;
    await d.answer("aex_1.c1", { kind: "allow" });
    return DONE;
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
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "aex_1", DONE);
    expect(result).toBe(FINAL);
    expect(ink.runInkSession).not.toHaveBeenCalled();
  });

  it("binds the driver to the run's session, its turn and its --approve-default", async () => {
    await streamAgentRun(deps({ outputMode: "json" }));

    expect(driverDeps().runId).toBe("aex_1");
    expect(driverDeps().approveDefault).toBe("allow");
    expect(followed.map((r) => [r.sessionId, r.afterSeq])).toEqual([["ses_1", 0n]]);
    expect(confirms.map((c) => [c.sessionId, c.toolUseId, c.result])).toEqual([["ses_1", "aex_1.c1", "allow"]]);
  });

  it("hands an inline run on a terminal to Ink, then prints the epilogue", async () => {
    tty.supported = true;
    const result = await streamAgentRun(deps());

    expect(ink.runInkSession).toHaveBeenCalledWith({ client, sessionId: "ses_1", org: "acme", mode: "plan" });
    expect(headless.runHeadlessStream).not.toHaveBeenCalled();
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "aex_1", { phase: "", error: "", turn: undefined });
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
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "aex_1", DONE);
    expect(result).toBe(FINAL);
    expect(ink.runInkSession).not.toHaveBeenCalled();
  });
});
