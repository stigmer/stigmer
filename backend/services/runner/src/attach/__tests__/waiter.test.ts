/**
 * Pins the attach waiter (waiter.ts) over real HTTP and real child processes,
 * with a stand-in runner that records the environment it was started with:
 *
 *   - `/readyz` answers before any push;
 *   - the first accepted push starts exactly one runner, whose environment is
 *     the sandbox's own minus the waiter's variables, plus the queue and the
 *     pushed secrets;
 *   - a later push for the same queue starts nothing, and a runner that exits
 *     restarts with the latest pushed environment;
 *   - a push for another sandbox's queue, a malformed push and a wrong method
 *     start nothing;
 *   - closing the waiter stops the runner and waits for it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startAttachWaiter, type AttachWaiter } from "../waiter.js";

const SESSION_QUEUE = "session:ses_01m3zkdb7wxbe2gx0ezmf8fmaq";
const SESSION_SANDBOX = "sbx-ses-4e918096d317";

// Records its environment under OUT_DIR as <pid>.json, then either exits at
// once (EXIT_AT_ONCE, a crashing runner) or stays until SIGTERM, logging it.
const FAKE_RUNNER = `
const { writeFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const pick = (k) => process.env[k];
writeFileSync(join(process.env.OUT_DIR, process.pid + ".json"), JSON.stringify({
  queue: pick("STIGMER_TASK_QUEUE"), token: pick("STIGMER_TOKEN"), key: pick("STIGMER_PAYLOAD_ENCRYPTION_KEY"),
  base: pick("TEMPLATE_VALUE"), port: pick("STIGMER_ATTACH_PORT"), nameFile: pick("STIGMER_SANDBOX_NAME_FILE"),
}));
if (process.env.EXIT_AT_ONCE === "1") process.exit(3);
process.on("SIGTERM", () => { appendFileSync(join(process.env.OUT_DIR, "sigterm.log"), process.pid + "\\n"); process.exit(0); });
setInterval(() => {}, 1 << 30);
`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("attach waiter", () => {
  let dir: string;
  let outDir: string;
  let entry: string;
  let waiter: AttachWaiter | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "attach-waiter-"));
    outDir = join(dir, "out");
    mkdirSync(outDir);
    entry = join(dir, "fake-runner.cjs");
    writeFileSync(entry, FAKE_RUNNER);
  });

  afterEach(async () => {
    await waiter?.close();
    waiter = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  const started = () => readdirSync(outDir).filter((f) => f.endsWith(".json"));
  const record = (file: string) => JSON.parse(readFileSync(join(outDir, file), "utf8")) as Record<string, string>;

  async function start(extraEnv: Record<string, string> = {}): Promise<AttachWaiter> {
    waiter = await startAttachWaiter({
      port: 0,
      readSandboxName: () => SESSION_SANDBOX,
      runnerEntry: entry,
      baseEnv: {
        PATH: process.env.PATH,
        OUT_DIR: outDir,
        TEMPLATE_VALUE: "from-the-template",
        STIGMER_ATTACH_PORT: "80",
        STIGMER_SANDBOX_NAME_FILE: "/run/ate/actor-name",
        ...extraEnv,
      },
      restartDelayMs: 50,
      maxRestartDelayMs: 200,
      log: () => {},
    });
    return waiter;
  }

  async function push(w: AttachWaiter, body: unknown, method = "POST"): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`http://127.0.0.1:${w.port}/attach`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("answers readiness before any push", async () => {
    const w = await start();
    const res = await fetch(`http://127.0.0.1:${w.port}/readyz`);
    expect(res.status).toBe(200);
    expect(w.attachedQueue()).toBeUndefined();
    expect(started()).toEqual([]);
  });

  it("starts one runner on the first push with the pod's environment", async () => {
    const w = await start();
    const token = jwt({ token_type: "sandbox" });
    const res = await push(w, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: token, STIGMER_PAYLOAD_ENCRYPTION_KEY: "k1" } });
    expect(res).toEqual({ status: 200, body: { taskQueue: SESSION_QUEUE, started: true } });
    await until(() => started().length === 1);
    expect(record(started()[0]!)).toEqual({
      queue: SESSION_QUEUE,
      token,
      key: "k1",
      base: "from-the-template",
    });
    expect(w.attachedQueue()).toBe(SESSION_QUEUE);
  });

  it("starts nothing on a later push for the same queue, and restarts a runner that exits with the latest push", async () => {
    const w = await start();
    const first = jwt({ n: 1 });
    const second = jwt({ n: 2 });
    await push(w, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: first } });
    await until(() => started().length === 1);
    const res = await push(w, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: second } });
    expect(res).toEqual({ status: 200, body: { taskQueue: SESSION_QUEUE, started: false } });
    await new Promise((r) => setTimeout(r, 200));
    expect(started()).toHaveLength(1);

    // Kill the live runner: the waiter restarts it with the second push's token.
    process.kill(Number(started()[0]!.replace(".json", "")), "SIGKILL");
    await until(() => started().length === 2);
    const tokens = started().map((f) => record(f).token);
    expect(tokens).toContain(second);
  });

  it("backs off a runner that dies at once instead of spinning", async () => {
    const w = await start({ EXIT_AT_ONCE: "1" });
    await push(w, { taskQueue: SESSION_QUEUE, secrets: {} });
    await new Promise((r) => setTimeout(r, 700));
    // 50, 100, 200, 200 ms delays: a handful of starts, never dozens.
    expect(started().length).toBeGreaterThanOrEqual(2);
    expect(started().length).toBeLessThanOrEqual(6);
  });

  it("starts nothing for another sandbox's queue, a malformed push or a wrong method", async () => {
    const w = await start();
    expect((await push(w, { taskQueue: "session:ses_other", secrets: {} })).status).toBe(403);
    expect((await push(w, "{not json")).status).toBe(400);
    expect((await push(w, { taskQueue: SESSION_QUEUE, secrets: { NODE_OPTIONS: "x" } })).status).toBe(400);
    expect((await push(w, undefined, "GET")).status).toBe(405);
    expect((await push(w, "x".repeat(70 * 1024))).status).toBe(413);
    await new Promise((r) => setTimeout(r, 100));
    expect(started()).toEqual([]);
    expect(w.attachedQueue()).toBeUndefined();
  });

  it("stops the runner and waits for it when closed", async () => {
    const w = await start();
    await push(w, { taskQueue: SESSION_QUEUE, secrets: {} });
    await until(() => started().length === 1);
    await w.close();
    waiter = undefined;
    const pid = started()[0]!.replace(".json", "");
    expect(readFileSync(join(outDir, "sigterm.log"), "utf8").trim()).toBe(pid);
  });
});
