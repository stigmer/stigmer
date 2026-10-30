// Pins runInTerminal (INK-06): it starts the turn, shows it, and returns when
// that turn ends with the turn's phase and the shared exit code (completed 0;
// failed, cancelled or terminated 1); `signal` and Ctrl+C return at once with
// the phase at that moment and 130; `until: "exit"` keeps the conversation
// open on a terminal until the person quits, and returns at the turn's end off
// one; a start failure is written for a person and rejects with its exit code
// (3 with no server), and so does a session that cannot load. The view's
// conversation is a scripted store; the client is a double that creates the
// run; the streams are fakes with the TTY flags under test.
import React from "react";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Stigmer, Turn } from "@stigmer/client";
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import { samples } from "@stigmer/react-sdk/test";
import { runInTerminal, TerminalRunError } from "../run/run-in-terminal.js";

const RUN = "run_terminal";

/** The scripted conversation the view renders, with the store's listeners. */
const store = {
  state: {} as UseSessionConversationReturn,
  listeners: new Set<() => void>(),
  set(next: Partial<UseSessionConversationReturn>) {
    store.state = { ...store.state, ...next };
    for (const listener of store.listeners) listener();
  },
};

vi.mock("@stigmer/react-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-core")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    useSessionConversation: () =>
      useSyncExternalStore(
        (listener) => {
          store.listeners.add(listener);
          return () => store.listeners.delete(listener);
        },
        () => store.state,
      ),
    useSessionUsage: () => ({ hasUsage: false }) as unknown as ReturnType<typeof actual.useSessionUsage>,
  };
});

function conversation(turns: readonly Turn[], overrides: Partial<UseSessionConversationReturn> = {}): UseSessionConversationReturn {
  return {
    session: undefined,
    isLoading: false,
    loadError: null,
    turns,
    runs: [],
    activeTurn: null,
    activeRun: null,
    activePhase: null,
    isConnecting: false,
    isReconnecting: false,
    streamError: null,
    sendFollowUp: async () => {},
    canSendFollowUp: true,
    isSending: false,
    sendError: null,
    pendingUserMessage: null,
    queued: [],
    asks: [],
    answerToolUse: async () => {},
    answeringToolUseIds: new Set<string>(),
    answerError: null,
    fileReviewSets: [],
    fileChangeCaptures: new Map(),
    fileChangeProgress: undefined,
    reviewFileChanges: async () => {},
    submittingFileDecisionKeys: new Set<string>(),
    fileDecisionErrors: new Map<string, Error>(),
    fileReviewError: null,
    ...overrides,
  } as unknown as UseSessionConversationReturn;
}

class FakeStdout extends EventEmitter {
  readonly columns = 100;
  readonly rows = 40;
  readonly frames: string[] = [];
  constructor(readonly isTTY: boolean) {
    super();
  }
  write = (frame: string, callback?: () => void) => {
    this.frames.push(frame);
    callback?.();
    return true;
  };
}

