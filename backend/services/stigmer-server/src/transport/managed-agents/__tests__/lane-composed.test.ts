/**
 * The Managed Agents lane on a composed server, over plain HTTP on the
 * unified port, as Anthropic's SDK reaches it (SQLite, no engine).
 *
 * The open-source composition with a test unit's caller guard pins what
 * only composition can: the lane and the network adapter run ONE serving
 * chain, so a guard refusing a method refuses it through both doors with
 * the same message; on a server that requires no sign-in any key is the
 * local person and no credential reaches the chain; the stream has no gap
 * at open (the guard holds the native subscription while an event is
 * appended, which a stream that did not resume after its newest event
 * would never deliver); the client leaving ends the native stream; and a
 * send is checked whole before anything applies, a file block's File read
 * through the same chain.
 *
 * A composition that requires sign-in pins the credential edge: X-Api-Key
 * and Authorization: Bearer each reach the chain as a bearer token, a key
 * no verifier claims answers authentication_error, and two disagreeing
 * credentials are refused before any call.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventPreviewSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { toManagedAgentsJson } from "@stigmer/session-log";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../../domain/session/events/run-writes.js";
import { seedOrganizations } from "../../../domain/organization/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { MANAGED_AGENTS_EVENT_TYPES } from "../list.js";
import { MANAGED_AGENTS_VERSION } from "../version.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "lane-org";
const GUARD_REFUSAL = "refused by the lane test's guard";

/** What the test guard saw: each guarded method and the authorization it carried. */
interface GuardRecord {
  readonly method: string;
  readonly authorization: string | null;
}

/**
 * A unit whose one caller guard records every call, refuses confirmToolUse,
 * and holds streamEvents while `held` is set (before the native handler,
 * so before its subscription registers).
 */
function guardUnit(state: { records: GuardRecord[]; held?: Promise<void> }): ServerExtension {
  return {
    name: "lane-test-guard",
    callerGuards: [
      {
        name: "lane-test-guard",
        guard: async (_caller, method, headers) => {
          state.records.push({ method: method.name, authorization: headers.get("authorization") });
          if (method.name === "confirmToolUse") {
            throw new ConnectError(GUARD_REFUSAL, Code.PermissionDenied);
          }
          if (method.name === "streamEvents" && state.held !== undefined) {
            await state.held;
          }
        },
      },
    ],
  };
}

async function compose(dir: string, extensions: ServerExtension[]): Promise<{ server: ComposedServer; port: number }> {
  const server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    extensions,
    portOverride: 0,
    host: "127.0.0.1",
  });
  return { server, port: await server.start() };
}

/** The frames of a server-sent events body, comments skipped. */
async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: Record<string, unknown> }> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (block.startsWith(":")) {
        continue;
      }
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "";
      const data = lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "{}";
      yield { event, data: JSON.parse(data) as Record<string, unknown> };
    }
  }
}

/** Frames until one matches, or a refusal after `ms`, so a missing frame fails rather than hangs. */
async function framesUntil(
  frames: AsyncGenerator<{ event: string; data: Record<string, unknown> }>,
  matches: (frame: { event: string; data: Record<string, unknown> }) => boolean,
  ms = 5000,
): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const seen: Array<{ event: string; data: Record<string, unknown> }> = [];
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`no matching frame in ${ms} ms; saw ${JSON.stringify(seen)}`)), ms).unref(),
  );
  for (;;) {
    const next = await Promise.race([frames.next(), deadline]);
    if (next.done === true) {
      throw new Error(`the stream ended; saw ${JSON.stringify(seen)}`);
    }
    seen.push(next.value);
    if (matches(next.value)) {
      return seen;
    }
  }
}

