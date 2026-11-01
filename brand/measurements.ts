/**
 * Stigmer's measured figures, each with the day, the environment and the
 * method that produced it. The site reads them from here; the docs keep each
 * figure as literal text, and brand/__tests__/measurements.test.ts holds the
 * two equal and refuses a figure the site writes on its own.
 *
 * SANDBOX_WAKE is how long a sleeping Session takes to be working again
 * after a new message, on Stigmer Cloud's preprod environment. `working` is
 * the wait a person sees: each run's own record, from the server accepting
 * the message to the runner starting the turn, the moment the console shows
 * the agent working. `resume` is the part of it the server spends waking
 * the sandbox: Agent Substrate's resume and the push that starts a fresh
 * runner, from the server's log. The rest is the runner booting.
 *
 * The three paths are judged per wake from the server's and Substrate's
 * logs, never from the schedule: `node` (woken on the node that still held
 * its files), `storage` (its files came back from the snapshot bucket,
 * because the node had let them go or the sandbox woke on another node) and
 * `new` (a conversation's first turn, which creates its sandbox). Figures
 * are seconds to two decimals, nearest-rank.
 *
 * Measure again, and replace every figure here and in the docs together, on
 * a new Agent Substrate minor, a change to how the runner boots, or a new
 * cluster.
 */
export interface Figures {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export interface WakePath {
  /** Wakes counted on this path. */
  readonly n: number;
  /** The wait a person sees, from the message's acceptance to the agent starting. */
  readonly working: Figures;
  /** The server's part of it: the sandbox's resume and the runner push. */
  readonly resume: Figures;
}

export const WAKE_PATHS = ["node", "storage", "new"] as const;

export type WakePathName = (typeof WAKE_PATHS)[number];

export const SANDBOX_WAKE: {
  readonly measuredOn: string;
  readonly environment: string;
  readonly setup: string;
  readonly method: string;
  readonly paths: Readonly<Record<WakePathName, WakePath>>;
} = {
  measuredOn: "2026-10-31",
  environment: "Stigmer Cloud, preprod",
  setup: "Agent Substrate v0.6.0 on GKE, snapshots in Cloud Storage",
  method:
    "36 conversations on a one-line agent, each woken 1 to 20 minutes after it fell asleep and again 35 minutes after its next sleep; each wake is filed by where its files came from, read from the server's and Agent Substrate's logs; the wait is each run's own record, from the message's acceptance to the agent starting; the resume is the server's log of its wake",
  paths: {
    node: { n: 33, working: { p50: 2.53, p95: 2.62, max: 2.67 }, resume: { p50: 0.17, p95: 0.26, max: 0.27 } },
    storage: { n: 30, working: { p50: 2.78, p95: 3.06, max: 3.31 }, resume: { p50: 0.42, p95: 0.58, max: 0.89 } },
    new: { n: 36, working: { p50: 2.6, p95: 2.7, max: 2.81 }, resume: { p50: 0.18, p95: 0.26, max: 0.34 } },
  },
};

/**
 * Where the runners guide states how SANDBOX_WAKE was measured: the page and
 * the heading the site's "How we measured" link opens.
 * brand/__tests__/proofs.test.ts holds the heading to the page.
 */
export const SANDBOX_WAKE_METHOD_HREF =
  "/docs/guides/self-hosting/runners#sessions-that-sleep-with-the-substrate-driver";

/** The one written form of a figure, so the docs, the tests and the site print the same text: "4.97 s". */
export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}
