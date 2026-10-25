/**
 * Pins the Claude session store (`session-store.ts`): the SDK's
 * `SessionStore` contract, written once and run against every backing the
 * runner places an engine's conversation in — this process
 * (`MemoryTranscripts`), this machine's disk (`file-store.ts`) and the
 * platform over the engine-sessions wire (`http-store.ts`, against a small
 * platform on loopback that speaks the wire its header states).
 *
 * Why one contract for three: the store holds the only durable copy of a
 * session's conversation, and a session resumes on whichever runner picks
 * it up, so a backing that kept order, deduplicated or answered "never
 * written" differently from the others would lose or repeat a turn's
 * history depending on where it ran. The contract's cases are the SDK's
 * (`SessionStore` in the SDK's typings): append order, `uuid` as the
 * idempotency key (the SDK retries a batch), `null` for a key never
 * written, sub-agent transcripts under their subpath and their listing,
 * delete. One more is the runner's: a store built for one turn's thread
 * refuses every other session id, so no turn reaches another's
 * conversation whatever the engine asks.
 *
 * Then each backing's own specifics: the file backing's layout on disk and
 * its reading of what an earlier turn left there, and the HTTP backing's
 * credential, turn key, retry and error paths.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runWithExecutionContext, TURN_KEY_HEADER } from "../../../shared/execution-context.js";
import { engineSessionIdOf } from "../engine-session-id.js";
import { FileTranscripts } from "../file-store.js";
import { ENGINE_SESSIONS_LANE, HttpTranscripts } from "../http-store.js";
import { ForeignSessionError, MemoryTranscripts, sessionStoreFor, unseenEntries, type TranscriptBacking } from "../session-store.js";

const THREAD = "thread-ses-store";
const OTHER_THREAD = "thread-ses-other";
const PROJECT = "project-key";
const SUB_A = "subagents/agent-a";
const SUB_B = "subagents/agent-b";
const TOKEN = "runner-token";

function entry(uuid: string | undefined, text = uuid ?? "untagged"): SessionStoreEntry {
  return uuid === undefined ? { type: "custom-title", text } : { type: "user", uuid, message: { role: "user", content: text } };
}

function keyOf(threadId: string, subpath?: string, projectKey = PROJECT): SessionKey {
  return subpath === undefined ? { projectKey, sessionId: engineSessionIdOf(threadId) } : { projectKey, sessionId: engineSessionIdOf(threadId), subpath };
}

function uuidsOf(entries: readonly SessionStoreEntry[] | null): (string | undefined)[] | null {
  return entries === null ? null : entries.map((e) => e.uuid);
}

/** One of the SDK's optional methods, bound, failing loudly if the store left it out: the runner's store implements both. */
function required<K extends "listSubkeys" | "delete">(store: SessionStore, name: K): NonNullable<SessionStore[K]> {
  const method = store[name];
  if (method === undefined) throw new Error(`the store implements no ${name}`);
  return method.bind(store) as NonNullable<SessionStore[K]>;
}

// ─── The platform, on loopback: the engine-sessions wire, as `http-store.ts` states it ───

interface PlatformRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

