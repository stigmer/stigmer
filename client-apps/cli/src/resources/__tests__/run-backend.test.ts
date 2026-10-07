// In-process test for the `runs` group resources.
//
// Stands up a real Connect backend over h2c serving the agent-run query and
// command controllers (including the server-streaming subscribe method),
// points an SDK node client at it, and drives the resource layer end to end:
// lifecycle control, approval submission (asserting the comment carry), trace
// rendering, and log streaming (snapshot diffing). The id `aex_empty` reads
// back a run with nothing recorded, for the logs' empty-run line.

import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveAgentToolCall } from "../run-approve.js";
import { cancelRun, pauseRun, resumeRun, terminateRun } from "../run-control.js";
import { streamRunLogs } from "../run-logs.js";
import { traceRun } from "../run-trace.js";

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

// Spies for the command-side calls, reset per test.
let agentControl: { verb: string; id: string; reason: string }[] = [];
let agentApproval: SubmitApprovalInput[] = [];

beforeEach(() => {
  agentControl = [];
  agentApproval = [];
});

// An agent run carrying two messages for the agent log + trace views.
const agentExec = create(RunSchema, {
  metadata: { id: "aex_1", name: "Reviewer" },
  status: {
    phase: RunPhase.RUN_COMPLETED,
    startedAt: "2026-06-12T10:00:00Z",
    completedAt: "2026-06-12T10:00:20Z",
    messages: [
      { type: MessageType.MESSAGE_HUMAN, content: "do it" },
      { type: MessageType.MESSAGE_AI, content: "done", toolCalls: [{ name: "Shell", result: "ok" }] },
    ],
  },
});

function controlResult(phase: RunPhase) {
  return create(RunSchema, { metadata: { id: "aex_1" }, status: { phase } });
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(RunQueryController, {
      get: (req) =>
        req.value === "aex_empty" ? create(RunSchema, { metadata: { id: "aex_empty" }, status: {} }) : agentExec,
      subscribe: async function* () {
        yield create(RunSchema, {
          metadata: { id: "aex_1" },
          status: { phase: RunPhase.RUN_IN_PROGRESS, messages: [{ type: MessageType.MESSAGE_AI, content: "thinking" }] },
        });
        yield create(RunSchema, {
          metadata: { id: "aex_1" },
          status: {
            phase: RunPhase.RUN_COMPLETED,
            messages: [
              { type: MessageType.MESSAGE_AI, content: "thinking" },
              { type: MessageType.MESSAGE_AI, content: "final answer" },
            ],
          },
        });
      },
    });
    router.service(RunCommandController, {
      cancel: (req) => (agentControl.push({ verb: "cancel", id: req.id, reason: req.reason }), controlResult(RunPhase.RUN_CANCELLED)),
      terminate: (req) => (agentControl.push({ verb: "terminate", id: req.id, reason: req.reason }), controlResult(RunPhase.RUN_TERMINATED)),
      pause: (req) => (agentControl.push({ verb: "pause", id: req.id, reason: req.reason }), controlResult(RunPhase.RUN_PAUSED)),
      resume: (req) => (agentControl.push({ verb: "resume", id: req.id, reason: "" }), controlResult(RunPhase.RUN_IN_PROGRESS)),
      submitApproval: (req) => (agentApproval.push(req), agentExec),
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
  it("cancels an agent run and reports the phase", async () => {
    const result = await cancelRun(client, "aex_1", "no longer needed");
    expect(result).toEqual({ phase: "cancelled" });
    expect(agentControl).toEqual([{ verb: "cancel", id: "aex_1", reason: "no longer needed" }]);
  });

  it("terminates / pauses an agent run, carrying the reason", async () => {
    expect(await terminateRun(client, "aex_1", "stuck")).toEqual({ phase: "terminated" });
    expect(await pauseRun(client, "aex_1", "maintenance")).toEqual({ phase: "paused" });
    expect(agentControl).toEqual([
      { verb: "terminate", id: "aex_1", reason: "stuck" },
      { verb: "pause", id: "aex_1", reason: "maintenance" },
    ]);
  });

  it("resumes an agent run", async () => {
    expect(await resumeRun(client, "aex_1")).toEqual({ phase: "running" });
    expect(agentControl).toEqual([{ verb: "resume", id: "aex_1", reason: "" }]);
  });
});

describe("approval submission", () => {
  it("carries --comment onto the agent SubmitApprovalInput", async () => {
    await approveAgentToolCall(client, { runId: "aex_1", toolCallId: "tc_1", action: "deny", comment: "unsafe" });
    expect(agentApproval).toHaveLength(1);
    expect(agentApproval[0].comment).toBe("unsafe");
    expect(agentApproval[0].toolCallId).toBe("tc_1");
    // "deny" maps to REJECT (3).
    expect(agentApproval[0].action).toBe(3);
  });

});

describe("trace", () => {
  function capture() {
    const chunks: string[] = [];
    return { streams: { write: (t: string) => chunks.push(t), colorize: false }, text: () => chunks.join("") };
  }

  it("renders the agent tool-call timeline", async () => {
    const cap = capture();
    await traceRun(client, "aex_1", "table", cap.streams);
    expect(cap.text()).toContain("Agent: Reviewer (completed, 20s)");
    expect(cap.text()).toContain("[done] Shell");
  });

  it("emits the agent run envelope as json and as yaml", async () => {
    const json = capture();
    await traceRun(client, "aex_1", "json", json.streams);
    const parsed = JSON.parse(json.text());
    expect(parsed.metadata.id).toBe("aex_1");
    expect(parsed.status.messages).toHaveLength(2);

    const yaml = capture();
    await traceRun(client, "aex_1", "yaml", yaml.streams);
    expect(yaml.text()).toContain("id: aex_1");
    expect(yaml.text()).toContain("content: do it");
  });
});

describe("logs", () => {
  function capture() {
    const lines: string[] = [];
    return { streams: { out: { write: (l: string) => lines.push(l) }, colorize: false }, lines };
  }
  const never = new AbortController().signal;

  it("says so when an agent run has recorded no messages", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_empty", follow: false }, never, cap.streams);
    expect(cap.lines).toEqual(["No messages recorded for this run.\n"]);
  });

  it("prints agent messages from a single snapshot when not following", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_1", follow: false }, never, cap.streams);
    const text = cap.lines.join("");
    expect(text).toContain("[human] do it");
    expect(text).toContain("[ai] done");
  });

  it("diffs agent snapshots on --follow and stops on the terminal phase", async () => {
    const cap = capture();
    await streamRunLogs(client, { runId: "aex_1", follow: true }, never, cap.streams);
    const text = cap.lines.join("");
    expect(text).toContain("[ai] thinking");
    expect(text).toContain("[ai] final answer");
    expect(text).toContain("[end] run completed");
  });
});
