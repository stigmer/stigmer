import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the session calls the client composes: the harness bind names the run
 * and the id, with the scoped credential when one is given; the append names the run
 * and carries its events and previews, with the scoped credential as the
 * Bearer header when one is given; the run's read pages to the end, a
 * thousand at a time, filtered by run; whether a run holds an event of some
 * types is one page of one event; the typed read asks for one page, in
 * the order and size the caller names, and hands back its cursor. The
 * transport and the generated clients are replaced at their module seams.
 */

const appendEvents = vi.fn();
const bindHarnessState = vi.fn();
const listEvents = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) => {
      switch (service.typeName) {
        case "ai.stigmer.agentic.session.v1.SessionCommandController":
          return { appendEvents, bindHarnessState };
        case "ai.stigmer.agentic.session.v1.SessionQueryController":
          return { listEvents };
        default:
          return {};
      }
    },
  };
});

import { create } from "@bufbuild/protobuf";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { StigmerClient } from "../stigmer-client.js";

function newClient(): StigmerClient {
  return new StigmerClient({ endpoint: "localhost:7234", token: null });
}

function event(id: string) {
  return create(SessionEventSchema, { event: { case: "agentThinking", value: { id } } });
}

beforeEach(() => {
  appendEvents.mockReset();
  bindHarnessState.mockReset();
  listEvents.mockReset();
});

describe("StigmerClient.bindHarnessState", () => {
  it("names the run and the id, and presents the scoped credential, or leaves it to the interceptor", async () => {
    bindHarnessState.mockResolvedValue({ harnessStateId: "thread-1", harnessStateIdHistory: [] });
    const client = newClient();
    const bound = await client.bindHarnessState("run_1", "thread-1", "scoped-token");
    await client.bindHarnessState("run_1", "thread-2");
    expect(bound.harnessStateId).toBe("thread-1");
    expect(bindHarnessState.mock.calls).toEqual([
      [{ runId: "run_1", harnessStateId: "thread-1" }, { headers: { authorization: "Bearer scoped-token" } }],
      [{ runId: "run_1", harnessStateId: "thread-2" }, undefined],
    ]);
  });
});

describe("StigmerClient.appendSessionEvents", () => {
  it("names the run, carries the events and previews, and presents the scoped credential", async () => {
    appendEvents.mockResolvedValue({ events: [] });
    await newClient().appendSessionEvents("run_1", [event("e1")], [], "scoped-token");
    const [input, options] = appendEvents.mock.calls[0]! as [{ runId: string; events: unknown[]; previews: unknown[] }, { headers: Record<string, string> }];
    expect([input.runId, input.events.length, input.previews.length]).toEqual(["run_1", 1, 0]);
    expect(options.headers.authorization).toBe("Bearer scoped-token");
  });

  it("leaves the credential to the interceptor when no scoped token is given", async () => {
    appendEvents.mockResolvedValue({ events: [] });
    await newClient().appendSessionEvents("run_1", [], []);
    expect(appendEvents.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("StigmerClient.listRunSessionEvents", () => {
  it("pages one run's events to the end", async () => {
    listEvents
      .mockResolvedValueOnce({ events: [event("a")], nextPageToken: "next" })
      .mockResolvedValueOnce({ events: [event("b")], nextPageToken: "" });
    const events = await newClient().listRunSessionEvents("ses_1", "run_1");
    expect(events.map((e) => (e.event.case === undefined ? "" : e.event.value.id))).toEqual(["a", "b"]);
    expect(listEvents.mock.calls.map((c) => c[0])).toEqual([
      { sessionId: "ses_1", runId: "run_1", types: [], pageSize: 1000, pageToken: "" },
      { sessionId: "ses_1", runId: "run_1", types: [], pageSize: 1000, pageToken: "next" },
    ]);
  });

  it("filters by type when asked: the answers a resumed turn reads", async () => {
    listEvents.mockResolvedValue({ events: [], nextPageToken: "" });
    await newClient().listRunSessionEvents("ses_1", "run_1", ["user.tool_confirmation", "stigmer.permission.grant"]);
    expect(listEvents.mock.calls[0]![0]).toEqual({
      sessionId: "ses_1",
      runId: "run_1",
      types: ["user.tool_confirmation", "stigmer.permission.grant"],
      pageSize: 1000,
      pageToken: "",
    });
  });
});

describe("StigmerClient.hasRunSessionEvent", () => {
  it("asks one run's log for a single event of the types named, and answers whether it holds one", async () => {
    listEvents.mockResolvedValueOnce({ events: [event("d")], nextPageToken: "more" }).mockResolvedValueOnce({ events: [], nextPageToken: "" });
    const client = newClient();
    expect(await client.hasRunSessionEvent("ses_1", "run_1", ["agent.message"])).toBe(true);
    expect(await client.hasRunSessionEvent("ses_1", "run_1", ["agent.message"])).toBe(false);
    expect(listEvents.mock.calls[0]![0]).toEqual({ sessionId: "ses_1", runId: "run_1", types: ["agent.message"], pageSize: 1, pageToken: "" });
  });
});

describe("StigmerClient.listSessionEvents", () => {
  it("asks for one page by type, order and size, and returns its cursor", async () => {
    listEvents.mockResolvedValue({ events: [event("c")], nextPageToken: "more" });
    const types = ["stigmer.file_review.decided"] as const;
    const page = await newClient().listSessionEvents("ses_1", { types, order: "desc", pageSize: 50, pageToken: "tok" });
    expect(page.events.map((e) => (e.event.case === undefined ? "" : e.event.value.id))).toEqual(["c"]);
    expect(page.nextPageToken).toBe("more");
    expect(listEvents.mock.calls[0]![0]).toEqual({
      sessionId: "ses_1",
      types: ["stigmer.file_review.decided"],
      order: "desc",
      pageSize: 50,
      pageToken: "tok",
    });
  });
});
