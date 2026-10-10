/**
 * Pins the pattern pool's handling of a misbehaving worker (patterns.ts),
 * with `node:worker_threads` replaced by a scripted worker so each fault
 * happens on cue: a reply carrying another job's id resolves nothing, a
 * reply from a worker its deadline already retired is dropped, and a
 * worker that errors rejects the job it held, is terminated, and the next
 * job runs on a fresh worker; a job that waits past the queue bound for a
 * worker is answered "busy" and never posted, while one a worker takes in
 * time is not. Evals take turns: one eval holds at most four jobs in the
 * queue, its later jobs joining the tail behind other evals' as its own
 * leave, a backlogged job answered busy past the same bound, and a closed
 * pool rejects the backlog too. The default pool's size is min(4, the
 * machine's parallelism). The real worker's counting is pinned by
 * patterns.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { availableParallelism } from "node:os";

import {
  PATTERN_POOL_SIZE,
  PATTERN_QUEUE_PER_OWNER,
  newPatternPool,
  patternsFor,
} from "../patterns.js";

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

describe("the pattern pool's queue bound", () => {
  it("answers a job that waits past the bound busy, never running it, and keeps the worker's job", async () => {
    const pool = newPatternPool(1, { queueWaitMs: 10 });
    const running = pool.count(job("a"));
    const queued = pool.count(job("b"));
    expect(await queued).toEqual({ kind: "busy" });
    const held = worker(0);
    const posted = held.posted[0];
    held.emit("message", { id: posted?.id, kind: "counts", counts: [1] });
    expect(await running).toEqual({ kind: "counts", counts: [1] });
    expect(held.posted.map((entry) => entry.pattern)).toEqual(["a"]);
    await pool.close();
  });

  it("runs a queued job a worker takes within the bound", async () => {
    const pool = newPatternPool(1, { queueWaitMs: 30 });
    const first = pool.count(job("a"));
    const second = pool.count(job("b"));
    const held = worker(0);
    held.emit("message", { id: held.posted[0]?.id, kind: "counts", counts: [1] });
    await first;
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    held.emit("message", { id: held.posted[1]?.id, kind: "counts", counts: [0] });
    expect(await second).toEqual({ kind: "counts", counts: [0] });
    await pool.close();
  });

  it("sizes the default pool at min(4, the machine's parallelism)", () => {
    expect(PATTERN_POOL_SIZE).toBe(Math.min(4, availableParallelism()));
  });
});

describe("the pattern pool's turns between evals", () => {
  /** Answers the one worker's jobs in turn, `count` of them, naming each pattern it was posted. */
  async function drain(count: number): Promise<string[]> {
    const held = worker(0);
    for (let answered = 0; answered < count; answered++) {
      const posted = held.posted[answered];
      held.emit("message", { id: posted?.id, kind: "counts", counts: [1] });
      await Promise.resolve();
    }
    return held.posted.map((entry) => entry.pattern);
  }

  it("holds at most four of one eval's jobs in the queue, so another eval's job runs before its backlog", async () => {
    expect(PATTERN_QUEUE_PER_OWNER).toBe(4);
    const pool = newPatternPool(1);
    const first = patternsFor(pool, "pev_a");
    const second = patternsFor(pool, "pev_b");
    const answers = [
      ...Array.from({ length: 10 }, (_, i) => first.count(job(`a${i}`))),
      second.count(job("b0")),
      second.count(job("b1")),
    ];
    expect(await drain(answers.length)).toEqual([
      "a0", "a1", "a2", "a3", "a4", "b0", "b1", "a5", "a6", "a7", "a8", "a9",
    ]);
    for (const answer of answers) {
      expect(await answer).toEqual({ kind: "counts", counts: [1] });
    }
    await pool.close();
  });

  it("answers a backlogged job busy past the queue bound, never running it", async () => {
    const pool = newPatternPool(1, { queueWaitMs: 20 });
    const eval1 = patternsFor(pool, "pev_a");
    const answers = Array.from({ length: 6 }, (_, i) => eval1.count(job(`a${i}`)));
    for (const answer of answers.slice(1)) {
      expect(await answer).toEqual({ kind: "busy" });
    }
    expect(worker(0).posted.map((entry) => entry.pattern)).toEqual(["a0"]);
    await pool.close();
    await expect(answers[0]).rejects.toThrow("the pattern pool is closed");
  });

  it("rejects the backlog as the queue when the pool closes", async () => {
    const pool = newPatternPool(1);
    const eval1 = patternsFor(pool, "pev_a");
    const answers = Array.from({ length: 6 }, (_, i) => eval1.count(job(`a${i}`)));
    await pool.close();
    for (const answer of answers) {
      await expect(answer).rejects.toThrow("the pattern pool is closed");
    }
  });
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