class FakePlatform {
  readonly requests: PlatformRequest[] = [];
  /** By thread, then subpath (`""` for the main transcript). */
  private readonly threads = new Map<string, Map<string, { entries: SessionStoreEntry[]; seen: Set<string> }>>();
  /** Answers the next requests with these, in order, before serving the wire. */
  readonly scripted: { status: number; body: string }[] = [];
  /** When set, the next request's answer is cut off mid-body. */
  cutBody = false;
  url = "";
  private server: Server | undefined;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => this.serve(req, res, Buffer.concat(chunks).toString("utf8")));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  reset(): void {
    this.requests.length = 0;
    this.threads.clear();
    this.scripted.length = 0;
    this.cutBody = false;
  }

  private serve(req: IncomingMessage, res: ServerResponse, body: string): void {
    const url = new URL(req.url ?? "/", "http://platform");
    this.requests.push({ method: req.method ?? "", path: `${url.pathname}${url.search}`, headers: req.headers, body });
    if (this.cutBody) {
      this.cutBody = false;
      res.writeHead(400, { "content-length": "1000" });
      res.write("partial");
      setImmediate(() => res.destroy());
      return;
    }
    const scripted = this.scripted.shift();
    if (scripted !== undefined) {
      res.writeHead(scripted.status, { "content-type": "text/plain" });
      res.end(scripted.body);
      return;
    }
    const json = (status: number, value: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const route = url.pathname.startsWith(ENGINE_SESSIONS_LANE) ? url.pathname.slice(ENGINE_SESSIONS_LANE.length) : "";
    if (route === "/entries" && req.method === "POST") {
      const { thread_id, subpath, entries } = JSON.parse(body) as { thread_id: string; subpath: string; entries: SessionStoreEntry[] };
      const thread = this.threads.get(thread_id) ?? new Map<string, { entries: SessionStoreEntry[]; seen: Set<string> }>();
      this.threads.set(thread_id, thread);
      const transcript = thread.get(subpath) ?? { entries: [], seen: new Set<string>() };
      thread.set(subpath, transcript);
      for (const e of entries) {
        if (typeof e.uuid === "string") {
          if (transcript.seen.has(e.uuid)) continue;
          transcript.seen.add(e.uuid);
        }
        transcript.entries.push(e);
      }
      json(200, {});
      return;
    }
    const threadId = url.searchParams.get("thread_id") ?? "";
    const subpath = url.searchParams.get("subpath");
    if (route === "/entries" && req.method === "GET") {
      const transcript = this.threads.get(threadId)?.get(subpath ?? "");
      if (transcript === undefined) json(404, { error: "never written" });
      else json(200, { entries: transcript.entries });
      return;
    }
    if (route === "/subkeys" && req.method === "GET") {
      json(200, { subkeys: [...(this.threads.get(threadId)?.keys() ?? [])].filter((s) => s !== "") });
      return;
    }
    if (route === "/entries" && req.method === "DELETE") {
      if (subpath === null) this.threads.delete(threadId);
      else this.threads.get(threadId)?.delete(subpath);
      json(200, {});
      return;
    }
    json(404, { error: `no route ${req.method} ${url.pathname}` });
  }
}

const platform = new FakePlatform();
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-store-"));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => platform.start());
afterAll(() => platform.stop());
beforeEach(() => platform.reset());
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Every backing the contract runs against, each fresh per test. */
const BACKINGS: readonly { readonly name: string; readonly make: () => Promise<TranscriptBacking> }[] = [
  { name: "memory", make: async () => new MemoryTranscripts() },
  { name: "file", make: async () => new FileTranscripts(join(await tempDir(), "transcripts")) },
  { name: "http", make: async () => new HttpTranscripts(platform.url, { current: TOKEN }, { maxRetries: 0 }) },
];

