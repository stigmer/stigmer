// Pins runCli, stigmer-ink's work: help exits 0 and a usage error exits 2
// with the usage; a message starts a conversation with an agent or sends into
// a session through runInTerminal and exits with its outcome's code, with the
// streams, signal and options passed through; a turn that could not start
// keeps its TerminalRunError's code without a second message, and any other
// failure is written once; watching a session off a terminal returns when
// its newest turn ended, with that turn's code (or the load failure's), and
// settles no ask (they belong to whoever answers that session); a stopped
// watch exits 130.
import React from "react";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Stigmer, Turn } from "@stigmer/client";
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import { samples } from "@stigmer/react-sdk/test";
import { runCli, type CliIo } from "../cli/main.js";
import { TerminalRunError, type TerminalOutcome } from "../run/run-in-terminal.js";

let turns: readonly Turn[] = [];
let loadError: Error | null = null;
let asks: readonly unknown[] = [];
const answered: unknown[][] = [];

vi.mock("@stigmer/react-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-core")>();
  return {
    ...actual,
    useSessionConversation: () =>
      ({ isLoading: false, loadError, turns, runs: [], asks, answerToolUse: async (...args: unknown[]) => void answered.push(args), fileReviewSets: [], fileChangeCaptures: new Map(), answeringToolUseIds: new Set(), submittingFileDecisionKeys: new Set(), fileDecisionErrors: new Map(), queued: [], activePhase: null, canSendFollowUp: false }) as unknown as UseSessionConversationReturn,
    useSessionUsage: () => ({ hasUsage: false }) as unknown as ReturnType<typeof actual.useSessionUsage>,
  };
});

class Out extends EventEmitter {
  readonly columns = 100;
  readonly text: string[] = [];
  constructor(readonly isTTY = false) {
    super();
  }
  write = (chunk: string, callback?: () => void) => {
    this.text.push(chunk);
    callback?.();
    return true;
  };
}

function io(signal = new AbortController().signal): CliIo & { out: Out; err: Out } {
  const out = new Out();
  const err = new Out();
  const stdin = Object.assign(new EventEmitter(), { isTTY: false, setEncoding() {}, setRawMode() {}, ref() {}, unref() {}, read: () => null });
  return { stdin: stdin as unknown as NodeJS.ReadStream, stdout: out as unknown as NodeJS.WriteStream, stderr: err as unknown as NodeJS.WriteStream, env: {}, signal, out, err };
}

const client = { baseUrl: "http://localhost:7234" } as unknown as Stigmer;

describe("runCli", () => {
  it("prints the usage for --help and exits 0", async () => {
    const proc = io();
    expect(await runCli(["--help"], proc)).toBe(0);
    expect(proc.out.text.join("")).toContain("stigmer-ink --agent <org/slug> --message <text>");
  });

  it("refuses a usage error with exit 2 and the usage", async () => {
    const proc = io();
    expect(await runCli(["--agent", "acme"], proc)).toBe(2);
    expect(proc.err.text.join("")).toMatch(/^stigmer-ink: --agent takes org\/slug/);
  });

  it("starts a conversation with an agent and exits with the turn's code", async () => {
    const proc = io();
    const run = vi.fn(async () => ({ exitCode: 1 }) as TerminalOutcome);
    const createClient = vi.fn(() => client);
    const code = await runCli(["--agent", "acme/reviewer", "-m", "Review", "--approve-default", "approve"], { ...proc, env: { STIGMER_API_KEY: "k" } }, { createClient, run });
    expect(code).toBe(1);
    expect(createClient).toHaveBeenCalledWith({ baseUrl: "http://localhost:7234", apiKey: "k" });
    expect(run).toHaveBeenCalledWith(
      client,
      { org: "acme", sessionSpec: { agentRef: { org: "acme", slug: "reviewer" } }, message: "Review" },
      expect.objectContaining({ until: "turn", approveDefault: "approve", approveSetting: "--approve-default approve", signal: proc.signal, stdout: proc.stdout }),
    );
  });

  it("says how to come back to the session in the bin's own words, after leaving", async () => {
    const run = vi.fn(async () => ({ exitCode: 0 }) as TerminalOutcome);
    await runCli(["--agent", "acme/reviewer", "-m", "Review", "--until", "exit"], io(), { createClient: () => client, run });
    const options = (run.mock.calls[0] as unknown[])[2] as { leaveHint: (id: string) => string };
    expect(options.leaveHint("ses_9")).toBe("Come back with: stigmer-ink --session ses_9 --org acme");
  });

  it("sends into a session", async () => {
    const run = vi.fn(async () => ({ exitCode: 0 }) as TerminalOutcome);
    expect(await runCli(["--session", "ses_1", "--org", "acme", "-m", "go on"], io(), { createClient: () => client, run })).toBe(0);
    expect(run).toHaveBeenCalledWith(client, { org: "acme", sessionId: "ses_1", message: "go on" }, expect.anything());
  });

  it("keeps a start failure's code without writing it twice, and writes any other failure once", async () => {
    const quiet = io();
    const refused = vi.fn(async () => {
      throw new TerminalRunError("Could not start the run.", 3, new Error("refused"));
    });
    expect(await runCli(["-a", "acme/r", "-m", "x"], quiet, { createClient: () => client, run: refused })).toBe(3);
    expect(quiet.err.text).toEqual([]);

    const loud = io();
    const broken = vi.fn(async () => {
      throw new Error("odd");
    });
    expect(await runCli(["-a", "acme/r", "-m", "x"], loud, { createClient: () => client, run: broken })).toBe(1);
    expect(loud.err.text.join("")).toBe("stigmer-ink: Error: odd\n");
  });

  it("watches a session off a terminal until its newest turn ended", async () => {
    turns = [samples.turn({ runId: "run_a", phase: "completed" })];
    const proc = io();
    expect(await runCli(["--session", "ses_1", "--org", "acme"], proc, { createClient: () => client, run: vi.fn() })).toBe(0);
    expect(proc.out.text.join("")).toContain(samples.turn({ runId: "run_a", phase: "completed" }).answer.slice(0, 20));
  });

  it("exits 130 when a watch is stopped", async () => {
    turns = [samples.turn({ runId: "run_a", phase: "running" })];
    const controller = new AbortController();
    const watching = runCli(["--session", "ses_1", "--org", "acme"], io(controller.signal), { createClient: () => client, run: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect(await watching).toBe(130);
  });

  it("exits a watch with its newest turn's code, or the load failure's", async () => {
    const quiet = { createClient: () => client, run: vi.fn() };
    turns = [samples.turn({ runId: "run_a", phase: "failed" })];
    expect(await runCli(["--session", "ses_1", "--org", "acme"], io(), quiet)).toBe(1);
    turns = [];
    loadError = new ConnectError("no such session", Code.NotFound);
    expect(await runCli(["--session", "ses_1", "--org", "acme"], io(), quiet)).toBe(5);
    loadError = new Error("connect ECONNREFUSED 127.0.0.1:7234");
    expect(await runCli(["--session", "ses_1", "--org", "acme"], io(), quiet)).toBe(3);
    loadError = null;
  });

  it("settles no ask in a watched session: it belongs to whoever answers there", async () => {
    turns = [samples.turn({ runId: "run_a", phase: "completed" })];
    asks = [samples.toolUse("execute", undefined, { runId: "run_a" })];
    answered.length = 0;
    await runCli(["--session", "ses_1", "--org", "acme"], io(), { createClient: () => client, run: vi.fn() });
    expect(answered).toEqual([]);
    asks = [];
  });
});
