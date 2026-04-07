/**
 * Quickstart overview tour — multi-surface preview of the entire
 * quickstart journey placed at the top of the page inside
 * "What you'll build."
 *
 * Five steps: API key → code → generic response → change message →
 * unsatisfying domain response. Shows the reader what they are about
 * to build before they start coding.
 */

import type { ScenarioStep } from "../../engine/ScenarioPlayer";
import type { TerminalLine } from "../../views/TerminalView";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export type QuickstartTourStep =
  | { view: "api-key-created" }
  | { view: "code-connect" }
  | { view: "terminal-generic" }
  | { view: "code-domain-question" }
  | { view: "terminal-domain-fail" };

// ---------------------------------------------------------------------------
// Fixture data — code snippets
// ---------------------------------------------------------------------------

export const CONNECT_CODE = [
  '// ask-agent.ts — Connect and send a message',
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "Best practices for handling customer complaints?",',
  "});",
];

export const DOMAIN_CODE = [
  '// ask-agent.ts — Try a domain-specific question',
  'import { Stigmer } from "@stigmer/sdk";',
  "",
  "const stigmer = new Stigmer({",
  "  apiKey: process.env.STIGMER_API_KEY!,",
  "});",
  "",
  "const session = await stigmer.session.create({",
  '  name: `session-${Date.now()}`,',
  '  org: "my-org",',
  "});",
  "",
  "const execution = await stigmer.agentExecution.create({",
  '  org: "my-org",',
  "  sessionId: session.metadata!.id,",
  '  message: "What is your return policy for defective items?",',
  "});",
];

// ---------------------------------------------------------------------------
// Fixture data — terminal output
// ---------------------------------------------------------------------------

export const GENERIC_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
  { type: "blank", text: "" },
  { type: "output", text: "Here are some best practices for handling" },
  { type: "output", text: "customer complaints:" },
  { type: "blank", text: "" },
  { type: "output", text: "1. Listen actively — let the customer explain" },
  { type: "output", text: "   their issue fully before responding." },
  { type: "output", text: "2. Respond promptly — acknowledge complaints" },
  { type: "output", text: "   within hours, not days." },
  { type: "output", text: "3. Apologize sincerely — show empathy even if" },
  { type: "output", text: '   the issue wasn\'t your fault.' },
];

export const DOMAIN_FAIL_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "npx tsx ask-agent.ts" },
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
// Step sequence
// ---------------------------------------------------------------------------

export const quickstartTourSteps: ScenarioStep<QuickstartTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "api-key-created" },
    caption: "Grab an API key from the console",
    narration:
      "You start by creating an API key in the Stigmer console. Copy it — you'll use it in your code.",
  },
  {
    delayMs: 3000,
    data: { view: "code-connect" },
    caption: "Connect and send a message",
    narration:
      "A few lines of code is all you need. Import the SDK, connect with your key, and send a message.",
  },
  {
    delayMs: 3500,
    data: { view: "terminal-generic" },
    caption: "Generic question — solid answer",
    narration:
      "The agent answers a general question well. Best practices for handling complaints — covered.",
  },
  {
    delayMs: 3500,
    data: { view: "code-domain-question" },
    caption: "Now ask about your business",
  },
  {
    delayMs: 3000,
    data: { view: "terminal-domain-fail" },
    caption: "Domain question — the agent can't help",
    narration:
      "But ask about your return policy, and it can only guess. It has no domain knowledge yet.",
  },
];