class FakeStdin extends EventEmitter {
  private data: string | null = null;
  constructor(readonly isTTY: boolean) {
    super();
  }
  press(data: string) {
    this.data = data;
    this.emit("readable");
  }
  read = () => {
    const { data } = this;
    this.data = null;
    return data;
  };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

function streams(tty: boolean) {
  return {
    stdin: new FakeStdin(tty) as unknown as NodeJS.ReadStream,
    stdout: new FakeStdout(tty) as unknown as NodeJS.WriteStream,
    stderr: new FakeStdout(false) as unknown as NodeJS.WriteStream,
    env: {},
  };
}

function clientThat(create_: () => Promise<unknown>): Stigmer {
  return {
    baseUrl: "http://localhost:7234",
    run: { create: create_ },
    session: { listEvents: async () => ({ events: [] }) },
  } as unknown as Stigmer;
}

const startsRun = () =>
  clientThat(async () => create(RunSchema, { metadata: { id: RUN }, spec: { target: { case: "sessionId", value: "ses_1" } } }));

const INPUT = { org: "acme", sessionSpec: { agentRef: { org: "acme", slug: "reviewer" } }, message: "Review this diff" };

/** Lets the view render and its effects run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  store.listeners.clear();
});

describe("INK-06 runInTerminal returns when the turn ends", () => {
  it.each([
    ["completed", 0],
    ["failed", 1],
    ["cancelled", 1],
    ["terminated", 1],
  ] as const)("a %s turn returns with exit code %i", async (phase, exitCode) => {
    store.state = conversation([samples.turn({ runId: RUN, phase: "running" })]);
    const run = runInTerminal(startsRun(), INPUT, streams(true));
    await tick();
    store.set({ turns: [samples.turn({ runId: RUN, phase, reply: "Looks safe to ship." })] });
    const outcome = await run;
    expect([outcome.phase, outcome.exitCode, outcome.runId, outcome.sessionId]).toEqual([phase, exitCode, RUN, "ses_1"]);
    expect(outcome.answer).toBe("Looks safe to ship.");
  });

  it("waits for its own run's turn, not another run's that already ended", async () => {
    const earlier = samples.turn({ runId: "run_earlier", phase: "completed" });
    store.state = conversation([earlier, samples.turn({ runId: RUN, phase: "running" })]);
    const controller = new AbortController();
    const run = runInTerminal(startsRun(), INPUT, { ...streams(true), signal: controller.signal });
    await tick();
    controller.abort();
    expect(await run).toMatchObject({ runId: RUN, phase: "running", exitCode: 130 });
  });

  it("does not return for a turn marked ended before its status says how", async () => {
    store.state = conversation([{ ...samples.turn({ runId: RUN, phase: "running" }), status: undefined, ended: true } as Turn]);
    const controller = new AbortController();
    let settled = false;
    const run = runInTerminal(startsRun(), INPUT, { ...streams(true), signal: controller.signal }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await tick();
    expect(settled).toBe(false);
    controller.abort();
    expect(await run).toMatchObject({ phase: "pending", exitCode: 130 });
  });

  it("returns at once when the host's signal fires, with the phase then and 130", async () => {
    store.state = conversation([samples.turn({ runId: RUN, phase: "running" })]);
    const controller = new AbortController();
    const run = runInTerminal(startsRun(), INPUT, { ...streams(true), signal: controller.signal });
    await tick();
    controller.abort();
    const outcome = await run;
    expect([outcome.phase, outcome.exitCode]).toEqual(["running", 130]);
  });

  it("returns on Ctrl+C on a terminal with 130", async () => {
    store.state = conversation([samples.turn({ runId: RUN, phase: "running" })]);
    const io = streams(true);
    const run = runInTerminal(startsRun(), INPUT, io);
    await tick();
    (io.stdin as unknown as FakeStdin).press("\u0003");
    expect((await run).exitCode).toBe(130);
  });

  it("with until exit keeps the conversation open past the turn's end on a terminal", async () => {
    store.state = conversation([samples.turn({ runId: RUN, phase: "completed" })]);
    const io = streams(true);
    let settled = false;
    const run = runInTerminal(startsRun(), INPUT, { ...io, until: "exit" }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await tick();
    expect(settled).toBe(false);
    (io.stdin as unknown as FakeStdin).press("\u0003");
    expect(await run).toMatchObject({ phase: "completed", exitCode: 0 });
  });

  it("off a terminal returns at the turn's end even with until exit, writing the final frame", async () => {
    store.state = conversation([samples.turn({ runId: RUN, phase: "completed", reply: "Done." })]);
    const io = streams(false);
    const outcome = await runInTerminal(startsRun(), INPUT, { ...io, until: "exit" });
    expect(outcome.exitCode).toBe(0);
    expect((io.stdout as unknown as FakeStdout).frames.join("")).toContain("Done.");
  });

  it("off a terminal settles an ask by approveDefault through the view", async () => {
    const answers: unknown[][] = [];
    const ask = samples.toolUse("execute", undefined, { runId: RUN });
    store.state = conversation([samples.turn({ runId: RUN, phase: "running" })], {
      asks: [ask],
      answerToolUse: async (...args: unknown[]) => void answers.push(args),
    });
    const run = runInTerminal(startsRun(), INPUT, { ...streams(false), approveDefault: "approve" });
    await tick();
    store.set({ asks: [], turns: [samples.turn({ runId: RUN, phase: "completed" })] });
    await run;
    expect(answers).toEqual([[ask.id, "allow", undefined]]);
  });

  it("a turn that cannot start is written for a person and rejects with its exit code", async () => {
    const io = streams(true);
    const refused = clientThat(async () => {
      throw new ConnectError("connect ECONNREFUSED 127.0.0.1:7234", Code.Unavailable);
    });
    const error = await runInTerminal(refused, INPUT, io).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TerminalRunError);
    expect((error as TerminalRunError).exitCode).toBe(3);
    expect((error as TerminalRunError).name).toBe("TerminalRunError");
    expect((error as TerminalRunError).message).toBe("Could not start the run at http://localhost:7234. Unable to connect to the server.");
    expect((error as TerminalRunError).cause).toBeInstanceOf(ConnectError);
    const written = (io.stderr as unknown as FakeStdout).frames.join("");
    expect(written).toContain("Could not start the run at http://localhost:7234.");
    expect(written).toContain("Is the server running?");
  });

  it("a session that cannot load rejects with its exit code", async () => {
    store.state = conversation([], { loadError: new ConnectError("no such session", Code.NotFound) });
    const error = await runInTerminal(startsRun(), INPUT, streams(false)).catch((e: unknown) => e);
    expect((error as TerminalRunError).exitCode).toBe(5);
    expect((error as TerminalRunError).message).toMatch(/^Could not load the session from http:\/\/localhost:7234\. /);
  });

  it("a wait stopped before the turn's first event returns pending with 130", async () => {
    store.state = conversation([]);
    const controller = new AbortController();
    controller.abort();
    const outcome = await runInTerminal(startsRun(), INPUT, { ...streams(true), signal: controller.signal });
    expect(outcome).toMatchObject({ phase: "pending", turn: undefined, exitCode: 130, answer: "", stopCause: "", error: "", asks: [] });
  });
});
