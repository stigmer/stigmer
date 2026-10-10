/**
 * The session event log over the wire, on a composed server (SQLite, no
 * engine): listEvents' paging, order and filters; streamEvents delivering
 * events appended after it opens and only the previews it asked for; a
 * run's delete ending its session's turn; and a session's delete removing
 * its log. Events are written the way the run
 * writes write them (../run-writes.ts) and the way a runner appends them,
 * through the composed store and broker.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventPreviewSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../../boot/config.js";
import { composeServer } from "../../../../boot/compose.js";
import type { ComposedServer } from "../../../../boot/compose.js";
import { createLogger } from "../../../../boot/logger.js";
import { seedOrganizations } from "../../../organization/__tests__/support.js";
import { eventTypeOf } from "../catalog.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../run-writes.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "events-org";

let server: ComposedServer;
let dir: string;
let command: Client<typeof SessionCommandController>;
let query: Client<typeof SessionQueryController>;
let runCommand: Client<typeof RunCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "session-events-wire-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  await seedOrganizations(transport, [ORG]);
  command = createClient(SessionCommandController, transport);
  query = createClient(SessionQueryController, transport);
  runCommand = createClient(RunCommandController, transport);
});

afterAll(async () => {
  try {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  } finally {
    vi.unstubAllEnvs();
  }
});

let counter = 0;
async function newSession(): Promise<string> {
  counter += 1;
  const session = await command.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Session",
    metadata: { name: `Events ${counter}`, org: ORG },
    spec: {},
  });
  return session.metadata?.id ?? "";
}

function deps() {
  return { store: server.store, sessionEventBroker: server.sessionEventBroker };
}

async function turn(sessionId: string, runId: string, finish = true): Promise<void> {
  await createRunAppendingEvents(
    deps(),
    create(RunSchema, {
      metadata: { id: runId, org: ORG },
      spec: { target: { case: "sessionId", value: sessionId }, message: `message of ${runId}` },
      status: { phase: RunPhase.RUN_PENDING },
    }),
  );
  if (finish) {
    await updateRunAppendingEvents(deps(), runId, (run) => {
      run.status!.phase = RunPhase.RUN_COMPLETED;
    });
  }
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("listEvents", () => {
  it("pages oldest first by default, every page bound to its request, to the end", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_${counter}_a`);
    await turn(sessionId, `run_${counter}_b`);
    const seen: bigint[] = [];
    let pageToken = "";
    let pages = 0;
    do {
      const page = await query.listEvents({ sessionId, pageSize: 2, pageToken });
      seen.push(...page.events.map((e) => e.seq));
      pageToken = page.nextPageToken;
      pages += 1;
    } while (pageToken !== "");
    expect(seen).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    expect(pages).toBe(3);
  });

  it("reads newest first with desc, and by type", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_${counter}_a`);
    const desc = await query.listEvents({ sessionId, order: "desc" });
    expect(desc.events.map(eventTypeOf)).toEqual(["session.status_idle", "session.status_running", "user.message"]);
    const idle = await query.listEvents({ sessionId, types: ["session.status_idle", "session.status_running"], order: "desc", pageSize: 1 });
    expect(idle.events.map(eventTypeOf)).toEqual(["session.status_idle"]);
    expect(desc.events.every((e) => e.sessionId === sessionId && e.runId === `run_${counter}_a`)).toBe(true);
  });

  it("filters on the time each event was accepted, accepting any RFC 3339 form", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_${counter}_a`);
    const all = await query.listEvents({ sessionId });
    const first = all.events[0]!.event;
    const at = first.case === undefined ? "" : first.value.processedAt;
    const later = new Date(Date.parse(at) + 60_000).toISOString().replace(".000Z", "Z");
    expect((await query.listEvents({ sessionId, createdAtGte: at })).events).toHaveLength(all.events.length);
    expect((await query.listEvents({ sessionId, createdAtGt: later })).events).toHaveLength(0);
    expect((await query.listEvents({ sessionId, createdAtLt: later })).events).toHaveLength(all.events.length);
    const bad = await refusal(query.listEvents({ sessionId, createdAtLt: "yesterday" }));
    expect(bad.code).toBe(Code.InvalidArgument);
  });

  it("refuses a token issued for another request, and a page size past 1000", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_${counter}_a`);
    const page = await query.listEvents({ sessionId, pageSize: 1 });
    const other = await refusal(query.listEvents({ sessionId, pageSize: 1, order: "desc", pageToken: page.nextPageToken }));
    expect(other.code).toBe(Code.InvalidArgument);
    const big = await refusal(query.listEvents({ sessionId, pageSize: 1001 }));
    expect(big.code).toBe(Code.InvalidArgument);
  });

  it("a page size of zero is the default page, never the whole log", async () => {
    const sessionId = await newSession();
    const runId = `run_${counter}_bulk`;
    await turn(sessionId, runId, false);
    await server.store.sessionEvents.append(
      sessionId,
      ORG,
      Array.from({ length: 120 }, (_, i) => ({
        eventId: `bulk-${i}`,
        runId,
        threadId: "",
        type: "agent.thinking",
        data: new Uint8Array(),
      })),
      { kind: ApiResourceKind.run, id: runId, schema: RunSchema, admit: () => undefined },
    );
    const page = await query.listEvents({ sessionId });
    expect(page.events).toHaveLength(100);
    expect(page.nextPageToken).not.toBe("");
  });
});

describe("streamEvents", () => {
  it("streams the events appended after it opens, and only the previews it asked for", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_${counter}_before`);
    const controller = new AbortController();
    const stream = query.streamEvents({ sessionId, eventDeltas: ["agent.message"] }, { signal: controller.signal });
    const frames: string[] = [];
    const reading = (async () => {
      try {
        for await (const frame of stream) {
          frames.push(frame.frame.case === "event" ? eventTypeOf(frame.frame.value) : String(frame.frame.case));
          if (frames.length === 4) {
            controller.abort();
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
      }
    })();
    // The stream registers before any frame flows: wait for it.
    await vi.waitFor(() => expect(server.sessionEventBroker.subscriberCount(sessionId)).toBe(1));
    server.sessionEventBroker.publishPreviews(sessionId, [
      create(SessionEventPreviewSchema, {
        preview: { case: "eventStart", value: { event: { id: "t1", type: "agent.thinking" } } },
      }),
      create(SessionEventPreviewSchema, {
        preview: { case: "eventStart", value: { event: { id: "m1", type: "agent.message" } } },
      }),
    ]);
    await turn(sessionId, `run_${counter}_after`);
    await reading;
    expect(frames).toEqual(["eventStart", "user.message", "session.status_running", "session.status_idle"]);
  });
});

describe("appendEvents over the wire", () => {
  it("the run's credential appends; a request with no credential is refused", async () => {
    const sessionId = await newSession();
    const runId = `run_${counter}_appending`;
    await turn(sessionId, runId, false);
    const event = { event: { case: "agentThinking" as const, value: { id: "evt-wire" } } };
    const appended = await command.appendEvents(
      { runId, events: [event] },
      { headers: { authorization: `Bearer ${server.runnerAuthService.mintRunCredential(runId)}` } },
    );
    expect(appended.events.map(eventTypeOf)).toEqual(["agent.thinking"]);
    const refused = await refusal(command.appendEvents({ runId, events: [event] }));
    expect(refused.code).toBe(Code.PermissionDenied);
  });

  it("refuses an event id or thread id outside the contract's pattern, before the handler", async () => {
    const sessionId = await newSession();
    const runId = `run_${counter}_ids`;
    await turn(sessionId, runId, false);
    const headers = { authorization: `Bearer ${server.runnerAuthService.mintRunCredential(runId)}` };
    for (const bad of [
      { event: { case: "agentThinking" as const, value: { id: "has space" } } },
      { event: { case: "agentThinking" as const, value: { id: "x".repeat(129) } } },
      { threadId: "bad\u0000thread", event: { case: "agentThinking" as const, value: { id: "ok" } } },
    ]) {
      const refused = await refusal(command.appendEvents({ runId, events: [bad] }, { headers }));
      expect(refused.code).toBe(Code.InvalidArgument);
    }
    expect((await query.listEvents({ sessionId, types: ["agent.thinking"] })).events).toEqual([]);
  });
});

describe("a run's delete", () => {
  it("deleting the session's only working run ends its turn: the log reads idle, and the run's own events are gone", async () => {
    const sessionId = await newSession();
    const runId = `run_${counter}_working`;
    await turn(sessionId, runId, false);
    await runCommand.delete({ value: runId });
    const types = (await query.listEvents({ sessionId })).events.map(eventTypeOf);
    expect(types).toEqual(["session.status_running", "session.status_idle"]);
  });
});

describe("a session's delete", () => {
  it("removes its whole event log", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_${counter}_a`);
    expect((await query.listEvents({ sessionId })).events.length).toBeGreaterThan(0);
    await command.delete({ value: sessionId });
    expect(await server.store.sessionEvents.list(sessionId, { order: "asc", limit: 10 })).toEqual([]);
  });
});
