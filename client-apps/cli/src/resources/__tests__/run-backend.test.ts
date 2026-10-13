// In-process test for the `runs` group resources.
//
// Stands up a real Connect backend over h2c serving the run query and
// command controllers and the session's event log and answers (listEvents,
// the server-streaming streamEvents, interrupt, confirmToolUse,
// grantPermission), points an SDK node client at it, and drives the
// resource layer end to end: lifecycle control (cancel interrupts the run's
// session), answering a waiting run's tool calls, the trace from the run's
// folded events, and the logs listed and followed from the session's log.
//
// The log holds four runs of session ses_1: aex_1 finished (a message, a
// Shell call), aex_live still working (more of its events, and its end, come
// only on the stream), aex_wait waiting on one tool call, aex_two waiting on
// two, aex_long holding one long message, aex_chat a message and no tool
// call; aex_empty has no events,
// aex_orphan names no session.

import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { RunSchema, type Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type {
  ConfirmToolUseInput,
  GrantPermissionInput,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { asked, idle, phase, result, said, threadRunning, use, user } from "../__test-utils__/session-events.js";
import { approveAgentToolCall } from "../run-approve.js";
import { cancelRun, pauseRun, resumeRun, terminateRun } from "../run-control.js";
import { streamRunLogs } from "../run-logs.js";
import { traceRun } from "../run-trace.js";

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

// Spies for the command-side calls, reset per test.
let agentControl: { verb: string; id: string; reason: string }[] = [];
let interrupts: string[] = [];
let confirms: ConfirmToolUseInput[] = [];
let grants: GrantPermissionInput[] = [];

beforeEach(() => {
  agentControl = [];
  interrupts = [];
  confirms = [];
  grants = [];
});

const thread = "aex_1.t1";

// What the log keeps (listEvents) and what arrives only on the stream.
const STORED: SessionEvent[] = [
  user("aex_1", "do it"),
  phase("aex_1", "running"),
  use("aex_1", "c1", "Shell", { input: { command: "make" } }),
  result("aex_1", "c1", "ok"),
  use("aex_1", "c2", "fetch"),
  use("aex_1", "t1", "task"),
  threadRunning("aex_1", thread, "researcher"),
  use("aex_1", "s1", "read", { threadId: thread }),
  result("aex_1", "s1", "no such file", true, thread),
  result("aex_1", "t1", "found nothing"),
  said("aex_1", 0, "done"),
  phase("aex_1", "completed"),
  user("aex_live", "keep going"),
  phase("aex_live", "running"),
  user("aex_wait", "clean up"),
  use("aex_wait", "c1", "delete", { permission: "ask" }),
  asked("aex_wait", "c1"),
  user("aex_two", "clean more"),
  use("aex_two", "c1", "delete", { permission: "ask" }),
  use("aex_two", "c2", "shell", { permission: "ask" }),
  idle("requires_action", ["aex_two.c1", "aex_two.c2"]),
];
STORED.push(user("aex_long", "x".repeat(300)), user("aex_chat", "hi"), said("aex_chat", 0, "hello"));
const LIVE: SessionEvent[] = [said("aex_live", 0, "final answer"), phase("aex_live", "completed")];

function runOf(id: string, phaseOf: RunPhase, session = "ses_1"): Run {
  return create(RunSchema, {
    metadata: { id, name: id === "aex_1" ? "Reviewer" : "" },
    spec: session === "" ? {} : { target: { case: "sessionId", value: session } },
    status: { phase: phaseOf, startedAt: "2026-06-12T10:00:00Z", completedAt: "2026-06-12T10:00:20Z" },
  });
}

function controlResult(phaseOf: RunPhase) {
  return create(RunSchema, { metadata: { id: "aex_1" }, status: { phase: phaseOf } });
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(RunQueryController, {
      get: (req) => {
        switch (req.value) {
          case "aex_1":
            return runOf("aex_1", RunPhase.RUN_COMPLETED);
          case "aex_live":
            return runOf("aex_live", interrupts.length > 0 ? RunPhase.RUN_CANCELLED : RunPhase.RUN_IN_PROGRESS);
          case "aex_orphan":
            return runOf("aex_orphan", RunPhase.RUN_IN_PROGRESS, "");
          default:
            return runOf(req.value, RunPhase.RUN_WAITING_FOR_APPROVAL);
        }
      },
    });
    router.service(RunCommandController, {
      terminate: (req) => (agentControl.push({ verb: "terminate", id: req.id, reason: req.reason }), controlResult(RunPhase.RUN_TERMINATED)),
      pause: (req) => (agentControl.push({ verb: "pause", id: req.id, reason: req.reason }), controlResult(RunPhase.RUN_PAUSED)),
      resume: (req) => (agentControl.push({ verb: "resume", id: req.id, reason: "" }), controlResult(RunPhase.RUN_IN_PROGRESS)),
    });
    router.service(SessionQueryController, {
      listEvents: (req) => ({
        events: STORED.filter((event) => event.sessionId === req.sessionId && (req.runId === "" || event.runId === req.runId)),
        nextPageToken: "",
      }),
      streamEvents: async function* (req) {
        for (const event of [...STORED, ...LIVE]) {
          if (event.seq > (req.afterSeq ?? 0n)) yield { frame: { case: "event", value: event } };
        }
      },
    });
    router.service(SessionCommandController, {
      interrupt: (req) => (interrupts.push(req.sessionId), { stoppedRunIds: ["aex_live", "aex_wait"] }),
      confirmToolUse: (req) => (confirms.push(req), {}),
      grantPermission: (req) => (grants.push(req), {}),
    });
  };

  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("lifecycle control", () => {
  it("cancels a run by interrupting its session, reporting the phase and every turn stopped", async () => {
    const outcome = await cancelRun(client, "aex_live");
    expect(outcome).toEqual({ phase: "cancelled", wasAlreadyTerminal: false, stoppedRunIds: ["aex_live", "aex_wait"] });
    expect(interrupts).toEqual(["ses_1"]);
  });

  it("leaves a run that already ended as it is", async () => {
    const outcome = await cancelRun(client, "aex_1");
    expect(outcome).toEqual({ phase: "completed", wasAlreadyTerminal: true, stoppedRunIds: [] });
    expect(interrupts).toEqual([]);
  });

  it("refuses to cancel a run that names no session", async () => {
    await expect(cancelRun(client, "aex_orphan")).rejects.toThrow("run aex_orphan names no session");
    expect(interrupts).toEqual([]);
  });

  it("terminates / pauses a run, carrying the reason", async () => {
    expect(await terminateRun(client, "aex_1", "stuck")).toEqual({ phase: "terminated" });
    expect(await pauseRun(client, "aex_1", "maintenance")).toEqual({ phase: "paused" });
    expect(agentControl).toEqual([
      { verb: "terminate", id: "aex_1", reason: "stuck" },
      { verb: "pause", id: "aex_1", reason: "maintenance" },
    ]);
  });

  it("resumes a run", async () => {
    expect(await resumeRun(client, "aex_1")).toEqual({ phase: "running" });
    expect(agentControl).toEqual([{ verb: "resume", id: "aex_1", reason: "" }]);
  });
});

describe("answering a waiting run", () => {
  const answer = (overrides: Partial<Parameters<typeof approveAgentToolCall>[1]>) =>
    approveAgentToolCall(client, { runId: "aex_wait", toolCallId: "", action: "approve", comment: "", ...overrides });

  it("allows the one call the run waits on", async () => {
    expect(await answer({})).toEqual({ toolUseId: "aex_wait.c1", toolName: "delete", answer: "allow" });
    expect(confirms.map((c) => [c.sessionId, c.toolUseId, c.result, c.denyMessage])).toEqual([
      ["ses_1", "aex_wait.c1", "allow", ""],
    ]);
  });

  it("denies with --comment as the reason the agent reads", async () => {
    expect(await answer({ toolCallId: "aex_wait.c1", action: "deny", comment: "unsafe" })).toMatchObject({ answer: "deny" });
    expect(confirms.map((c) => [c.result, c.denyMessage])).toEqual([["deny", "unsafe"]]);
  });

  it("reads reject as deny", async () => {
    await answer({ action: "reject" });
    expect(confirms.map((c) => c.result)).toEqual(["deny"]);
  });

  it("grants the call's class for the rest of the turn with approve-all", async () => {
    expect(await answer({ runId: "aex_two", toolCallId: "aex_two.c2", action: "approve-all" })).toEqual({
      toolUseId: "aex_two.c2",
      toolName: "shell",
      answer: "grant",
    });
    expect(grants.map((g) => [g.sessionId, g.toolUseId])).toEqual([["ses_1", "aex_two.c2"]]);
    expect(confirms).toEqual([]);
  });

  it("asks which call when the run waits on several", async () => {
    const refused = answer({ runId: "aex_two" });
    await expect(refused).rejects.toBeInstanceOf(UsageError);
    await expect(refused).rejects.toThrow("run aex_two waits on 2 tool calls; name one with --tool-call:\n  aex_two.c1  delete\n  aex_two.c2  shell");
  });

  it("refuses a call the run does not wait on, listing the ones it does", async () => {
    await expect(answer({ toolCallId: "aex_wait.c9" })).rejects.toThrow(
      "tool call aex_wait.c9 does not wait for an answer in run aex_wait; waiting:\n  aex_wait.c1  delete",
    );
  });

  it("refuses a run that waits on nothing", async () => {
    await expect(answer({ runId: "aex_1" })).rejects.toThrow("run aex_1 has no tool call waiting for an answer");
    await expect(answer({ runId: "aex_empty" })).rejects.toThrow("run aex_empty has no tool call waiting for an answer");
  });

  it("refuses a comment on an approval and an unknown action, sending nothing", async () => {
    await expect(answer({ comment: "lgtm" })).rejects.toThrow("--comment is the reason given with a deny");
    await expect(answer({ action: "maybe" })).rejects.toThrow('invalid --action "maybe"');
    expect(confirms).toEqual([]);
    expect(grants).toEqual([]);
  });
});

describe("trace", () => {
  function capture() {
    const chunks: string[] = [];
    return { streams: { write: (t: string) => chunks.push(t), colorize: false }, text: () => chunks.join("") };
  }

  it("renders the run's tool uses with their state, a sub-agent's indented", async () => {
    const cap = capture();
    await traceRun(client, "aex_1", "table", cap.streams);
    expect(cap.text()).toContain("Agent: Reviewer (completed, 20s)");
    expect(cap.text()).toContain("  [completed] Shell                      ok\n");
    expect(cap.text()).toContain("  [stopped] fetch                      \n");
    expect(cap.text()).toContain("  [completed] task");
    expect(cap.text()).toContain("    [failed] read                       no such file\n");
  });

  it("counts the messages of a run that made no tool call", async () => {
    const cap = capture();
    await traceRun(client, "aex_chat", "table", cap.streams);
    expect(cap.text()).toContain("  1 message(s), no tool calls");
  });

  it("shows a call that waits for an answer", async () => {
    const cap = capture();
    await traceRun(client, "aex_wait", "table", cap.streams);
    expect(cap.text()).toContain("  [waiting] delete");
  });

  it("says so when a run has no events", async () => {
    const cap = capture();
    await traceRun(client, "aex_empty", "table", cap.streams);
    expect(cap.text()).toContain("  (no events recorded)");
  });

  it("lists the run's events as Managed Agents JSON, and as yaml", async () => {
    const json = capture();
    await traceRun(client, "aex_1", "json", json.streams);
    const parsed = JSON.parse(json.text());
    expect(parsed.map((event: { type: string }) => event.type)).toEqual([
      "user.message",
      "stigmer.run.status",
      "agent.tool_use",
      "agent.tool_result",
      "agent.tool_use",
      "agent.tool_use",
      "session.thread_status_running",
      "agent.tool_use",
      "agent.tool_result",
      "agent.tool_result",
      "agent.message",
      "stigmer.run.status",
    ]);

    const yaml = capture();
    await traceRun(client, "aex_1", "yaml", yaml.streams);
    expect(yaml.text()).toContain("type: user.message");
    expect(yaml.text()).toContain("text: do it");
  });
});

describe("logs", () => {
  function capture() {
    const lines: string[] = [];
    return { streams: { out: { write: (l: string) => lines.push(l) }, colorize: false }, lines };
  }
  const never = new AbortController().signal;

  it("says so when a run has recorded no events", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_empty", follow: false }, never, cap.streams);
    expect(cap.lines).toEqual(["No events recorded for this run.\n"]);
  });

  it("prints one line per stored event of the run", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_1", follow: false }, never, cap.streams);
    expect(cap.lines[0]).toBe("[user.message] do it\n");
    expect(cap.lines[1]).toBe('[stigmer.run.status] {"phase":"running"}\n');
    expect(cap.lines).toContain('[agent.tool_use] {"input":{"command":"make"},"name":"Shell"}\n');
    expect(cap.lines).toContain('[session.thread_status_running] {"agent_name":"researcher","session_thread_id":"aex_1.t1"}\n');
    expect(cap.lines).toContain("[agent.tool_result] ok\n");
    expect(cap.lines).toContain("[agent.message] done\n");
    expect(cap.lines).toHaveLength(12);
  });

  it("shows the tool use id an ask waits on", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_wait", follow: false }, never, cap.streams);
    expect(cap.lines.join("")).toContain('"tool_use_id":"aex_wait.c1"');
  });

  it("ends a follow of a finished run after its listed events", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_1", follow: true }, never, cap.streams);
    expect(cap.lines.at(-1)).toBe("\n[end] run completed\n");
    expect(cap.lines).toHaveLength(13);
  });

  it("follows a live run from its last listed event, printing only its own, until it ends", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_live", follow: true }, never, cap.streams);
    expect(cap.lines).toEqual([
      "[user.message] keep going\n",
      expect.stringContaining("[stigmer.run.status]"),
      "[agent.message] final answer\n",
      expect.stringContaining("[stigmer.run.status]"),
      "\n[end] run completed\n",
    ]);
  });

  it("ends a follow quietly when it is aborted", async () => {
    const cap = capture();
    const controller = new AbortController();
    controller.abort();
    await streamRunLogs(client, { runId: "aex_wait", follow: true }, controller.signal, cap.streams);
    expect(cap.lines.at(-1)).toContain('"tool_use_id":"aex_wait.c1"');
  });

  it("caps a long line at 200 characters", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_long", follow: false }, never, cap.streams);
    expect(cap.lines).toEqual([`[user.message] ${"x".repeat(197)}...\n`]);
  });
});
