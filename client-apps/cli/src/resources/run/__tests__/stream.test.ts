// Tests for streamAgentRun's renderer dispatch: `--json` drives the headless
// driver with the NDJSON renderer, an inline run on a terminal hands the live
// view to Ink, and an inline run off a terminal drives the headless driver
// with the plaintext renderer; every path ends in the epilogue for the run it
// followed and returns the epilogue's final run. The headless driver is wired
// to the run: it follows the run's session from the start of its log, follows
// the run's turn, carries the run's --approve-default, and answers through the
// session's confirmToolUse. The driver, Ink, the terminal probe and the
// epilogue are doubles.
//
// How a run ends (CLI-11): `--until` reaches the view with the run to watch;
// under --download each turn the view sees end is saved as it ends (a turn
// that ended before the view loaded only when it is the run this command
// started), its lines told through the view's notes, and off a terminal the
// one turn is saved once the stream returns; the exit code is the newest
// turn's, through the shared table (CLI-15).

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
const download = vi.hoisted(() => ({ downloadRunOutputs: vi.fn() }));

vi.mock("../../stream/headless.js", () => headless);
vi.mock("../../stream/ink.js", () => ink);
vi.mock("../../stream/tty.js", () => ({ isInkSupported: () => tty.supported }));
vi.mock("../epilogue.js", () => epilogue);
vi.mock("../../download.js", () => download);

import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { exitByTurn, streamAgentRun, turnDownloader, turnExitCode } from "../stream.js";

const FINAL = create(RunSchema, { metadata: { id: "run_1" } });

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
    runId: "run_1",
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
    await d.answer("run_1.c1", { kind: "allow" });
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
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "run_1", DONE);
    expect(result).toBe(FINAL);
    expect(ink.runInkSession).not.toHaveBeenCalled();
  });

  it("binds the driver to the run's session, its turn and its --approve-default", async () => {
    await streamAgentRun(deps({ outputMode: "json" }));

    expect(driverDeps().runId).toBe("run_1");
    expect(driverDeps().approveDefault).toBe("allow");
    expect(followed.map((r) => [r.sessionId, r.afterSeq])).toEqual([["ses_1", 0n]]);
    expect(confirms.map((c) => [c.sessionId, c.toolUseId, c.result])).toEqual([["ses_1", "run_1.c1", "allow"]]);
  });

  it("hands an inline run on a terminal to Ink, then prints the epilogue", async () => {
    tty.supported = true;
    const result = await streamAgentRun(deps());

    expect(ink.runInkSession).toHaveBeenCalledWith({ client, sessionId: "ses_1", org: "acme", mode: "plan", until: "exit", watchRunId: "run_1" });
    expect(headless.runHeadlessStream).not.toHaveBeenCalled();
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "run_1", { phase: "", error: "", turn: undefined });
    expect(result).toBe(FINAL);
  });

  it("takes back the progress lines before Ink draws, and gives the composer the session's folders", async () => {
    tty.supported = true;
    const order: string[] = [];
    ink.runInkSession.mockImplementation(async () => void order.push("ink"));
    await streamAgentRun(deps({ clearProgress: () => void order.push("clear"), workspaceRoots: ["/work/billing"] }));
    expect(order).toEqual(["clear", "ink"]);
    expect(ink.runInkSession).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoots: ["/work/billing"] }));
  });

  it("after Ink, summarises the session's newest turn, not only the one the command started (stigmer#2781)", async () => {
    tty.supported = true;
    const listed = {
      ...client,
      run: {
        listBySession: async () => ({
          entries: [create(RunSchema, { metadata: { id: "run_2" } }), create(RunSchema, { metadata: { id: "run_1" } })],
          nextPageToken: "",
        }),
      },
    } as unknown as Stigmer;
    await streamAgentRun(deps({ client: listed }));
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(listed, "ses_1", "run_2", { phase: "", error: "", turn: undefined });
    // A list that cannot be read, or holds nothing, keeps the run the command started.
    const empty = { ...client, run: { listBySession: async () => ({ entries: [], nextPageToken: "" }) } } as unknown as Stigmer;
    await streamAgentRun(deps({ client: empty }));
    expect(epilogue.runEpilogue).toHaveBeenLastCalledWith(empty, "ses_1", "run_1", { phase: "", error: "", turn: undefined });
  });

  it("opens Ink in agent mode for any mode but plan", async () => {
    tty.supported = true;
    await streamAgentRun(deps({ mode: "" }));
    expect(ink.runInkSession).toHaveBeenCalledWith(expect.objectContaining({ mode: "agent" }));
  });

  it("drives the plaintext renderer for an inline run off a terminal", async () => {
    const result = await streamAgentRun(deps());

    expect(driverDeps().renderer).toBeInstanceOf(PlaintextRenderer);
    expect(epilogue.runEpilogue).toHaveBeenCalledWith(client, "ses_1", "run_1", DONE);
    expect(result).toBe(FINAL);
    expect(ink.runInkSession).not.toHaveBeenCalled();
  });
});

