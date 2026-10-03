/**
 * Pins the attach waiter (waiter.ts) over real HTTP and real child processes,
 * with a stand-in runner that records the environment it was started with:
 *
 *   - `/readyz` answers before any push;
 *   - the first accepted push starts exactly one runner, whose environment is
 *     the sandbox's own minus the waiter's variables, plus the queue and the
 *     pushed secrets;
 *   - a later push for the same queue starts nothing and may only rotate the
 *     token, for one of the same kind and session, and a runner that exits
 *     restarts with the latest token; a push during a restart's delay
 *     starts the runner at once;
 *   - every refusal carries its stable code;
 *   - a push for another sandbox's queue, a malformed push and a wrong method
 *     start nothing;
 *   - a runner that cannot be started at all is retried once per failure,
 *     even when the platform reports both an error and an exit; a spawn
 *     that throws leaves a first push unattached (500) and a restart
 *     retrying, and logs no value; the back-off resets after a runner that
 *     served for a while;
 *   - a sandbox serves one queue for life (409), an unreadable sandbox name
 *     answers 500, an unknown path 404;
 *   - closing the waiter stops the runner and waits for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { laterPushRefusal, spawnErrorCode, startAttachWaiter, type AttachWaiter, type RunnerSpawner } from "../waiter.js";

const SESSION_QUEUE = "session:ses_01m3zkdb7wxbe2gx0ezmf8fmaq";
const SESSION_SANDBOX = "sbx-ses-4e918096d317";

// Records its environment under OUT_DIR as <pid>.json, then stays until
// SIGTERM, logging it.
const FAKE_RUNNER = `
const { writeFileSync, appendFileSync } = require("node:fs");
const { join } = require("node:path");
const pick = (k) => process.env[k];
writeFileSync(join(process.env.OUT_DIR, process.pid + ".json"), JSON.stringify({
  queue: pick("STIGMER_TASK_QUEUE"), token: pick("STIGMER_TOKEN"), key: pick("STIGMER_PAYLOAD_ENCRYPTION_KEY"),
  base: pick("TEMPLATE_VALUE"), port: pick("STIGMER_ATTACH_PORT"), nameFile: pick("STIGMER_SANDBOX_NAME_FILE"),
}));
process.on("SIGTERM", () => { appendFileSync(join(process.env.OUT_DIR, "sigterm.log"), process.pid + "\\n"); process.exit(0); });
setInterval(() => {}, 1 << 30);
`;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

/** A stand-in runner that stays until killed, and exits when it is. */
function stayingRunner(_entry?: string): ChildProcess {
  const fake = new EventEmitter() as unknown as ChildProcess;
  return Object.assign(fake, {
    exitCode: null,
    signalCode: null,
    kill: () => {
      setImmediate(() => fake.emit("exit", null, "SIGTERM"));
      return true;
    },
  });
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

  it("refuses a later push that changes another secret or drops the token", async () => {
    const w = await start();
    const token = jwt({ n: 1 });
    await push(w, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: token, STIGMER_RUNNER_HITL_SECRET: "first" } });
    await until(() => started().length === 1);
    const swapped = await push(w, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: token, STIGMER_RUNNER_HITL_SECRET: "attacker" } });
    expect(swapped).toMatchObject({ status: 409, body: { code: "secrets_changed" } });
    const dropped = await push(w, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_RUNNER_HITL_SECRET: "first" } });
    expect(dropped).toEqual({ status: 409, body: { error: "a later push may not drop STIGMER_TOKEN", code: "token_mismatch" } });

    // The refused pushes changed nothing: a restart still carries the first push's secrets.
    process.kill(Number(started()[0]!.replace(".json", "")), "SIGKILL");
    await until(() => started().length === 2);
    expect(started().map((f) => record(f).token)).toEqual([token, token]);
  });

  it("backs off a runner that dies at once instead of spinning", async () => {
    // A stand-in that exits as soon as it starts; only the gaps between
    // starts are asserted, as lower bounds, since a timer never fires early.
    const startedAt: number[] = [];
    const dying: RunnerSpawner = () => {
      startedAt.push(Date.now());
      const fake = new EventEmitter() as unknown as ChildProcess;
      setImmediate(() => fake.emit("exit", 3, null));
      return fake;
    };
    waiter = await startAttachWaiter({
      port: 0,
      readSandboxName: () => SESSION_SANDBOX,
      runnerEntry: entry,
      baseEnv: {},
      spawnRunner: dying,
      restartDelayMs: 50,
      maxRestartDelayMs: 200,
      log: () => {},
    });
    await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} });
    await until(() => startedAt.length >= 5);
    const gaps = startedAt.slice(1, 5).map((t, i) => t - startedAt[i]!);
    // 50, 100, 200, then held at the 200 ms cap.
    [50, 100, 200, 200].forEach((floor, i) => expect(gaps[i]).toBeGreaterThanOrEqual(floor - 5));
  });

  it("starts a runner waiting out its restart delay at once when a push arrives", async () => {
    const logs: string[] = [];
    let spawns = 0;
    // 1: dies at once, so a 10-second delay starts; 2: stays.
    const spawner: RunnerSpawner = () => {
      spawns += 1;
      const fake = stayingRunner();
      if (spawns === 1) setImmediate(() => fake.emit("exit", 1, null));
      return fake;
    };
    waiter = await startAttachWaiter({
      port: 0,
      readSandboxName: () => SESSION_SANDBOX,
      runnerEntry: entry,
      baseEnv: {},
      spawnRunner: spawner,
      restartDelayMs: 10_000,
      log: (m) => logs.push(m),
    });
    await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} });
    await until(() => logs.some((m) => m.includes("restarting in 10000ms")));
    const begun = Date.now();
    expect((await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} })).body).toEqual({ taskQueue: SESSION_QUEUE, started: false });
    expect(spawns).toBe(2);
    expect(Date.now() - begun).toBeLessThan(10_000);
    expect(logs).toContain("[attach] a push arrived during the restart delay; restarting now");
  });

  it("leaves the sandbox unattached when a first push's runner cannot start, and logs no value", async () => {
    const logs: string[] = [];
    let throwing = true;
    const spawner: RunnerSpawner = (entryPath, env) => {
      if (throwing) {
        throw Object.assign(new TypeError(`The argument 'options.env['STIGMER_TOKEN']' must be a string without null bytes. Received '${env.STIGMER_TOKEN}'`), { code: "ERR_INVALID_ARG_VALUE" });
      }
      return stayingRunner(entryPath);
    };
    waiter = await startAttachWaiter({ port: 0, readSandboxName: () => SESSION_SANDBOX, runnerEntry: entry, baseEnv: {}, spawnRunner: spawner, log: (m) => logs.push(m) });
    const failed = await push(waiter, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: jwt({ secret: "s3cr3t" }) } });
    expect(failed).toEqual({ status: 500, body: { error: "the runner could not be started", code: "runner_start_failed" } });
    expect(waiter.attachedQueue()).toBeUndefined();
    expect(logs.join("\n")).not.toContain("s3cr3t");
    expect(logs).toContain("[attach] the runner could not be started (ERR_INVALID_ARG_VALUE)");
    throwing = false;
    expect((await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} })).body).toEqual({ taskQueue: SESSION_QUEUE, started: true });
    expect(waiter.attachedQueue()).toBe(SESSION_QUEUE);
  });

  it("keeps retrying, without crashing, when a restart's spawn throws; and resets the back-off after a runner that served a while", async () => {
    const logs: string[] = [];
    let spawns = 0;
    // 1: dies at once; 2: throws; 3: lives 300 ms (longer than the 200 ms cap); 4: stays.
    const spawner: RunnerSpawner = () => {
      spawns += 1;
      if (spawns === 2) throw Object.assign(new Error("boom"), { code: "EAGAIN" });
      const fake = stayingRunner();
      if (spawns === 1) setImmediate(() => fake.emit("exit", 1, null));
      if (spawns === 3) setTimeout(() => fake.emit("exit", 1, null), 300);
      return fake;
    };
    waiter = await startAttachWaiter({
      port: 0, readSandboxName: () => SESSION_SANDBOX, runnerEntry: entry, baseEnv: {},
      spawnRunner: spawner, restartDelayMs: 50, maxRestartDelayMs: 200, log: (m) => logs.push(m),
    });
    await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} });
    await until(() => spawns >= 4, 5000);
    expect(logs.filter((m) => m.includes("restarting"))).toEqual([
      "[attach] runner exited (1); restarting in 50ms",
      "[attach] runner could not be started; restarting in 100ms",
      // The third runner served longer than the cap, so the delay starts over.
      "[attach] runner exited (1); restarting in 50ms",
    ]);
  });

  it("starts nothing for another sandbox's queue, a malformed push or a wrong method", async () => {
    const w = await start();
    expect(await push(w, { taskQueue: "session:ses_other", secrets: {} })).toMatchObject({ status: 403, body: { code: "binding" } });
    expect(await push(w, "{not json")).toMatchObject({ status: 400, body: { code: "malformed" } });
    expect(await push(w, { taskQueue: SESSION_QUEUE, secrets: { NODE_OPTIONS: "x" } })).toMatchObject({ status: 400, body: { code: "malformed" } });
    expect(await push(w, undefined, "GET")).toMatchObject({ status: 405, body: { code: "method_not_allowed" } });
    expect(await push(w, "x".repeat(70 * 1024))).toMatchObject({ status: 413, body: { code: "too_large" } });
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

  it("logs to the console when no logger is given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      waiter = await startAttachWaiter({ port: 0, readSandboxName: () => SESSION_SANDBOX, runnerEntry: entry, baseEnv: {} });
      await push(waiter, { taskQueue: "session:ses_other", secrets: {} });
      expect(warn.mock.calls.flat().join(" ")).toMatch(/push refused \(403\)/);
    } finally {
      warn.mockRestore();
    }
  });

  it("retries a runner that cannot be started once per failure, even when error and exit both arrive", async () => {
    const logs: string[] = [];
    let spawns = 0;
    const failing: RunnerSpawner = () => {
      spawns += 1;
      const fake = new EventEmitter() as unknown as ChildProcess;
      setImmediate(() => {
        fake.emit("error", Object.assign(new Error("spawn /no/node ENOENT"), { code: "ENOENT" }));
        fake.emit("exit", null, null);
      });
      return fake;
    };
    waiter = await startAttachWaiter({
      port: 0,
      readSandboxName: () => SESSION_SANDBOX,
      runnerEntry: entry,
      baseEnv: {},
      spawnRunner: failing,
      restartDelayMs: 1000,
      log: (m) => logs.push(m),
    });
    await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} });
    await until(() => logs.some((m) => m.includes("restarting")));
    await new Promise((r) => setTimeout(r, 50));
    expect(spawns).toBe(1);
    expect(logs.filter((m) => m.includes("restarting"))).toEqual(["[attach] runner failed to start (ENOENT); restarting in 1000ms"]);
  });

  it("serves one queue for life, answers 500 when its name cannot be read, and 404 elsewhere", async () => {
    const names = ["sbx-ses-4e918096d317", "sbx-ses-245a956f6110"];
    let reads = 0;
    let unreadable = false;
    waiter = await startAttachWaiter({
      port: 0,
      readSandboxName: () => {
        if (unreadable) throw new Error("ENOENT: /run/ate/actor-name");
        return names[Math.min(reads++, 1)]!;
      },
      runnerEntry: entry,
      baseEnv: { PATH: process.env.PATH, OUT_DIR: outDir },
      log: () => {},
    });
    expect((await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} })).status).toBe(200);
    // A second queue whose name this sandbox now carries still finds it taken.
    const second = await push(waiter, { taskQueue: "session:ses_second", secrets: {} });
    expect(second).toEqual({ status: 409, body: { error: `this sandbox serves ${SESSION_QUEUE}`, code: "other_queue" } });
    unreadable = true;
    expect((await push(waiter, { taskQueue: SESSION_QUEUE, secrets: {} })).status).toBe(500);
    expect((await fetch(`http://127.0.0.1:${waiter.port}/nope`)).status).toBe(404);
  });
});

