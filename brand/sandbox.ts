/**
 * The sandbox, up close: the homepage section that answers the three
 * questions a buyer of agent infrastructure asks about the computer each
 * conversation gets. What is on it, what can it reach, and what happens when
 * nobody is using it. Each answer is shown with the real thing: the docs'
 * own Environment file, the websites that file admits, the order a sandbox
 * sleeps and wakes in, and the public tests that check each.
 *
 * The site renders it (site/src/components/sections/Sandbox.tsx).
 * brand/__tests__/sandbox.test.ts holds the Environment file equal to the
 * docs page it comes from and the typed fields equal to that file;
 * brand/__tests__/proofs.test.ts holds every proof and link to what it
 * names; brand/__tests__/measurements.test.ts refuses a wake time written
 * here, since the one measured wake is printed by the hard parts' sandbox
 * row, which the sleep panel links to.
 *
 * What the section says holds where a sandbox driver does it: on Stigmer
 * Cloud, and on your own servers with the `substrate` driver (the runners
 * guide's driver table). The scope line says so under the heading.
 */
import type { Proof, SourceProof } from "./proof";

/** The section's eyebrow and heading. */
export const SANDBOX_HEADING = {
  eyebrow: "The sandbox",
  title: "A computer per conversation, and nothing it shouldn't reach.",
} as const;

/** Where the section holds, and the driver table that says it. */
export const SANDBOX_SCOPE: {
  readonly sentence: string;
  readonly link: SourceProof;
} = {
  sentence:
    "On Stigmer Cloud, and on your own servers with the Agent Substrate driver.",
  link: {
    kind: "source",
    label: "What each driver does",
    href: "/docs/guides/self-hosting/runners#environments-on-your-sandboxes",
  },
};

/** The docs page whose first YAML block is the Environment the section shows. */
export const SANDBOX_ENVIRONMENT_SOURCE = "docs/concepts/environments.mdx";

/**
 * The docs' worked Environment, a data team's: the file exactly as the docs
 * page writes it, and the parts the reach panel draws, typed, so the site
 * renders them without a YAML parser. make check-docs-yaml holds the file
 * to the API.
 */
export const SANDBOX_ENVIRONMENT: {
  readonly file: string;
  readonly slug: string;
  readonly allowedHosts: readonly string[];
  readonly allowPackageManagers: boolean;
} = {
  file: `apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: Data science
  slug: data-science
spec:
  description: "pandas and poppler, GitHub and our API only"
  networking:
    type: limited
    allowed_hosts: [api.github.com, our-api.example.com]
    allow_package_managers: true
  packages:
    apt: [poppler-utils]
    pip: [pandas, sqlalchemy==2.0.30]
`,
  slug: "data-science",
  allowedHosts: ["api.github.com", "our-api.example.com"],
  allowPackageManagers: true,
};

export const SANDBOX_PANEL_ORDER = ["inside", "reach", "sleep"] as const;

export type SandboxPanelId = (typeof SANDBOX_PANEL_ORDER)[number];

/** One of the three questions, answered. */
export interface SandboxPanel {
  /** The panel's short name, numbered on the page: "1 · Inside". */
  readonly label: string;
  /** The question, as the panel's heading. */
  readonly title: string;
  /** The answer, a sentence each. */
  readonly sentences: readonly string[];
  /** What shows it is true. */
  readonly proofs: readonly Proof[];
}

export const SANDBOX_PANELS: Readonly<Record<SandboxPanelId, SandboxPanel>> = {
  inside: {
    label: "Inside",
    title: "What's on it?",
    sentences: [
      "Each conversation gets a machine of its own: an isolated sandbox, gVisor on Stigmer Cloud, with Node, Python, Go and git ready.",
      "Its Environment adds what the agent needs, installed before the first turn.",
      "The agent works as its own user, without the administrator's rights.",
    ],
    proofs: [
      {
        kind: "tests",
        path: "backend/services/runner/src/shared/__tests__/agent-identity.test.ts",
        cases: [
          "drops with the measured flags: the agent's ids, no groups, no inheritable capabilities, no new privileges",
        ],
      },
      {
        kind: "source",
        label: "The sandbox's image",
        href: "backend/services/runner/Dockerfile.sandbox",
      },
    ],
  },
  reach: {
    label: "Reach",
    title: "What can it reach?",
    sentences: [
      "Only the websites its Environment lists, and the package registries and code hosts when it turns them on.",
      "Any other website is closed during the TLS handshake.",
    ],
    proofs: [
      {
        kind: "tests",
        path: "backend/services/stigmer-server/src/sandbox/substrate/__tests__/egress.test.ts",
        cases: [
          "limited: no wildcard; HTTPS to its hosts, the runner's own and the operator's, each once; a cleartext host also on port 80",
        ],
      },
      {
        kind: "tests",
        path: "backend/services/runner/src/agent-proxy/__tests__/server.test.ts",
        cases: [
          "forwards as that turn's execution, with the runner's token in place of the key",
        ],
      },
    ],
  },
  sleep: {
    label: "Sleep",
    title: "What happens when nobody's using it?",
    sentences: [
      "When nobody is writing to it, it sleeps, and its files stay. The next message wakes it where it left off.",
      "On Stigmer Cloud, waiting for a person or the next message is never an agent hour.",
    ],
    proofs: [
      {
        kind: "tests",
        path: "backend/services/stigmer-server/src/sandbox/substrate/__tests__/sweep.test.ts",
        cases: [
          "suspends an idle running sandbox, leaves a sleeping one and a busy one",
        ],
      },
      {
        kind: "source",
        label: "Waiting is never an agent hour",
        href: "/docs/concepts/billing#agent-hours",
      },
    ],
  },
};

/** The reach panel's list: each allowed host, the switch's line, and the refusal. */
export const SANDBOX_REACH = {
  packageManagers: "Package registries and code hosts",
  otherWebsites: "Any other website",
  refused: "closed during the TLS handshake",
  /** Set below the list: who holds the model key. */
  key: [
    "The agent never holds your model key.",
    "On Stigmer Cloud it never enters the sandbox: model calls leave through Stigmer's model proxy, which adds it.",
  ],
} as const;

/** The sleep panel's steps, in order, with no clock times: Stigmer Cloud's window is its own setting. */
export const SANDBOX_SLEEP = {
  steps: [
    "The agent sends its last reply.",
    "Nobody writes for a while, so it sleeps. Its files stay on its node, then in storage.",
    "The next message wakes it: a fresh runner, its files where it left them.",
  ],
  never: "Never while a run or an approval waits.",
  /** The hard parts' sandbox row, which prints the measured wake with its method. */
  wakeLink: {
    label: "How long a wake takes",
    href: "#hard-parts-own-computer",
  },
} as const;
