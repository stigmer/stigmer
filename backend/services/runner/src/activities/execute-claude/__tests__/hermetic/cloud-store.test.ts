/**
 * Hermetic golden: a Claude session kept on the platform
 * (`checkpointerType: "http"`), on the real engine, as a cloud runner keeps
 * it: the host's store (`http-store.ts`) calls the runner's proxy, whose
 * engine-sessions lane checks the live turn's thread and forwards to the
 * platform with the runner's credential (here, a stand-in serving the lane's
 * wire from memory).
 *
 *  - The next message resumes from the platform alone: the session's whole
 *    Claude directory on this machine is gone, as on another runner.
 *  - A batch the platform refuses is a hole the next turn would resume
 *    from, so the turn fails on the internal surface naming it, never
 *    completes as if the conversation were kept.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { getClaudeEngineDir } from "../../../../shared/workspace/platform-dir.js";
import { anthropicText, saidByUser, WIRE_RUNNER_TOKEN } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, type ClaudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";
import { ENGINE_SESSIONS_LANE } from "../../http-store.js";

/** The platform's engine-sessions lane, kept in memory (`http-store.ts` names the wire). */
class PlatformStandIn {
  readonly transcripts = new Map<string, unknown[]>();
  readonly authorizations = new Set<string>();
  refuseAppends = false;
  url = "";
  private server: Server | undefined;

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server === undefined ? resolve() : this.server.close(() => resolve())));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.authorizations.add(req.headers.authorization ?? "");
    const url = new URL(req.url ?? "", this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const reply = (status: number, body?: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" }).end(body === undefined ? "" : JSON.stringify(body));
    };
    const key = (thread: string | null, subpath: string | null): string => `${thread ?? ""}|${subpath ?? ""}`;
    const path = url.pathname.slice(ENGINE_SESSIONS_LANE.length);
    if (path === "/entries" && req.method === "POST") {
      if (this.refuseAppends) return reply(403, { message: "refused" });
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { thread_id: string; subpath: string; entries: { uuid?: string }[] };
      const held = this.transcripts.get(key(body.thread_id, body.subpath)) ?? [];
      const seen = new Set(held.map((entry) => (entry as { uuid?: string }).uuid));
      held.push(...body.entries.filter((entry) => entry.uuid === undefined || !seen.has(entry.uuid)));
      this.transcripts.set(key(body.thread_id, body.subpath), held);
      return reply(200, {});
    }
    if (path === "/entries" && req.method === "GET") {
      const held = this.transcripts.get(key(url.searchParams.get("thread_id"), url.searchParams.get("subpath")));
      return held === undefined ? reply(404) : reply(200, { entries: held });
    }
    if (path === "/subkeys") return reply(200, { subkeys: [] });
    return reply(404);
  }
}

const platform = new PlatformStandIn();
const env = createHermeticEnvironment();
const clock = new ScriptedClock();
let file: ClaudeScenarioFile;

describe("ExecuteClaude hermetic — a session kept on the platform", () => {
  beforeAll(async () => {
    await platform.start();
    file = claudeScenarioFile(env, clock, { checkpointerType: "http", checkpointerProxyEndpoint: platform.url });
    await file.start();
  });
  afterAll(async () => {
    await file.stop();
    await platform.stop();
  });

  it("the next message resumes from the platform alone, nothing of the session left on this machine", async () => {
    platform.transcripts.clear();
    const first = claudeExecutionRecord({ message: "Remember the word kestrel." });
    const one = await file.run(first, () => anthropicText("Noted: kestrel."));
    expect((one.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(platform.transcripts.get(`${FIXTURE.threadId}|`)?.length, "the conversation is on the platform").toBeGreaterThan(0);
    expect([...platform.authorizations], "forwarded with the runner's credential alone").toEqual([`Bearer ${WIRE_RUNNER_TOKEN}`]);

    rmSync(getClaudeEngineDir(FIXTURE.sessionId), { recursive: true, force: true });
    const before = file.wire().conversations.length;
    const two = await file.resume(claudeExecutionRecord({ message: "Which word?", executionId: "aex_claude_0002" }), () => anthropicText("Kestrel."));

    expect((two.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    const resumed = file.wire().conversations[before]!;
    expect(saidByUser(resumed, "Remember the word kestrel."), "resumed from the platform").toBe(true);
    expect(JSON.stringify(resumed.body)).toContain("Noted: kestrel.");
  });

  it("a batch the platform refuses fails the turn on the internal surface, naming the lost history", async () => {
    platform.transcripts.clear();
    platform.refuseAppends = true;
    try {
      const record = claudeExecutionRecord({ message: "Say anything." });
      const invocation = await file.run(record, () => anthropicText("Anything."));
      expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_FAILED");
      expect(record.lastFullStatus?.error).toMatch(/conversation|history|transcript/i);
    } finally {
      platform.refuseAppends = false;
    }
  });
});
