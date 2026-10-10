/**
 * Pins the pattern pool's handling of a misbehaving worker (patterns.ts),
 * with `node:worker_threads` replaced by a scripted worker so each fault
 * happens on cue: a reply carrying another job's id resolves nothing, a
 * reply from a worker its deadline already retired is dropped, and a
 * worker that errors rejects the job it held, is terminated, and the next
 * job runs on a fresh worker. The real worker's counting is pinned by
 * patterns.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { newPatternPool } from "../patterns.js";

interface PostedJob {
  readonly id: number;
  readonly pattern: string;
}

const scripted = vi.hoisted(() => ({
  workers: [] as Array<{
    posted: PostedJob[];
    terminated: boolean;
    emit(event: string, value: unknown): boolean;
  }>,
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  class ScriptedWorker extends EventEmitter {
    readonly posted: PostedJob[] = [];
    terminated = false;
    constructor() {
      super();
      scripted.workers.push(this);
    }
    unref(): void {}
    postMessage(job: PostedJob): void {
      this.posted.push(job);
    }
    terminate(): Promise<number> {
      this.terminated = true;
      return Promise.resolve(1);
    }
  }
  return { Worker: ScriptedWorker };
});

function job(pattern: string, budgetMs = 60_000) {
  return { pattern, flags: "", texts: ["a"], limit: 1, budgetMs };
}

function worker(index: number) {
  const found = scripted.workers[index];
  if (found === undefined) {
    throw new Error(
      `expected worker ${index}, the pool started ${scripted.workers.length}`,
    );
  }
  return found;
}

afterEach(() => {
  scripted.workers.length = 0;
});

describe("the pattern pool with a misbehaving worker", () => {
  it("resolves a job only by a reply carrying its own id", async () => {
    const pool = newPatternPool(1);
    let answered = false;
    const answer = pool.count(job("a")).then((value) => {
      answered = true;
      return value;
    });
    const posted = worker(0).posted[0];
    expect(posted?.pattern).toBe("a");
    const id = posted?.id ?? 0;

    worker(0).emit("message", { id: id + 1, kind: "counts", counts: [9] });
    await Promise.resolve();
    expect(answered).toBe(false);

    worker(0).emit("message", { id, kind: "counts", counts: [1] });
    expect(await answer).toEqual({ kind: "counts", counts: [1] });
    await pool.close();
  });

  it("drops a reply from a worker its deadline retired, and runs the next job on a fresh one", async () => {
    const pool = newPatternPool(1);
    expect(await pool.count(job("slow", 5))).toEqual({ kind: "timeout" });
    const retired = worker(0);
    expect(retired.terminated).toBe(true);

    const late = retired.posted[0]?.id ?? 0;
    retired.emit("message", { id: late, kind: "counts", counts: [1] });

    const next = pool.count(job("b"));
    const fresh = worker(1);
    const posted = fresh.posted[0];
    expect(posted?.pattern).toBe("b");
    fresh.emit("message", { id: posted?.id, kind: "invalid", message: "bad" });
    expect(await next).toEqual({ kind: "invalid", message: "bad" });
    await pool.close();
  });

  it("rejects the job of a worker that errors, retires it, and hands the queue to a fresh worker", async () => {
    const pool = newPatternPool(1);
    const failing = pool.count(job("a"));
    const queued = pool.count(job("b"));
    const broken = worker(0);
    expect(broken.posted.map((posted) => posted.pattern)).toEqual(["a"]);

    broken.emit("error", new Error("worker crashed"));
    await expect(failing).rejects.toThrow("worker crashed");
    expect(broken.terminated).toBe(true);

    const fresh = worker(1);
    const posted = fresh.posted[0];
    expect(posted?.pattern).toBe("b");
    fresh.emit("message", { id: posted?.id, kind: "counts", counts: [0] });
    expect(await queued).toEqual({ kind: "counts", counts: [0] });
    await pool.close();
  });
});
