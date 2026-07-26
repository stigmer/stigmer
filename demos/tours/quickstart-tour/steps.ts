/**
 * Quickstart overview tour — the page-level "what you'll build" preview at
 * the top of the Quickstart: a freshly created API key in the console → a
 * few lines of SDK code → a good generic answer in the terminal → one
 * changed line asking a domain question → an unsatisfying answer. The last
 * beat is the page's motivation: the agent works out of the box but knows
 * nothing about *your* company yet, which is what the rest of the
 * Getting Started sequence fixes.
 *
 * The code and terminal beats live in the reader's quickstart project
 * (`_shared/quickstart-workspace.ts`) — the same workspace
 * `create-agent-tour` and `connect-tools-tour` continue on later pages.
 *
 * DD-004 note: beat 0 depicts the API Keys page exactly as it ships in the
 * reveal state — `ApiKeysSection` hides its "+ New API key" button while
 * the created-key alert is showing, so this tour renders no create button
 * (the inline demo it replaces got that wrong).
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — type-only `@scenar/react` imports,
 * `_shared` data, and literals. Component rendering lives in `index.tsx`.
 */
import type { ScenarioStep, TerminalLine } from "@scenar/react";
import { QUICKSTART_WORKSPACE } from "../_shared/quickstart-workspace";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type QuickstartTourStep =
  | { view: "api-key-created" }
  | { view: "code-connect" }
  | { view: "terminal-generic" }
  | { view: "code-domain-question" }
  | { view: "terminal-domain-fail" };

// ---------------------------------------------------------------------------
// Fixture data — the created API key (beat 0)
// ---------------------------------------------------------------------------

/** Name of the key the reader just created, shown in the reveal alert. */
export const CREATED_KEY_NAME = "quickstart-key";

/**
 * The one-time raw key value the reveal alert displays. Deliberately
 * fake-but-plausible: the docs prose tells the reader their key starts
 * with `sk_`, so the depicted key must too.
 */
export const CREATED_RAW_KEY = "sk_live_dEm0k3y_a1b2c3d4e5f6g7h8";

// ---------------------------------------------------------------------------
// Fixture data — code listings (beats 1 and 3)
// ---------------------------------------------------------------------------

/**
 * The reader's `ask-agent.ts` with a given headline comment and question.
 * Both code beats show this exact program — the tour's story is that *only
 * the question changes* between them, and building both listings from one
 * template keeps that true by construction.
 */
function askAgentListing(headline: string, question: string): string[] {
  return [
    `// ${QUICKSTART_WORKSPACE.entryFile} — ${headline}`,
    'import { Stigmer } from "@stigmer/sdk";',
    "",
    "const stigmer = new Stigmer({",
    "  apiKey: process.env.STIGMER_API_KEY!,",
    "});",
    "",
    "const session = await stigmer.session.create({",
    "  name: `session-${Date.now()}`,",
    '  org: "my-org",',
    "});",
    "",
    "const execution = await stigmer.agentExecution.create({",
    '  org: "my-org",',
    "  sessionId: session.metadata!.id,",
    `  message: "${question}",`,
    "});",
  ];
}

/** Beat 1: the whole connect-and-ask program, question and all. */
export const CONNECT_CODE = askAgentListing(
  "Connect and send a message",
  "Best practices for handling customer complaints?",
);

/** Beat 3: the same program with only the question changed. */
export const DOMAIN_CODE = askAgentListing(
  "Try a domain-specific question",
  "What is your return policy for defective items?",
);

/**
 * 0-based lines beat 1 highlights: the `session.create` and
 * `agentExecution.create` blocks — the two calls the narration walks
 * through (the import and client construction stay unhighlighted).
 */
export const CONNECT_HIGHLIGHT_LINES = [7, 8, 9, 10, 12, 13, 14, 15];

/** 0-based index of the question line — the single line beat 3 highlights. */
export const QUESTION_LINE = DOMAIN_CODE.findIndex((line) =>
  line.includes("message:"),
);

// ---------------------------------------------------------------------------
// Fixture data — terminal output (beats 2 and 4)
// ---------------------------------------------------------------------------

/** Beat 2: the agent handles a generic question well. */
export const GENERIC_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: `npx tsx ${QUICKSTART_WORKSPACE.entryFile}` },
  { type: "blank", text: "" },
  { type: "output", text: "Here are some best practices for handling" },
  { type: "output", text: "customer complaints:" },
  { type: "blank", text: "" },
  { type: "output", text: "1. Listen actively — let the customer explain" },
  { type: "output", text: "   their issue fully before responding." },
  { type: "output", text: "2. Respond promptly — acknowledge complaints" },
  { type: "output", text: "   within hours, not days." },
  { type: "output", text: "3. Apologize sincerely — show empathy even if" },
  { type: "output", text: "   the issue wasn't your fault." },
];

/** Beat 4: the domain question exposes the missing knowledge. */
export const DOMAIN_FAIL_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: `npx tsx ${QUICKSTART_WORKSPACE.entryFile}` },
  { type: "blank", text: "" },
  { type: "output", text: "I don't have specific information about your" },
  { type: "output", text: "company's return policy for defective items." },
  { type: "output", text: "Generally, many companies accept returns for" },
  { type: "output", text: "defective products within a certain timeframe." },
  { type: "blank", text: "" },
  { type: "output", text: "I'd recommend checking your company's return" },
  { type: "output", text: "policy documentation for accurate details." },
];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * No interactions anywhere: step 0 must be interaction-free (the packed
 * embed arms step-0 interactions at mount, under the poster), and no later
 * beat sets a cursor, so there is nothing to clear. The inline demo's
 * step-0 `copy-key` cursor pointed at a target that never existed.
 */
export const quickstartTourSteps: ScenarioStep<QuickstartTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "api-key-created" },
    narration:
      "You start by creating an API key in the Stigmer console. Copy it — you'll use it in your code.",
  },
  {
    delayMs: 3000,
    data: { view: "code-connect" },
    narration:
      "A few lines of code is all you need. Import the SDK, connect with your key, and send a message.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-generic" },
    narration:
      "The agent answers a general question well. Best practices for handling complaints — covered.",
  },
  {
    delayMs: 3500,
    data: { view: "code-domain-question" },
    narration:
      "Change one line — ask something only your company can answer.",
  },
  {
    delayMs: 3000,
    data: { view: "terminal-domain-fail" },
    narration:
      "But ask about your return policy, and it can only guess. It has no domain knowledge yet.",
  },
];