describe("laterPushRefusal", () => {
  it("accepts a later push that rotates or keeps the token and nothing else", () => {
    expect(laterPushRefusal({ STIGMER_TOKEN: "a", STIGMER_PAYLOAD_ENCRYPTION_KEY: "k" }, { STIGMER_TOKEN: "b", STIGMER_PAYLOAD_ENCRYPTION_KEY: "k" })).toBeUndefined();
    expect(laterPushRefusal({}, {})).toBeUndefined();
    expect(laterPushRefusal({}, { STIGMER_TOKEN: "late" })).toBeUndefined();
  });

  it("refuses a changed, added or removed secret other than the token, as secrets_changed", () => {
    expect(laterPushRefusal({ STIGMER_PAYLOAD_ENCRYPTION_KEY: "k" }, { STIGMER_PAYLOAD_ENCRYPTION_KEY: "x" })).toEqual({
      code: "secrets_changed",
      reason: expect.stringMatching(/STIGMER_PAYLOAD_ENCRYPTION_KEY differs/),
    });
    expect(laterPushRefusal({}, { CURSOR_API_KEY: "k" })?.code).toBe("secrets_changed");
    expect(laterPushRefusal({ CURSOR_API_KEY: "k" }, {})?.code).toBe("secrets_changed");
  });

  it("refuses dropping a token the first push carried, as token_mismatch", () => {
    expect(laterPushRefusal({ STIGMER_TOKEN: "a" }, {})).toEqual({ code: "token_mismatch", reason: "a later push may not drop STIGMER_TOKEN" });
    expect(laterPushRefusal({ STIGMER_TOKEN: "a" }, { STIGMER_TOKEN: "" })?.code).toBe("token_mismatch");
  });

  it("refuses a token of another kind, or for another session, as token_mismatch", () => {
    const session = (type: string, sessionId?: string) =>
      jwt({ token_type: type, ...(sessionId ? { session_id: sessionId } : {}) });
    expect(laterPushRefusal({ STIGMER_TOKEN: session("sandbox", "ses_a") }, { STIGMER_TOKEN: session("sandbox", "ses_a") })).toBeUndefined();
    expect(laterPushRefusal({ STIGMER_TOKEN: session("sandbox", "ses_a") }, { STIGMER_TOKEN: session("sandbox", "ses_b") })).toEqual({
      code: "token_mismatch",
      reason: "a later push's token names another session than the first push's",
    });
    expect(laterPushRefusal({ STIGMER_TOKEN: session("sandbox", "ses_a") }, { STIGMER_TOKEN: session("workflow_sandbox", "ses_a") })?.code).toBe("token_mismatch");
    // Tokens that name an execution carry no session: a rotation between two
    // of them is accepted.
    expect(laterPushRefusal({ STIGMER_TOKEN: session("execution_scoped") }, { STIGMER_TOKEN: session("execution_scoped") })).toBeUndefined();
  });
});

describe("spawnErrorCode", () => {
  it("names an error by its code, else its name, and never by its message", () => {
    expect(spawnErrorCode(Object.assign(new TypeError("Received 'secret'"), { code: "ERR_INVALID_ARG_VALUE" }))).toBe("ERR_INVALID_ARG_VALUE");
    expect(spawnErrorCode(new RangeError("Received 'secret'"))).toBe("RangeError");
    expect(spawnErrorCode("Received 'secret'")).toBe("unknown error");
    expect(spawnErrorCode({ code: 42 })).toBe("unknown error");
  });
});
