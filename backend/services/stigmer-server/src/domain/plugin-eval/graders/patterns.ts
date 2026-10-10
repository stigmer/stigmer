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
 * The pool is small (min(4, the machine's parallelism) by default) and
 * reused: workers start on the first job, stay for the next, and are
 * unreferenced, so an idle pool never holds the process open. It is
 * shared by every eval on the worker, so a job's deadline starts only
 * when a worker takes it (another suite's slow patterns never spend it),
 * and its wait for a worker is bounded: a job queued past
 * PATTERN_QUEUE_WAIT_MS is answered "busy", which its grader reports as a
 * platform failure ("platform busy"), never a pattern timeout, so one
 * suite of slow patterns cannot hold another's grading past its time.
 * And the queue is fair between evals: each job names the eval it grades
 * for (`owner`, set by `patternsFor`), an eval holds at most
 * PATTERN_QUEUE_PER_OWNER jobs in the queue at once, and its later jobs
 * wait in its own backlog, each joining the queue's tail, behind every
 * other eval's queued jobs, as one of its own leaves the queue. So the
 * evals take turns (round-robin), and one eval's many slow patterns
 * cannot queue the others past their wait. The worker's body is a plain
 * script evaluated from a string, so it needs no file beside the compiled
 * module and runs the same from src/, dist/ and the slim bundle.
 *
 * One job counts the matches of one pattern in each of several texts, up
 * to a limit per text (1 answers "found", N+1 answers "exactly N"). The
 * global flag is added for counting; zero-length matches advance by one
 * code point, as `String.prototype.matchAll` does. A pattern that throws
 * while it runs (a backtracking pattern overflowing the regex stack on a
 * long text, a RangeError) is answered "failed" with the error's name,
 * never a rejected job, so only the check that asked is not graded,
 * "pattern failed: <name>", and the try's other checks still grade.
 *
 * Proven by __tests__/patterns.test.ts (a catastrophic pattern hits the
 * deadline and the pool recovers, a pattern overflowing the regex stack
 * answers failed) and __tests__/pattern-pool-faults.test.ts
 * (the queue bound, the turns between evals, a misbehaving worker).
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

/** The time one pattern may run once a worker takes it, in milliseconds. */
export const PATTERN_DEADLINE_MS = 2_000;

/** Workers the default pool keeps. */
export const PATTERN_POOL_SIZE = Math.min(4, availableParallelism());

/** The longest a job waits for a worker before it is answered busy, in milliseconds. */
export const PATTERN_QUEUE_WAIT_MS = 60_000;

/** The most jobs one eval holds in the pool's queue at once; its later jobs wait their turn. */
export const PATTERN_QUEUE_PER_OWNER = 4;

/** One job: a pattern, its flags, the texts, and the most matches to count in each. */
export interface PatternJob {
  readonly pattern: string;
  readonly flags: string;
  readonly texts: ReadonlyArray<string>;
  readonly limit: number;
  /** How long the job may run once a worker takes it. */
  readonly budgetMs: number;
  /** The eval the job grades for, the queue's fairness key; jobs without one share a turn. */
  readonly owner?: string;
}

/**
 * A job's answer: the counts, the pattern's refusal, a throw while it ran
 * (named by the error's name), the deadline, or no worker free in time.
 */
export type PatternAnswer =
  | { readonly kind: "counts"; readonly counts: ReadonlyArray<number> }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "failed"; readonly name: string }
  | { readonly kind: "timeout" }
  | { readonly kind: "busy" };

/** What the graders ask of a pattern engine. */
export interface PatternRunner {
  count(job: PatternJob): Promise<PatternAnswer>;
}

/** `runner` with every job it is asked marked as `owner`'s, so the pool gives that eval its turns. */
export function patternsFor(runner: PatternRunner, owner: string): PatternRunner {
  return { count: (job) => runner.count({ ...job, owner }) };
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
  try {
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
  } catch (error) {
    parentPort.postMessage({ id: job.id, kind: "failed", name: String(error && error.name ? error.name : "Error") });
    return;
  }
  parentPort.postMessage({ id: job.id, kind: "counts", counts });
});
`;

interface WorkerReply {
  readonly id: number;
  readonly kind: "counts" | "invalid" | "failed";
  readonly counts?: number[];
  readonly message?: string;
  readonly name?: string;
}

function answerOf(reply: WorkerReply): PatternAnswer {
  switch (reply.kind) {
    case "counts":
      return { kind: "counts", counts: reply.counts ?? [] };
    case "invalid":
      return { kind: "invalid", message: reply.message ?? "" };
    case "failed":
      return { kind: "failed", name: reply.name ?? "Error" };
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = reply.kind;
      return exhausted;
    }
  }
}

interface Pending {
  readonly id: number;
  readonly job: PatternJob;
  readonly resolve: (answer: PatternAnswer) => void;
  readonly reject: (error: unknown) => void;
  /** The queue bound's timer, cleared when a worker takes the job. */
  waiting: ReturnType<typeof setTimeout> | undefined;
}

export interface PatternPoolOptions {
  /** Defaults to PATTERN_QUEUE_WAIT_MS; tests shorten it. */
  readonly queueWaitMs?: number;
}

interface Slot {
  readonly worker: Worker;
  busy: Pending | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A pool of `size` workers (the module header). */
export function newPatternPool(
  size: number = PATTERN_POOL_SIZE,
  options: PatternPoolOptions = {},
): PatternPool {
  const queueWaitMs = options.queueWaitMs ?? PATTERN_QUEUE_WAIT_MS;
  const slots: Slot[] = [];
  /** The jobs waiting for a worker, at most PATTERN_QUEUE_PER_OWNER of each owner. */
  const queue: Pending[] = [];
  /** Each owner's jobs past its share of the queue, in order. */
  const backlogs = new Map<string, Pending[]>();
  let nextId = 1;
  let closed = false;

  const ownerOf = (pending: Pending): string => pending.job.owner ?? "";

  /** Queues `pending` when its owner holds less than its share, else backlogs it. */
  const enqueue = (pending: Pending): void => {
    const owner = ownerOf(pending);
    const held = queue.filter((queued) => ownerOf(queued) === owner).length;
    if (held < PATTERN_QUEUE_PER_OWNER) {
      queue.push(pending);
      return;
    }
    const backlog = backlogs.get(owner) ?? [];
    backlog.push(pending);
    backlogs.set(owner, backlog);
  };

  /** One of `owner`'s jobs left the queue: its next backlogged job joins the queue's tail. */
  const admitNext = (owner: string): void => {
    const backlog = backlogs.get(owner);
    const next = backlog?.shift();
    if (backlog?.length === 0) {
      backlogs.delete(owner);
    }
    if (next !== undefined) {
      queue.push(next);
    }
  };


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
      pending.resolve(answerOf(reply));
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
      admitNext(ownerOf(pending));
      clearTimeout(pending.waiting);
      pending.waiting = undefined;
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
        const pending: Pending = {
          id: nextId++,
          job,
          resolve,
          reject,
          waiting: undefined,
        };
        enqueue(pending);
        pump();
        if (slots.every((slot) => slot.busy !== pending)) {
          // The wait runs from the ask. A backlogged job's owner's earlier
          // jobs began theirs sooner, so each has left the queue (taken, or
          // answered busy) and admitted the next before this one's ends:
          // the job is in the queue by then, unless a worker took it.
          pending.waiting = setTimeout(() => {
            const index = queue.indexOf(pending);
            if (index !== -1) {
              queue.splice(index, 1);
              admitNext(ownerOf(pending));
              resolve({ kind: "busy" });
            }
          }, queueWaitMs);
          pending.waiting.unref();
        }
      });
    },
    async close(): Promise<void> {
      closed = true;
      const waiting = [...queue.splice(0), ...[...backlogs.values()].flat()];
      backlogs.clear();
      for (const pending of waiting) {
        clearTimeout(pending.waiting);
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