describe.each(BACKINGS)("the session store contract, over the $name backing", ({ make }) => {
  let backing: TranscriptBacking;
  let store: SessionStore;

  beforeEach(async () => {
    backing = await make();
    store = sessionStoreFor(THREAD, backing);
  });

  it("loads what was appended, in append order, across batches", async () => {
    await store.append(keyOf(THREAD), [entry("u1"), entry("u2")]);
    await store.append(keyOf(THREAD), [entry("u3")]);
    expect(uuidsOf(await store.load(keyOf(THREAD)))).toEqual(["u1", "u2", "u3"]);
  });

  it("returns entries deep-equal to what was appended, and never the caller's own objects", async () => {
    const appended = [{ type: "assistant", uuid: "u1", message: { content: [{ type: "text", text: "hi" }] }, nested: { n: 1 } }];
    await store.append(keyOf(THREAD), appended);
    appended[0]!.nested.n = 2;
    const loaded = await store.load(keyOf(THREAD));
    expect(loaded).toEqual([{ type: "assistant", uuid: "u1", message: { content: [{ type: "text", text: "hi" }] }, nested: { n: 1 } }]);
    (loaded![0]!.nested as { n: number }).n = 3;
    expect(await store.load(keyOf(THREAD)), "a loaded entry edited by its reader leaves the store's").toEqual([
      { type: "assistant", uuid: "u1", message: { content: [{ type: "text", text: "hi" }] }, nested: { n: 1 } },
    ]);
  });

  it("deduplicates by uuid: a retried batch, a repeat within a batch, and an entry without a uuid always kept", async () => {
    await store.append(keyOf(THREAD), [entry("u1"), entry("u2")]);
    await store.append(keyOf(THREAD), [entry("u1"), entry("u2")]);
    await store.append(keyOf(THREAD), [entry("u3"), entry("u3", "again"), entry(undefined, "t"), entry(undefined, "t")]);
    const loaded = await store.load(keyOf(THREAD));
    expect(uuidsOf(loaded)).toEqual(["u1", "u2", "u3", undefined, undefined]);
    expect(loaded![2], "the first copy of a uuid is the one kept").toEqual(entry("u3"));
  });

  it("answers null for a transcript never written, main or sub-agent", async () => {
    expect(await store.load(keyOf(THREAD))).toBeNull();
    await store.append(keyOf(THREAD), [entry("u1")]);
    expect(await store.load(keyOf(THREAD, SUB_A)), "a sub-agent transcript beside a written main one").toBeNull();
    expect(await required(store, "listSubkeys")({ projectKey: PROJECT, sessionId: engineSessionIdOf(THREAD) })).toEqual([]);
  });

  it("keeps each sub-agent's transcript under its subpath and lists them, not the main one", async () => {
    await store.append(keyOf(THREAD), [entry("m1")]);
    await store.append(keyOf(THREAD, SUB_A), [entry("a1"), entry("a2")]);
    await store.append(keyOf(THREAD, SUB_B), [entry("b1")]);
    await sessionStoreFor(OTHER_THREAD, backing).append(keyOf(OTHER_THREAD, "subagents/agent-elsewhere"), [entry("x1")]);

    expect(uuidsOf(await store.load(keyOf(THREAD)))).toEqual(["m1"]);
    expect(uuidsOf(await store.load(keyOf(THREAD, SUB_A)))).toEqual(["a1", "a2"]);
    expect(uuidsOf(await store.load(keyOf(THREAD, SUB_B)))).toEqual(["b1"]);
    const subkeys = await required(store, "listSubkeys")({ projectKey: PROJECT, sessionId: engineSessionIdOf(THREAD) });
    expect([...subkeys].sort(), "this thread's sub-agents alone").toEqual([SUB_A, SUB_B]);
  });

  it("deduplicates per transcript: one uuid in two transcripts is two entries", async () => {
    await store.append(keyOf(THREAD), [entry("u1")]);
    await store.append(keyOf(THREAD, SUB_A), [entry("u1")]);
    expect(uuidsOf(await store.load(keyOf(THREAD)))).toEqual(["u1"]);
    expect(uuidsOf(await store.load(keyOf(THREAD, SUB_A)))).toEqual(["u1"]);
  });

  it("is keyed by the thread alone: the SDK's project key is ignored", async () => {
    await store.append(keyOf(THREAD, undefined, "project-one"), [entry("u1")]);
    expect(uuidsOf(await store.load(keyOf(THREAD, undefined, "project-two")))).toEqual(["u1"]);
  });

  it("deletes one sub-agent transcript, or with no subpath every transcript of the thread, and no other thread's", async () => {
    const other = sessionStoreFor(OTHER_THREAD, backing);
    await store.append(keyOf(THREAD), [entry("m1")]);
    await store.append(keyOf(THREAD, SUB_A), [entry("a1")]);
    await store.append(keyOf(THREAD, SUB_B), [entry("b1")]);
    await other.append(keyOf(OTHER_THREAD), [entry("o1")]);
    const listSubkeys = required(store, "listSubkeys");
    const del = required(store, "delete");

    await del(keyOf(THREAD, SUB_A));
    expect(await store.load(keyOf(THREAD, SUB_A))).toBeNull();
    expect(uuidsOf(await store.load(keyOf(THREAD)))).toEqual(["m1"]);
    expect(await listSubkeys({ projectKey: PROJECT, sessionId: engineSessionIdOf(THREAD) })).toEqual([SUB_B]);

    await del(keyOf(THREAD));
    expect(await store.load(keyOf(THREAD))).toBeNull();
    expect(await store.load(keyOf(THREAD, SUB_B))).toBeNull();
    expect(await listSubkeys({ projectKey: PROJECT, sessionId: engineSessionIdOf(THREAD) })).toEqual([]);
    expect(uuidsOf(await other.load(keyOf(OTHER_THREAD))), "another thread's conversation").toEqual(["o1"]);
  });

  it("takes an entry again once its transcript was deleted", async () => {
    await store.append(keyOf(THREAD), [entry("u1")]);
    await required(store, "delete")(keyOf(THREAD));
    await store.append(keyOf(THREAD), [entry("u1")]);
    expect(uuidsOf(await store.load(keyOf(THREAD)))).toEqual(["u1"]);
  });

  it("deletes a transcript never written without complaint", async () => {
    await required(store, "delete")(keyOf(THREAD, SUB_A));
    await required(store, "delete")(keyOf(THREAD));
    expect(await store.load(keyOf(THREAD))).toBeNull();
  });

  it("refuses every call that names another session, and the backing never sees it", async () => {
    const seen: string[] = [];
    const recording: TranscriptBacking = {
      append: async (t) => void seen.push(`append ${t}`),
      load: async (t) => (seen.push(`load ${t}`), null),
      listSubkeys: async (t) => (seen.push(`listSubkeys ${t}`), []),
      delete: async (t) => void seen.push(`delete ${t}`),
    };
    const guarded = sessionStoreFor(THREAD, recording);
    const foreign = keyOf(OTHER_THREAD);
    await expect(guarded.append(foreign, [entry("u1")])).rejects.toBeInstanceOf(ForeignSessionError);
    await expect(guarded.load(foreign)).rejects.toBeInstanceOf(ForeignSessionError);
    await expect(required(guarded, "listSubkeys")({ projectKey: PROJECT, sessionId: foreign.sessionId })).rejects.toBeInstanceOf(ForeignSessionError);
    await expect(required(guarded, "delete")(foreign)).rejects.toBeInstanceOf(ForeignSessionError);
    await expect(guarded.load({ projectKey: PROJECT, sessionId: OTHER_THREAD }), "a raw thread id is not the session id either").rejects.toThrow(
      `the session store serves session ${engineSessionIdOf(THREAD)} alone, not ${OTHER_THREAD}`,
    );
    expect(seen).toEqual([]);

    // The same refusal over this backing: the other thread's data is untouched by a refused call.
    await sessionStoreFor(OTHER_THREAD, backing).append(keyOf(OTHER_THREAD), [entry("o1")]);
    await expect(required(store, "delete")(foreign)).rejects.toBeInstanceOf(ForeignSessionError);
    await expect(store.append(foreign, [entry("intruder")])).rejects.toBeInstanceOf(ForeignSessionError);
    expect(uuidsOf(await sessionStoreFor(OTHER_THREAD, backing).load(keyOf(OTHER_THREAD)))).toEqual(["o1"]);
  });
});