describe("the Managed Agents lane on an open composition", () => {
  const state: { records: GuardRecord[]; held?: Promise<void> } = { records: [] };
  let server: ComposedServer;
  let dir: string;
  let base: string;
  let query: Client<typeof SessionQueryController>;
  let command: Client<typeof SessionCommandController>;
  let files: Client<typeof FileCommandController>;
  let counter = 0;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "managed-agents-lane-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
    const composed = await compose(dir, [guardUnit(state)]);
    server = composed.server;
    base = `http://127.0.0.1:${composed.port}`;
    const transport = createGrpcTransport({ baseUrl: base });
    await seedOrganizations(transport, [ORG]);
    query = createClient(SessionQueryController, transport);
    command = createClient(SessionCommandController, transport);
    files = createClient(FileCommandController, transport);
  });

  afterAll(async () => {
    try {
      await server?.shutdown();
      rmSync(dir, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  async function newSession(): Promise<string> {
    counter += 1;
    const session = await command.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name: `Lane ${counter}`, org: ORG },
      spec: {},
    });
    return session.metadata?.id ?? "";
  }

  async function turn(sessionId: string, runId: string): Promise<void> {
    const deps = { store: server.store, sessionEventBroker: server.sessionEventBroker };
    await createRunAppendingEvents(
      deps,
      create(RunSchema, {
        metadata: { id: runId, org: ORG },
        spec: { target: { case: "sessionId", value: sessionId }, message: `message of ${runId}` },
        status: { phase: RunPhase.RUN_PENDING },
      }),
    );
    await updateRunAppendingEvents(deps, runId, (run) => {
      run.status!.phase = RunPhase.RUN_COMPLETED;
    });
  }

  const eventsUrl = (sessionId: string, query = "") => `${base}/v1/sessions/${sessionId}/events${query}`;

  it("lists only Managed Agents events, paged in Anthropic's shape, equal to the native log rendered", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_lane_${counter}_a`);
    await turn(sessionId, `run_lane_${counter}_b`);

    const native = await query.listEvents({ sessionId, pageSize: 1000 });
    expect(native.events.some((event) => toManagedAgentsJson(event)["type"]?.toString().startsWith("stigmer."))).toBe(true);
    const expected = native.events
      .map(toManagedAgentsJson)
      .filter((event) => MANAGED_AGENTS_EVENT_TYPES.includes(String(event["type"])));

    const listed: unknown[] = [];
    let page: string | null = "";
    let pages = 0;
    while (page !== null) {
      const response = await fetch(eventsUrl(sessionId, `?beta=true&limit=2${page === "" ? "" : `&page=${encodeURIComponent(page)}`}`), {
        headers: { "anthropic-beta": MANAGED_AGENTS_VERSION, "x-api-key": "anything" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("request-id")).toMatch(/^req_[0-9a-z]{26}$/);
      const body = (await response.json()) as { data: unknown[]; next_page: string | null };
      listed.push(...body.data);
      page = body.next_page;
      pages += 1;
    }
    expect(listed).toEqual(expected);
    expect(pages).toBeGreaterThanOrEqual(Math.ceil(expected.length / 2));

    const filtered = await fetch(eventsUrl(sessionId, "?order=desc&types%5B%5D=user.message"));
    const filteredBody = (await filtered.json()) as { data: Array<{ type: string; content: Array<{ text: string }> }> };
    expect(filteredBody.data.map((event) => event.content[0]?.text)).toEqual([
      `message of run_lane_${counter}_b`,
      `message of run_lane_${counter}_a`,
    ]);
  });

  it("forwards no credential on a server without sign-in: any key is the local person", async () => {
    const sessionId = await newSession();
    state.records = [];
    const response = await fetch(eventsUrl(sessionId), {
      headers: { "x-api-key": "sk-ant-not-a-stigmer-key", authorization: "Bearer also-not-one" },
    });
    expect(response.status).toBe(200);
    // The empty log also asks the session itself (list.ts); neither call carries a credential.
    expect(state.records).toEqual([
      { method: "listEvents", authorization: null },
      { method: "get", authorization: null },
    ]);
  });

  it("runs the one serving chain: a guard refuses the same method through both doors with one message", async () => {
    const sessionId = await newSession();
    const native = await command.confirmToolUse({ sessionId, toolUseId: "tu_1", result: "allow" }).then(
      () => undefined,
      (error: unknown) => ConnectError.from(error),
    );
    expect(native?.code).toBe(Code.PermissionDenied);
    expect(native?.rawMessage).toBe(GUARD_REFUSAL);

    const response = await fetch(eventsUrl(sessionId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "user.tool_confirmation", tool_use_id: "tu_1", result: "allow" }] }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("x-should-retry")).toBe("false");
    const body = (await response.json()) as { type: string; error: { type: string; message: string }; request_id: string };
    expect(body).toEqual({
      type: "error",
      error: { type: "permission_error", message: GUARD_REFUSAL },
      request_id: response.headers.get("request-id"),
    });
  });

  it("checks a send whole before anything applies, and answers a method's refusal without a retry", async () => {
    const sessionId = await newSession();
    state.records = [];
    const mixed = await fetch(eventsUrl(sessionId), {
      method: "POST",
      body: JSON.stringify({
        events: [
          { type: "user.interrupt" },
          { type: "user.message", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }] },
        ],
      }),
    });
    expect(mixed.status).toBe(400);
    expect(((await mixed.json()) as { error: { message: string } }).error.message).toBe(
      "events[1]: Stigmer names an image block's bytes by File id, not a 'base64' source: upload the file with Stigmer's File API and name its id",
    );
    expect(state.records).toEqual([]);

    // An image block naming a File that is not an image is refused after the File is read, before the interrupt applies.
    const brief = await files.upload({ org: ORG, filename: "brief.pdf", source: { case: "data", value: new Uint8Array([37, 80]) } });
    state.records = [];
    const notAnImage = await fetch(eventsUrl(sessionId), {
      method: "POST",
      body: JSON.stringify({
        events: [
          { type: "user.interrupt" },
          { type: "user.message", content: [{ type: "image", source: { type: "file", file_id: brief.metadata?.id } }] },
        ],
      }),
    });
    expect(notAnImage.status).toBe(400);
    expect(((await notAnImage.json()) as { error: { message: string } }).error.message).toBe(
      `events[1]: file ${brief.metadata?.id} is application/pdf, not an image: send it in a document block`,
    );
    expect(state.records.map((record) => record.method)).toEqual(["get"]);
    state.records = [];

    // No engine is connected, so the interrupt itself refuses (FAILED_PRECONDITION).
    const interrupted = await fetch(eventsUrl(sessionId), {
      method: "POST",
      body: JSON.stringify({ events: [{ type: "user.interrupt" }] }),
    });
    expect(interrupted.status).toBe(400);
    expect(interrupted.headers.get("x-should-retry")).toBe("false");
    expect(((await interrupted.json()) as { error: { type: string } }).error.type).toBe("invalid_request_error");
    expect(state.records.map((record) => record.method)).toEqual(["interrupt"]);
  });

  it("answers what it does not serve in Anthropic's envelope", async () => {
    const sessionId = await newSession();
    const cases: Array<[string, RequestInit, number, string]> = [
      [eventsUrl("ses_missing"), {}, 404, "not_found_error"],
      [`${eventsUrl("ses_missing")}/stream`, {}, 404, "not_found_error"],
      [`${base}/v1/sessions/${sessionId}`, {}, 404, "not_found_error"],
      [eventsUrl(sessionId), { method: "DELETE" }, 405, "invalid_request_error"],
      [eventsUrl(sessionId), { method: "OPTIONS" }, 405, "invalid_request_error"],
      [`${eventsUrl(sessionId)}/stream`, { method: "POST", body: "{}" }, 405, "invalid_request_error"],
      [eventsUrl(sessionId), { headers: { "anthropic-beta": "managed-agents-2099-01-01" } }, 400, "invalid_request_error"],
      [eventsUrl(sessionId, "?types[]=stigmer.permission.asked"), {}, 400, "invalid_request_error"],
      [eventsUrl(sessionId), { method: "POST", body: "not json" }, 400, "invalid_request_error"],
      [eventsUrl(sessionId), { method: "POST", body: "x".repeat(10 * 1024 * 1024 + 1) }, 413, "invalid_request_error"],
    ];
    for (const [url, init, status, type] of cases) {
      const response = await fetch(url, init);
      expect(response.status, `${init.method ?? "GET"} ${url}`).toBe(status);
      expect(((await response.json()) as { error: { type: string } }).error.type).toBe(type);
    }
    const options = await fetch(eventsUrl(sessionId), { method: "OPTIONS" });
    expect(options.headers.get("allow")).toBe("GET, POST");
    expect(options.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("delivers an event appended while the native subscription is still registering (no gap at open)", async () => {
    const sessionId = await newSession();
    await turn(sessionId, `run_lane_${counter}_before`);
    let release: () => void = () => undefined;
    state.held = new Promise<void>((resolve) => (release = resolve));
    const abort = new AbortController();
    try {
      const response = await fetch(`${eventsUrl(sessionId)}/stream`, { signal: abort.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      // The client holds an open stream; the native subscription does not exist yet.
      expect(server.sessionEventBroker.subscriberCount(sessionId)).toBe(0);
      await turn(sessionId, `run_lane_${counter}_during`);
      release();
      state.held = undefined;
      const frames = sseFrames(response.body!);
      const seen = await framesUntil(
        frames,
        (frame) => frame.event === "session.status_idle",
      );
      const messages = seen.filter((frame) => frame.event === "user.message");
      expect(messages.map((frame) => (frame.data["content"] as Array<{ text: string }>)[0]?.text)).toEqual([
        `message of run_lane_${counter}_during`,
      ]);
      expect(seen.every((frame) => frame.event === frame.data["type"])).toBe(true);
      expect(seen.some((frame) => frame.event.startsWith("stigmer."))).toBe(false);
    } finally {
      release();
      state.held = undefined;
      abort.abort();
    }
  });

  it("streams the previews asked for, and ends the native stream when the client leaves", async () => {
    const sessionId = await newSession();
    const abort = new AbortController();
    const response = await fetch(`${eventsUrl(sessionId)}/stream?event_deltas%5B%5D=agent.message`, { signal: abort.signal });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(server.sessionEventBroker.subscriberCount(sessionId)).toBe(1));
    server.sessionEventBroker.publishPreviews(sessionId, [
      create(SessionEventPreviewSchema, {
        preview: { case: "eventStart", value: { event: { id: "sevt_preview", type: "agent.message" } } },
      }),
      create(SessionEventPreviewSchema, {
        preview: { case: "stigmerToolOutputDelta", value: { toolUseId: "tu_1", delta: "out" } },
      }),
      create(SessionEventPreviewSchema, {
        preview: {
          case: "eventDelta",
          value: { eventId: "sevt_preview", delta: { type: "content_delta", content: { type: "text", text: "he" } } },
        },
      }),
    ]);
    const seen = await framesUntil(sseFrames(response.body!), (frame) => frame.event === "event_delta");
    expect(seen.map((frame) => frame.event)).toEqual(["event_start", "event_delta"]);
    abort.abort();
    await vi.waitFor(() => expect(server.sessionEventBroker.subscriberCount(sessionId)).toBe(0));
  });
});

describe("the Managed Agents lane on a composition that requires sign-in", () => {
  // Not stk_-shaped: the composed API-key verifier claims those first.
  const KEY = "lane-fixture-key";
  const state: { records: GuardRecord[] } = { records: [] };
  let server: ComposedServer;
  let dir: string;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "managed-agents-lane-auth-"));
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
    const composed = await compose(dir, [
      {
        ...guardUnit(state),
        requireAuthentication: true,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        identityVerifiers: [
          {
            name: "lane-fixture-verifier",
            verify: (token) =>
              Promise.resolve(
                token === KEY
                  ? { identityId: "ida_lane_fixture", callerClass: "user", issuer: "lane-fixture", rawToken: token }
                  : null,
              ),
          },
        ],
      },
    ]);
    server = composed.server;
    base = `http://127.0.0.1:${composed.port}`;
  });

  afterAll(async () => {
    try {
      await server?.shutdown();
      rmSync(dir, { recursive: true, force: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  const url = () => `${base}/v1/sessions/ses_lane_auth/events`;

  it("hands the chain the SDK's apiKey and authToken as one bearer token", async () => {
    const sent: Array<Record<string, string>> = [
      { "x-api-key": KEY },
      { authorization: `Bearer ${KEY}` },
      { "x-api-key": KEY, authorization: `Bearer ${KEY}` },
    ];
    for (const headers of sent) {
      state.records = [];
      const response = await fetch(url(), { headers });
      expect(response.status, JSON.stringify(headers)).not.toBe(401);
      expect(state.records[0]).toEqual({ method: "listEvents", authorization: `Bearer ${KEY}` });
    }
  });

  it("answers authentication_error for a key no verifier claims, or none", async () => {
    const sent: Array<Record<string, string>> = [{ "x-api-key": "stk_unknown" }, {}];
    for (const headers of sent) {
      const response = await fetch(url(), { headers });
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: { type: string } }).error.type).toBe("authentication_error");
    }
  });

  it("refuses two different credentials before any call", async () => {
    state.records = [];
    const response = await fetch(url(), { headers: { "x-api-key": KEY, authorization: "Bearer stk_other" } });
    expect(response.status).toBe(401);
    expect(state.records).toEqual([]);
  });
});
