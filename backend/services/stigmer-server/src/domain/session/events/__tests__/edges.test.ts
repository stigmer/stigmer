/**
 * Pins the edges of the read side and the delete step: a list page's store
 * fault is a sanitized INTERNAL and a token that does not carry a place in
 * the log is refused (list.ts `readSessionEventPage`); a session's event
 * delete answers a store fault as INTERNAL (delete-step.ts); the renderer
 * refuses an event or a stream frame that holds nothing (render.ts); and a
 * preview holding nothing reaches no stream (broker.ts).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  ListSessionEventsRequestSchema,
  SessionEventPreviewSchema,
  StreamSessionEventsResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../../../pipeline/steps/delete.js";
import { encodeListPageToken, listPageFingerprint } from "../../../../pipeline/steps/list-page.js";
import type { Store } from "../../../../store/interface.js";
import { SessionEventBroker } from "../broker.js";
import { draftOf } from "../codec.js";
import { newDeleteSessionEventsStep } from "../delete-step.js";
import { SESSION_EVENT_PAGE_MAX_BYTES, readSessionEventPage } from "../list.js";
import { toManagedAgentsJson, toManagedAgentsStreamJson } from "../render.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

function emptyStore(list: Store["sessionEvents"]["list"]): Store {
  return { sessionEvents: { list } } as unknown as Store;
}

async function codeOf(promise: Promise<unknown>): Promise<Code> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error).code;
  }
  throw new Error("expected a refusal");
}

describe("a list page", () => {
  it("answers a store fault as INTERNAL", async () => {
    const store = emptyStore(() => Promise.reject(new Error("database is locked")));
    const code = await codeOf(readSessionEventPage(store, create(ListSessionEventsRequestSchema, { sessionId: "s1" })));
    expect(code).toBe(Code.Internal);
  });

  it("refuses a token for this request whose place is not a seq", async () => {
    const fingerprint = listPageFingerprint({
      session: "s1",
      order: "asc",
      size: 100,
      types: [],
      gt: "",
      gte: "",
      lt: "",
      lte: "",
    });
    const pageToken = encodeListPageToken({ createdAt: "", id: "not-a-seq" }, fingerprint);
    const store = emptyStore(() => Promise.resolve([]));
    const code = await codeOf(
      readSessionEventPage(store, create(ListSessionEventsRequestSchema, { sessionId: "s1", pageToken })),
    );
    expect(code).toBe(Code.InvalidArgument);
  });
});

describe("a page's byte budget", () => {
  function records(sizes: number[]) {
    return sizes.map((size, i) => ({
      sessionId: "s1",
      seq: i + 1,
      eventId: `e${i}`,
      runId: "r",
      threadId: "",
      type: "agent.thinking",
      processedAt: "2026-10-11T09:30:00.000Z",
      data: draftOf(
        create(SessionEventSchema, {
          event: { case: "agentMessage", value: { id: `e${i}`, content: [{ type: "text", text: "x".repeat(size) }] } },
        }),
      ).data,
    }));
  }

  it("stops before the budget and continues after the last event it holds", async () => {
    const mib = 1024 * 1024;
    const store = emptyStore(() => Promise.resolve(records([3 * mib, 3 * mib, 3 * mib, 10])));
    const page = await readSessionEventPage(store, create(ListSessionEventsRequestSchema, { sessionId: "s1" }));
    expect(page.events.map((e) => e.seq)).toEqual([1n, 2n]);
    expect(page.nextPageToken).not.toBe("");
    expect(SESSION_EVENT_PAGE_MAX_BYTES).toBeLessThan(10 * mib);
  });

  it("holds one event whatever its size, so a page always moves forward", async () => {
    const store = emptyStore(() => Promise.resolve(records([SESSION_EVENT_PAGE_MAX_BYTES + 1, 10])));
    const page = await readSessionEventPage(store, create(ListSessionEventsRequestSchema, { sessionId: "s1" }));
    expect(page.events.map((e) => e.seq)).toEqual([1n]);
    expect(page.nextPageToken).not.toBe("");
  });
});

describe("the session's event delete", () => {
  it("answers a store fault as INTERNAL", async () => {
    const store = {
      sessionEvents: { deleteBySession: () => Promise.reject(new Error("database is locked")) },
    } as unknown as Store;
    const ctx = new RequestContext(
      SessionCommandController.method.delete.input,
      create(SessionCommandController.method.delete.input, { value: "s1" }),
      testCallerIdentity(),
      ApiResourceKind.session,
    );
    ctx.set(RESOURCE_ID_KEY, "s1");
    const code = await codeOf(Promise.resolve(newDeleteSessionEventsStep(store).execute(ctx)));
    expect(code).toBe(Code.Internal);
  });
});

describe("the renderer and the broker, given nothing", () => {
  it("refuses an event or a frame that holds nothing", () => {
    expect(() => toManagedAgentsJson(create(SessionEventSchema, {}))).toThrow(/must hold an event/);
    expect(() => toManagedAgentsStreamJson(create(StreamSessionEventsResponseSchema, {}))).toThrow(/must hold a frame/);
  });

  it("a preview holding nothing reaches no stream", () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = broker.subscribe("s1", ["agent.message", "agent.thinking"]);
    broker.publishPreviews("s1", [create(SessionEventPreviewSchema, {})]);
    expect(stream.queue).toEqual([]);
  });
});
