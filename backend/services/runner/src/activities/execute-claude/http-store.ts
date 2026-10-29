/**
 * A Claude session's conversation on the platform: the session store's
 * backing in cloud mode (`session-store.ts`), through the runner's local
 * proxy's engine-sessions lane (`agent-proxy/server.ts`), which checks that
 * every call names its live turn's own thread and forwards it to the
 * platform with the runner's credential, as the Stigmer harness's checkpoints
 * travel (`shared/checkpointer/http-saver.ts`).
 *
 * The wire, one home for the runner's half ({@link ENGINE_SESSIONS_LANE}):
 *
 *  - `POST /entries`, `{thread_id, subpath, entries}`: append, the platform
 *    ignoring an entry whose `uuid` it already holds for that transcript;
 *  - `GET /entries?thread_id=&subpath=`: `{entries}` in append order, or
 *    404 for a transcript never written;
 *  - `GET /subkeys?thread_id=`: `{subkeys}`;
 *  - `DELETE /entries?thread_id=[&subpath=]`: one transcript, or with no
 *    `subpath` every transcript of the thread.
 *
 * `subpath` is `""` for the main transcript. Every request carries the
 * host's credential, read per request, and the turn's key, and runs through
 * the shared bounded backoff with the checkpoint saver's budget: a lost
 * batch is a hole in the conversation the next turn resumes from, so it is
 * retried as a checkpoint is, and the SDK's own three attempts sit on top.
 */

import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import type { TokenRef } from "../../config.js";
import { turnKeyHeader } from "../../shared/execution-context.js";
import { fetchWithRetry, type FetchRetryPolicy } from "../../shared/http-retry.js";
import type { TranscriptBacking } from "./session-store.js";

/** The lane's path under the proxy, the platform's own. */
export const ENGINE_SESSIONS_LANE = "/v1/proxy/engine-sessions";

/** The checkpoint saver's budget (`http-saver.ts` explains it), for the same reason. */
const RETRY: Omit<FetchRetryPolicy, "label"> = { baseDelayMs: 250, backoffFactor: 2, maxRetries: 5, requestTimeoutMs: 30_000 };

/** The HTTP backing (the header). */
export class HttpTranscripts implements TranscriptBacking {
  private readonly base: string;
  private readonly policy: FetchRetryPolicy;

  constructor(
    proxyEndpoint: string,
    private readonly credential: Readonly<TokenRef>,
    policy: Partial<Omit<FetchRetryPolicy, "label">> = {},
  ) {
    this.base = `${proxyEndpoint.replace(/\/+$/, "")}${ENGINE_SESSIONS_LANE}`;
    this.policy = { label: "HttpTranscripts", ...RETRY, ...policy };
  }

  async append(threadId: string, subpath: string | undefined, entries: readonly SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const res = await this.send(`${this.base}/entries`, {
      method: "POST",
      body: JSON.stringify({ thread_id: threadId, subpath: subpath ?? "", entries }),
    });
    await expectOk(res, "append");
  }

  async load(threadId: string, subpath: string | undefined): Promise<SessionStoreEntry[] | null> {
    const res = await this.send(`${this.base}/entries?${query(threadId, subpath ?? "")}`, { method: "GET" });
    if (res.status === 404) return null;
    await expectOk(res, "load");
    return ((await res.json()) as { entries: SessionStoreEntry[] }).entries;
  }

  async listSubkeys(threadId: string): Promise<string[]> {
    const res = await this.send(`${this.base}/subkeys?${query(threadId)}`, { method: "GET" });
    await expectOk(res, "list sub-transcripts");
    return ((await res.json()) as { subkeys: string[] }).subkeys;
  }

  async delete(threadId: string, subpath: string | undefined): Promise<void> {
    const res = await this.send(`${this.base}/entries?${query(threadId, subpath)}`, { method: "DELETE" });
    await expectOk(res, "delete");
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return fetchWithRetry(
      url,
      {
        ...init,
        headers: { Authorization: `Bearer ${this.credential.current ?? ""}`, "Content-Type": "application/json", ...turnKeyHeader() },
      },
      this.policy,
    );
  }
}

function query(threadId: string, subpath?: string): string {
  const params = new URLSearchParams({ thread_id: threadId });
  if (subpath !== undefined) params.set("subpath", subpath);
  return params.toString();
}

async function expectOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`engine session ${what} failed: ${res.status} ${res.statusText}${body ? ` ${body.slice(0, 300)}` : ""}`);
}