describe("unseenEntries", () => {
  it("passes each new uuid once, in order, records it, and always passes an entry without one", () => {
    const seen = new Set<string>(["old"]);
    const out = unseenEntries(seen, [entry("old"), entry("a"), entry(undefined), entry("a"), entry("b"), entry(undefined)]);
    expect(uuidsOf(out)).toEqual(["a", undefined, "b", undefined]);
    expect([...seen].sort()).toEqual(["a", "b", "old"]);
  });
});

describe("the file backing on disk", () => {
  it("creates its directory on the first append, the main transcript and each sub-agent's one JSON entry per line", async () => {
    const root = join(await tempDir(), "not", "yet", "there");
    const files = new FileTranscripts(root);
    await files.append(THREAD, undefined, [entry("m1"), entry("m2")]);
    await files.append(THREAD, SUB_A, [entry("a1")]);

    const threadDir = join(root, encodeURIComponent(THREAD));
    const main = await readFile(join(threadDir, "transcript.jsonl"), "utf8");
    expect(main.split("\n")).toEqual([JSON.stringify(entry("m1")), JSON.stringify(entry("m2")), ""]);
    expect(await readdir(join(threadDir, "subpaths")), "a subpath is one file, its slash encoded").toEqual([`${encodeURIComponent(SUB_A)}.jsonl`]);
    expect(await files.listSubkeys(THREAD)).toEqual([SUB_A]);
  });

  it("writes nothing, and creates nothing, for a batch it already holds", async () => {
    const root = join(await tempDir(), "transcripts");
    const files = new FileTranscripts(root);
    await files.append(THREAD, undefined, []);
    await expect(readdir(root), "an empty batch creates no directory").rejects.toThrow(/ENOENT/);
    await files.append(THREAD, undefined, [entry("m1")]);
    const before = await readFile(join(root, encodeURIComponent(THREAD), "transcript.jsonl"), "utf8");
    await files.append(THREAD, undefined, [entry("m1")]);
    expect(await readFile(join(root, encodeURIComponent(THREAD), "transcript.jsonl"), "utf8")).toBe(before);
  });

  it("deduplicates against what an earlier turn's store left on disk", async () => {
    const root = join(await tempDir(), "transcripts");
    await new FileTranscripts(root).append(THREAD, undefined, [entry("u1"), entry(undefined), entry("u2")]);
    const nextTurn = new FileTranscripts(root);
    await nextTurn.append(THREAD, undefined, [entry("u2"), entry("u3")]);
    expect(uuidsOf(await nextTurn.load(THREAD, undefined))).toEqual(["u1", undefined, "u2", "u3"]);
  });

  it("skips blank lines and lists only transcript files", async () => {
    const root = join(await tempDir(), "transcripts");
    const threadDir = join(root, encodeURIComponent(THREAD));
    await mkdir(join(threadDir, "subpaths"), { recursive: true });
    await writeFile(join(threadDir, "transcript.jsonl"), `${JSON.stringify(entry("u1"))}\n\n${JSON.stringify(entry("u2"))}\n\n`);
    await writeFile(join(threadDir, "subpaths", "notes.txt"), "not a transcript");
    const files = new FileTranscripts(root);
    expect(uuidsOf(await files.load(THREAD, undefined))).toEqual(["u1", "u2"]);
    expect(await files.listSubkeys(THREAD)).toEqual([]);
  });

  it("leaves out a last write a crash cut short, and starts the next append on a line of its own", async () => {
    const root = join(await tempDir(), "transcripts");
    const file = join(root, encodeURIComponent(THREAD), "transcript.jsonl");
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, `${JSON.stringify(entry("u1"))}\n{"type":"us`);
    const files = new FileTranscripts(root);
    expect(uuidsOf(await files.load(THREAD, undefined))).toEqual(["u1"]);
    await files.append(THREAD, undefined, [entry("u1"), entry("u2")]);
    expect(await readFile(file, "utf8")).toBe(`${JSON.stringify(entry("u1"))}\n${JSON.stringify(entry("u2"))}\n`);
    expect(uuidsOf(await new FileTranscripts(root).load(THREAD, undefined))).toEqual(["u1", "u2"]);
  });

  it("reads a file whose only write was cut short as no conversation", async () => {
    const root = join(await tempDir(), "transcripts");
    const file = join(root, encodeURIComponent(THREAD), "transcript.jsonl");
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, '{"type":"us');
    expect(await new FileTranscripts(root).load(THREAD, undefined)).toBeNull();
  });

  it("raises a complete line that does not parse: damage no crash explains", async () => {
    const root = join(await tempDir(), "transcripts");
    const file = join(root, encodeURIComponent(THREAD), "transcript.jsonl");
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, `not json\n${JSON.stringify(entry("u1"))}\n`);
    await expect(new FileTranscripts(root).load(THREAD, undefined)).rejects.toThrow(SyntaxError);
  });

  it("keeps a thread id with a path separator inside its own directory", async () => {
    const root = join(await tempDir(), "transcripts");
    await new FileTranscripts(root).append("a/../../b", undefined, [entry("u1")]);
    expect(await readdir(root)).toEqual([encodeURIComponent("a/../../b")]);
  });

  it("raises a read that fails for any reason but a missing file", async () => {
    const root = join(await tempDir(), "transcripts");
    const threadDir = join(root, encodeURIComponent(THREAD));
    await mkdir(join(threadDir, "transcript.jsonl"), { recursive: true });
    await writeFile(join(threadDir, "subpaths"), "a file where the directory goes");
    const files = new FileTranscripts(root);
    await expect(files.load(THREAD, undefined)).rejects.toThrow(/EISDIR/);
    await expect(files.listSubkeys(THREAD)).rejects.toThrow(/ENOTDIR/);
  });
});

