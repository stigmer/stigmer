/**
 * What each customer's agent gets: the five titles every surface uses, the
 * visitor's worry each one answers with its proof, and three more things we
 * built, each with its own.
 *
 * The homepage's "hard parts" section renders the claims in AGENT_GET_ORDER
 * (site/src/components/sections/HardParts.tsx); the hero's picture labels its
 * parts with the titles, looked up by id; the marketing films read the titles
 * here. The video and the demo that tell the same five read the claims here
 * too, so a wording changed once changes everywhere.
 * brand/__tests__/proofs.test.ts holds every proof to what it names.
 */
import type { Proof } from "./proof";

export const AGENT_GET_TITLES = {
  "own-computer": "Its own computer",
  hours: "It works for hours",
  "asks-first": "It asks first",
  walls: "Walls between customers",
  keys: "Your keys, your servers",
} as const;

/** The order every list of the five says them in: the vocabulary's (docs/vocabulary.md). */
export const AGENT_GET_ORDER = [
  "own-computer",
  "hours",
  "asks-first",
  "walls",
  "keys",
] as const;

export type AgentGetId = (typeof AGENT_GET_ORDER)[number];

/** One of the five, said as the visitor's worry. */
export interface AgentGetClaim {
  /** The question the visitor already has. */
  readonly worry: string;
  /** What a team would build for itself to answer it. */
  readonly build: string;
  /** What Stigmer gives each customer's agent instead. */
  readonly gives: string;
  /** What shows it is true, first the one a visitor sees first. */
  readonly proofs: readonly Proof[];
}

const RUN_APPROVAL =
  "test/conformance/src/suites-execution/run-approval.conformance.test.ts";

export const AGENT_GET_CLAIMS: Readonly<Record<AgentGetId, AgentGetClaim>> = {
  "own-computer": {
    worry: "Can the agent's code touch your servers?",
    build: "A sandbox you run yourself",
    gives: "Each customer's agent gets its own computer",
    proofs: [{ kind: "measurement", figure: "sandbox-wake" }],
  },
  hours: {
    worry: "What if the server restarts mid-job?",
    build: "Queues, retries and timeouts you wrote",
    gives: "It works for hours and survives restarts",
    proofs: [
      {
        kind: "tests",
        path: "test/conformance/src/suites-execution/run-long-turn.conformance.test.ts",
        cases: [
          "a server rolled out mid-turn costs a watcher no event: each sees the whole log once, in order, the turn's end included",
          "a runner killed mid-tool is replaced, the turn completes, and the model is handed the task once",
        ],
      },
    ],
  },
  "asks-first": {
    worry: "Will it act before anyone says yes?",
    build: "Hand-rolled approval flags",
    gives: "It asks before acting on what you mark",
    proofs: [
      {
        kind: "screen",
        name: "asks-first",
        alt: "Northwind Books' ledger agent stops before it posts an adjustment and shows the account, the amount and the reason, waiting for the customer's yes.",
      },
      {
        kind: "tests",
        path: RUN_APPROVAL,
        cases: [
          "the shell call waits before it runs; an allow runs it once, on a resumed engine in a new activity, and the turn completes",
        ],
      },
    ],
  },
  walls: {
    worry: "Can one customer's agent see another's files?",
    build: "Tenant checks in your own code",
    gives: "Agents, files and keys stay apart",
    proofs: [
      {
        kind: "tests",
        path: "test/conformance/src/suites/list-read-scoping.conformance.test.ts",
        cases: [
          "search: the owner's resource never surfaces for the outsider, even naming the owner's org",
        ],
      },
    ],
  },
  keys: {
    worry: "Who holds your model keys and data?",
    build: "A hosted vendor that keeps both",
    gives: "Your model keys, on your servers or ours",
    proofs: [
      { kind: "source", label: "The Apache 2.0 license", href: "LICENSE" },
      {
        kind: "source",
        label: "Run it on your own servers",
        href: "/docs/guides/self-hosting/overview",
      },
    ],
  },
};

/** One more thing we built, shown after the five. */
export interface AlsoBuilt {
  readonly id: string;
  readonly title: string;
  readonly sentence: string;
  readonly proofs: readonly Proof[];
}

export const ALSO_BUILT: readonly AlsoBuilt[] = [
  {
    id: "one-api",
    title: "One API, every client",
    sentence:
      "The console, the CLI and every SDK call the same API; the suite that checks it runs unchanged against the open-source, Enterprise and Cloud servers.",
    proofs: [
      {
        kind: "source",
        label: "The conformance suite",
        href: "test/conformance/README.md",
      },
    ],
  },
  {
    id: "anthropic-sdk",
    title: "Anthropic's SDK reads your sessions",
    sentence:
      "Point Anthropic's SDK at Stigmer with a Stigmer key: it lists, streams and sends a session's events.",
    proofs: [
      {
        kind: "tests",
        path: "test/conformance/src/suites-execution/session-events-managed-agents.conformance.test.ts",
        cases: [
          "a message sent the moment the stream opens starts a turn; the stream yields its events in log order to end_turn",
        ],
      },
      {
        kind: "source",
        label: "Compare with Managed Agents",
        href: "/compare/claude-managed-agents",
      },
    ],
  },
  {
    id: "two-engines",
    title: "Two agent engines",
    sentence:
      "Stigmer's own engine or the Claude Agent SDK, per conversation; approvals work on both.",
    proofs: [
      {
        kind: "tests",
        path: RUN_APPROVAL,
        cases: [
          "a deny: the call never runs, its result is an error, and the turn completes",
        ],
      },
    ],
  },
];
