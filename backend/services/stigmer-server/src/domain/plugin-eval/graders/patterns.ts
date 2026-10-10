/**
 * Where an eval's author-written regular expressions run: a small pool of
 * `worker_threads` workers, each pattern under a deadline, so a pattern
 * that backtracks catastrophically costs one worker and never the server's
 * event loop.
 *
 * The format's patterns are JavaScript regexes, lookarounds and
 * backreferences included, so a linear-time engine (RE2) would refuse
 * suites Claude Code runs. The price is that a pattern can run for ever;
 * the deadline is the wall. A job runs on an idle worker, a worker that
 * passes its deadline is terminated (the only way to stop a synchronous
 * regex) and replaced on the next job, and the grader that asked leaves
 * its try not graded, "pattern exceeded its time limit", never failed:
 * the run did nothing wrong.
 *
 * The pool is small (two workers by default) and reused: workers start on
 * the first job, stay for the next, and are unreferenced, so an idle pool
 * never holds the process open. The worker's body is a plain script
 * evaluated from a string, so it needs no file beside the compiled module
 * and runs the same from src/, dist/ and the slim bundle.
 *
 * One job counts the matches of one pattern in each of several texts, up
 * to a limit per text (1 answers "found", N+1 answers "exactly N"). The
 * global flag is added for counting; zero-length matches advance by one
 * code point, as `String.prototype.matchAll` does.
 *
 * Proven by __tests__/patterns.test.ts (a catastrophic pattern hits the
 * deadline and the pool recovers).
 */
import { Worker } from "node:worker_threads";

/** The time one grader's patterns may take, in milliseconds. */
export const PATTERN_DEADLINE_MS = 2_000;

/** Workers the default pool keeps. */
export const PATTERN_POOL_SIZE = 2;

/** One job: a pattern, its flags, the texts, and the most matches to count in each. */
export interface PatternJob {
  readonly pattern: string;
  readonly flags: string;
  readonly texts: ReadonlyArray<string>;
  readonly limit: number;
  /** How long the job may run once a worker takes it. */
  readonly budgetMs: number;
}

/** A job's answer: the counts, the pattern's refusal, or the deadline. */
export type PatternAnswer =
  | { readonly kind: "counts"; readonly counts: ReadonlyArray<number> }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "timeout" };

/** What the graders ask of a pattern engine. */
export interface PatternRunner {
  count(job: PatternJob): Promise<PatternAnswer>;
}

/** A pool that can be shut down. */
export interface PatternPool extends PatternRunner {
  close(): Promise<void>;
}

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", (job) => {
  let re;
  try {
    re = new RegExp(job.pattern, job.flags.includes("g") ? job.flags : job.flags + "g");
  } catch (error) {
    parentPort.postMessage({ id: job.id, kind: "invalid", message: String(error && error.message ? error.message : error) });
    return;
  }
  const unicode = re.unicode || re.unicodeSets;
  const counts = [];
  for (const text of job.texts) {
    re.lastIndex = 0;
    let n = 0;
    while (n < job.limit) {
      const match = re.exec(text);
      if (match === null) break;
      n++;
      if (match[0] === "") {
        const at = re.lastIndex;
        const code = text.codePointAt(at);
        re.lastIndex = at + (unicode && code !== undefined && code > 0xffff ? 2 : 1);
        if (re.lastIndex > text.length) break;
      }
    }
    counts.push(n);
  }
  parentPort.postMessage({ id: job.id, kind: "counts", counts });
});
`;

interface WorkerReply {
  readonly id: number;
  readonly kind: "counts" | "invalid";
  readonly counts?: number[];
  readonly message?: string;
}

interface Pending {
  readonly id: number;
  readonly job: PatternJob;
  readonly resolve: (answer: PatternAnswer) => void;
  readonly reject: (error: unknown) => void;
}

interface Slot {
  readonly worker: Worker;
  busy: Pending | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A pool of `size` workers (the module header). */
export function newPatternPool(size: number = PATTERN_POOL_SIZE): PatternPool {
  const slots: Slot[] = [];
  const queue: Pending[] = [];
  let nextId = 1;
  let closed = false;

  const retire = (slot: Slot): void => {
    const index = slots.indexOf(slot);
    if (index !== -1) {
      slots.splice(index, 1);
    }
    if (slot.timer !== undefined) {
      clearTimeout(slot.timer);
    }
    void slot.worker.terminate();
  };

  const spawn = (): Slot => {
    const worker = new Worker(WORKER_SOURCE, { eval: true });
    worker.unref();
    const slot: Slot = { worker, busy: undefined, timer: undefined };
    worker.on("message", (reply: WorkerReply) => {
      const pending = slot.busy;
      if (pending === undefined || pending.id !== reply.id) {
        return;
      }
      if (slot.timer !== undefined) {
        clearTimeout(slot.timer);
      }
      slot.timer = undefined;
      slot.busy = undefined;
      pending.resolve(
        reply.kind === "counts"
          ? { kind: "counts", counts: reply.counts ?? [] }
          : { kind: "invalid", message: reply.message ?? "" },
      );
      pump();
    });
    worker.on("error", (error) => {
      const pending = slot.busy;
      slot.busy = undefined;
      retire(slot);
      pending?.reject(error);
      pump();
    });
    slots.push(slot);
    return slot;
  };

  const pump = (): void => {
    while (!closed) {
      const pending = queue[0];
      if (pending === undefined) {
        return;
      }
      let slot = slots.find((candidate) => candidate.busy === undefined);
      if (slot === undefined) {
        if (slots.length >= size) {
          return;
        }
        slot = spawn();
      }
      queue.shift();
      const running = slot;
      running.busy = pending;
      running.timer = setTimeout(
        () => {
          running.busy = undefined;
          retire(running);
          pending.resolve({ kind: "timeout" });
          pump();
        },
        Math.max(1, pending.job.budgetMs),
      );
      running.worker.postMessage({
        id: pending.id,
        pattern: pending.job.pattern,
        flags: pending.job.flags,
        texts: pending.job.texts,
        limit: pending.job.limit,
      });
    }
  };

  return {
    count(job: PatternJob): Promise<PatternAnswer> {
      if (closed) {
        return Promise.reject(new Error("the pattern pool is closed"));
      }
      if (job.budgetMs <= 0) {
        return Promise.resolve({ kind: "timeout" });
      }
      return new Promise<PatternAnswer>((resolve, reject) => {
        queue.push({ id: nextId++, job, resolve, reject });
        pump();
      });
    },
    async close(): Promise<void> {
      closed = true;
      for (const pending of queue.splice(0)) {
        pending.reject(new Error("the pattern pool is closed"));
      }
      await Promise.all(
        slots.splice(0).map(async (slot) => {
          if (slot.timer !== undefined) {
            clearTimeout(slot.timer);
          }
          slot.busy?.reject(new Error("the pattern pool is closed"));
          await slot.worker.terminate();
        }),
      );
    },
  };
}