describe("CLI-11 stigmer run ends the way its mode promises", () => {
  const turn = (runId: string) => ({ runId }) as unknown as import("@stigmer/client").Turn;

  beforeEach(() => {
    download.downloadRunOutputs.mockResolvedValue({ total: 1, downloaded: 1, noOutputs: false });
  });

  it("hands --until turn and the run to watch to the view", async () => {
    tty.supported = true;
    await streamAgentRun(deps({ until: "turn", downloadDir: "./out" }));
    expect(ink.runInkSession).toHaveBeenCalledWith(expect.objectContaining({ until: "turn", watchRunId: "run_1", afterTurn: expect.any(Function) }));
  });

  it("saves each turn the view sees end, and of the turns the load found ended only the run it started", async () => {
    const save = turnDownloader(client, "./out", "run_1")!;
    const said: string[] = [];
    await save(turn("run_old"), true, (line) => void said.push(line));
    expect(download.downloadRunOutputs).not.toHaveBeenCalled();
    await save(turn("run_1"), true, (line) => void said.push(line));
    await save(turn("run_2"), false, (line) => void said.push(line));
    expect(download.downloadRunOutputs.mock.calls.map((call) => call[1])).toEqual(["run_1", "run_2"]);
    expect(download.downloadRunOutputs).toHaveBeenCalledWith(client, "run_2", { outputPath: "", outputDir: "./out" }, expect.any(Function));
  });

  it("says a turn saved nothing, and has no action without a directory", async () => {
    download.downloadRunOutputs.mockResolvedValue({ total: 0, downloaded: 0, noOutputs: true });
    const said: string[] = [];
    await turnDownloader(client, "./out", "run_1")!(turn("run_1"), false, (line) => void said.push(line));
    expect(said).toEqual(["No outputs saved in this turn."]);
    expect(turnDownloader(client, "", "run_1")).toBeUndefined();
  });

  it("saves the turn's outputs off a terminal once the stream returns, after the summary", async () => {
    const order: string[] = [];
    epilogue.runEpilogue.mockImplementation(async () => (order.push("summary"), FINAL));
    download.downloadRunOutputs.mockImplementation(async () => (order.push("download"), { total: 1, downloaded: 1, noOutputs: false }));
    const progress = (): void => undefined;
    await streamAgentRun(deps({ downloadDir: "./out", progress }));
    expect(order).toEqual(["summary", "download"]);
    expect(download.downloadRunOutputs).toHaveBeenCalledWith(client, "run_1", { outputPath: "", outputDir: "./out" }, progress);
  });

  it("saves nothing off a terminal without --download", async () => {
    await streamAgentRun(deps({ outputMode: "json" }));
    expect(download.downloadRunOutputs).not.toHaveBeenCalled();
  });
});

describe("CLI-15 a run's exit code says how its turn ended", () => {
  const runIn = (phase: RunPhase) => create(RunSchema, { metadata: { id: "run_1" }, status: { phase } });

  it.each([
    [RunPhase.RUN_COMPLETED, 0],
    [RunPhase.RUN_FAILED, 1],
    [RunPhase.RUN_CANCELLED, 1],
    [RunPhase.RUN_TERMINATED, 1],
    [RunPhase.RUN_IN_PROGRESS, 130],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, 130],
    [RunPhase.RUN_PHASE_UNSPECIFIED, 1],
  ])("reads run phase %i as exit %i, from the shared table", (phase, code) => {
    expect(turnExitCode(runIn(phase))).toBe(code);
  });

  it("exits silently by that code, and not at all for a completed turn", () => {
    expect(() => exitByTurn(runIn(RunPhase.RUN_COMPLETED))).not.toThrow();
    expect(() => exitByTurn(runIn(RunPhase.RUN_FAILED))).toThrow(expect.objectContaining({ exitCode: 1, message: "" }));
    expect(() => exitByTurn(create(RunSchema, {}))).toThrow(expect.objectContaining({ exitCode: 1 }));
  });
});