describe("the HTTP backing on the wire", () => {
  it("speaks the engine-sessions lane: subpath \"\" for the main transcript, none on a whole-thread delete", async () => {
    const http = new HttpTranscripts(`${platform.url}//`, { current: TOKEN }, { maxRetries: 0 });
    await http.append(THREAD, undefined, [entry("u1")]);
    await http.append(THREAD, SUB_A, [entry("a1")]);
    await http.load(THREAD, undefined);
    await http.listSubkeys(THREAD);
    await http.delete(THREAD, SUB_A);
    await http.delete(THREAD, undefined);

    const lane = ENGINE_SESSIONS_LANE;
    const q = (subpath?: string): string => new URLSearchParams(subpath === undefined ? { thread_id: THREAD } : { thread_id: THREAD, subpath }).toString();
    expect(platform.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST ${lane}/entries`,
      `POST ${lane}/entries`,
      `GET ${lane}/entries?${q("")}`,
      `GET ${lane}/subkeys?${q()}`,
      `DELETE ${lane}/entries?${q(SUB_A)}`,
      `DELETE ${lane}/entries?${q()}`,
    ]);
    expect(JSON.parse(platform.requests[0]!.body)).toEqual({ thread_id: THREAD, subpath: "", entries: [entry("u1")] });
    expect(JSON.parse(platform.requests[1]!.body)).toEqual({ thread_id: THREAD, subpath: SUB_A, entries: [entry("a1")] });
  });

  it("sends nothing for an empty batch", async () => {
    await new HttpTranscripts(platform.url, { current: TOKEN }, { maxRetries: 0 }).append(THREAD, undefined, []);
    expect(platform.requests).toHaveLength(0);
  });

  it("reads the credential per request, and carries the turn's key only inside a turn", async () => {
    const credential = { current: "first-token" as string | null };
    const http = new HttpTranscripts(platform.url, credential, { maxRetries: 0 });
    await http.load(THREAD, undefined);
    credential.current = "rotated-token";
    await runWithExecutionContext("aex-1", () => http.load(THREAD, undefined), "turn-key-1");
    credential.current = null;
    await http.load(THREAD, undefined);

    expect(platform.requests.map((r) => r.headers.authorization)).toEqual(["Bearer first-token", "Bearer rotated-token", "Bearer"]);
    expect(platform.requests.map((r) => r.headers[TURN_KEY_HEADER])).toEqual([undefined, "turn-key-1", undefined]);
    expect(platform.requests[0]!.headers["content-type"]).toBe("application/json");
  });

  it("retries a transient failure with the bounded backoff, and a lost batch lands", async () => {
    const delays: number[] = [];
    const http = new HttpTranscripts(platform.url, { current: TOKEN }, { maxRetries: 2, baseDelayMs: 7, delayFn: async (ms) => void delays.push(ms) });
    platform.scripted.push({ status: 503, body: "busy" }, { status: 502, body: "gateway" });
    await http.append(THREAD, undefined, [entry("u1")]);
    expect(platform.requests.map((r) => r.method)).toEqual(["POST", "POST", "POST"]);
    expect(delays).toEqual([7, 14]);
    expect(uuidsOf(await http.load(THREAD, undefined))).toEqual(["u1"]);
  });

  it("raises a refusal at once with its status and body, and a transient one once the budget is spent", async () => {
    const http = new HttpTranscripts(platform.url, { current: TOKEN }, { maxRetries: 1, delayFn: async () => undefined });
    platform.scripted.push({ status: 403, body: "not your thread" });
    await expect(http.append(THREAD, undefined, [entry("u1")])).rejects.toThrow("engine session append failed: 403 Forbidden not your thread");
    expect(platform.requests, "a deterministic refusal is not retried").toHaveLength(1);

    platform.scripted.push({ status: 500, body: "" }, { status: 500, body: "" });
    await expect(http.load(THREAD, undefined)).rejects.toThrow(/^engine session load failed: 500 Internal Server Error$/);
    expect(platform.requests).toHaveLength(3);

    platform.scripted.push({ status: 400, body: "x".repeat(1000) });
    const err = await http.listSubkeys(THREAD).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message, "the body is cut to 300 characters").toBe(`engine session list sub-transcripts failed: 400 Bad Request ${"x".repeat(300)}`);

    platform.scripted.push({ status: 409, body: "conflict" });
    await expect(http.delete(THREAD, undefined)).rejects.toThrow("engine session delete failed: 409 Conflict conflict");
  });

  it("raises a refusal whose body cannot be read with its status alone", async () => {
    const http = new HttpTranscripts(platform.url, { current: TOKEN }, { maxRetries: 0 });
    platform.cutBody = true;
    await expect(http.delete(THREAD, undefined)).rejects.toThrow(/^engine session delete failed: 400 Bad Request$/);
  });

  it("raises a network failure once the budget is spent", async () => {
    const http = new HttpTranscripts("http://127.0.0.1:9", { current: TOKEN }, { maxRetries: 0 });
    await expect(http.load(THREAD, undefined)).rejects.toThrow(/fetch failed/);
  });
});
