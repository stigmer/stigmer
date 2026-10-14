// Unit arms for the Managed Agents support. What they pin:
// - the client presents its credential the one way asked (apiKey sends
//   X-Api-Key and no bearer, authToken the reverse), so an arm proves the
//   option it names;
// - the native log as the lane must serve it keeps only Managed Agents
//   events, rendered, and asks for one run when given one;
// - the pager helper walks every page the SDK follows;
// - a stream is read until done (and closed), and is red, naming what it
//   saw, when it ends early or is not done in time;
// - the idle and preview filters.
// Pure: the SDK with a stubbed fetch, the SDK's own Stream class, stubbed
// clients; no target.
// Domain: conformance support (agentic / session, the Managed Agents wire).
import { Stream } from "@anthropic-ai/sdk/core/streaming";
import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { create } from "@bufbuild/protobuf";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { SessionEventListSchema, type ListSessionEventsRequest } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { collectUntil, isIdleWith, listAll, managedAgentsClient, nativeAsManagedAgents, storedOf } from "../managed-agents";

const idle = (type: string): BetaManagedAgentsStreamSessionEvents =>
  ({ type: "session.status_idle", id: `i-${type}`, processed_at: "t", stop_reason: { type } }) as BetaManagedAgentsStreamSessionEvents;
const running: BetaManagedAgentsStreamSessionEvents = { type: "session.status_running", id: "r", processed_at: "t" };
const start = { type: "event_start", event: { id: "m", type: "agent.message" } } as BetaManagedAgentsStreamSessionEvents;

function streamOf(events: BetaManagedAgentsStreamSessionEvents[], holdOpen = false): {
  stream: Stream<BetaManagedAgentsStreamSessionEvents>;
  controller: AbortController;
} {
  const controller = new AbortController();
  async function* iterate(): AsyncGenerator<BetaManagedAgentsStreamSessionEvents> {
    yield* events;
    if (holdOpen) {
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
    }
  }
  return { stream: new Stream(iterate, controller), controller };
}

describe("managedAgentsClient", () => {
  it("presents the credential the one way asked", () => {
    const keyed = managedAgentsClient("http://127.0.0.1:1", { apiKey: "stk_a" });
    expect([keyed.apiKey, keyed.authToken, keyed.baseURL]).toEqual(["stk_a", null, "http://127.0.0.1:1"]);
    const bearer = managedAgentsClient("http://127.0.0.1:1", { authToken: "stk_b" });
    expect([bearer.apiKey, bearer.authToken]).toEqual([null, "stk_b"]);
  });
});

describe("nativeAsManagedAgents", () => {
  it("keeps the Managed Agents events, rendered, for the run asked", async () => {
    const asked: ListSessionEventsRequest[] = [];
    const clients = {
      sessionQuery: {
        listEvents: async (request: ListSessionEventsRequest) => {
          asked.push(request);
          return create(SessionEventListSchema, {
            events: [
              create(SessionEventSchema, { event: { case: "sessionStatusRunning", value: { id: "r", processedAt: "t" } } }),
              create(SessionEventSchema, { event: { case: "stigmerPermissionAsked", value: { id: "p", toolUseId: "tu" } } }),
            ],
          });
        },
      },
    } as unknown as ConformanceClients;
    expect(await nativeAsManagedAgents(clients, "ses_1", "run_1")).toEqual([
      { type: "session.status_running", id: "r", processed_at: "t" },
    ]);
    expect(asked[0]).toMatchObject({ sessionId: "ses_1", runId: "run_1", pageSize: 1000 });
    await nativeAsManagedAgents(clients, "ses_1");
    expect(asked[1]).not.toHaveProperty("runId");
  });
});

describe("listAll", () => {
  it("walks every page the SDK follows", async () => {
    const urls: string[] = [];
    const pages = [
      { data: [running], next_page: "p2" },
      { data: [idle("end_turn")], next_page: null },
    ];
    const fetchStub = async (url: string | URL | Request): Promise<Response> => {
      urls.push(String(url));
      return new Response(JSON.stringify(pages[urls.length - 1]), { headers: { "content-type": "application/json" } });
    };
    const client = managedAgentsClient("http://127.0.0.1:1", { apiKey: "k" });
    const stubbed = client.withOptions({ fetch: fetchStub, maxRetries: 0 });
    expect((await listAll(stubbed, "ses_1", { limit: 1 })).map((event) => event.type)).toEqual([
      "session.status_running",
      "session.status_idle",
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("page=p2");
    expect(urls[1]).toContain("limit=1");
  });
});

describe("collectUntil", () => {
  it("reads until done, then closes the stream", async () => {
    const { stream, controller } = streamOf([running, idle("end_turn"), running], true);
    expect(await collectUntil(stream, (seen) => seen.some((event) => isIdleWith(event, "end_turn")))).toEqual([
      running,
      idle("end_turn"),
    ]);
    expect(controller.signal.aborted).toBe(true);
  });

  it("is red, naming what it saw, when the stream ends first", async () => {
    const { stream } = streamOf([running]);
    await expect(collectUntil(stream, () => false)).rejects.toThrow(
      'the stream ended before it was done; saw ["session.status_running"]',
    );
  });

  it("is red when the stream is not done in time", async () => {
    const { stream, controller } = streamOf([running], true);
    await expect(collectUntil(stream, () => false, 20)).rejects.toThrow("the stream was not done within 20ms");
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("filters", () => {
  it("reads an idle's stop reason and leaves previews out", () => {
    expect(isIdleWith(idle("requires_action"), "requires_action")).toBe(true);
    expect(isIdleWith(idle("end_turn"), "requires_action")).toBe(false);
    expect(isIdleWith(running, "end_turn")).toBe(false);
    expect(storedOf([start, running, { type: "event_delta" } as BetaManagedAgentsStreamSessionEvents])).toEqual([running]);
  });
});
