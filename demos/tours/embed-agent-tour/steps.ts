/**
 * Embed agent tour — the getting-started "Add agent chat to your app"
 * payoff: a fictional product page (not the Stigmer Console) with the
 * SDK's chat embedded, from first message to streamed reply, closing on
 * how little code the embed is.
 *
 * The depicted product is Acme and its agent is `acme/support-agent` — the
 * same depicted identities the Getting Started tours build (`_shared`
 * depicted-resource rule), so the reader who followed the sequence sees
 * the agent they created answering inside "their" app. The order it
 * discusses is #ORD-4821, the sequence's shared order fixture.
 */
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { samples } from "@stigmer/react/test";
import type { ScenarioStep } from "@scenar/react";
import { snapshot } from "../_shared/fixtures";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type EmbedAgentTourStep =
  | { view: "host-launcher" }
  | { view: "host-typing" }
  | { view: "host-reply"; execution: AgentExecution }
  | { view: "host-code" };

/** What the depicted customer types into the embedded composer. */
export const TYPING_MESSAGE =
  "I ordered the wrong size. Can I exchange order #ORD-4821?";

// ---------------------------------------------------------------------------
// Conversation fixture (the "host-reply" step)
// ---------------------------------------------------------------------------

const customerMessage = samples.humanMessage(TYPING_MESSAGE);

const agentReply = samples.aiMessage(
  "Yes — order **#ORD-4821** (Wireless Headphones) is eligible for an " +
    "exchange.\n\n" +
    "Here's how it works:\n\n" +
    "1. I'll email you a prepaid return label right away\n" +
    "2. Ship the original back within 14 days\n" +
    "3. The replacement size ships as soon as the carrier scans your " +
    "return\n\n" +
    "Which size would you like instead?",
);

export const replyExecution = snapshot(
  [customerMessage, agentReply],
  ExecutionPhase.EXECUTION_COMPLETED,
);

// ---------------------------------------------------------------------------
// Code fixture (the "host-code" step)
// ---------------------------------------------------------------------------

/**
 * The embed, condensed to the shape the docs page teaches: one client, one
 * provider, and the two-component hand-off. The listing is the story —
 * the closing beat exists to show how little code the previous beats were.
 */
export const EMBED_CODE = [
  "// src/App.tsx — the whole embed",
  'import { useMemo, useState } from "react";',
  'import { Stigmer } from "@stigmer/sdk";',
  "import {",
  "  NewSessionViewer,",
  "  SessionViewer,",
  "  StigmerProvider,",
  '} from "@stigmer/react";',
  'import "@stigmer/react/styles.css";',
  "",
  "function SupportChat() {",
  "  const [sessionId, setSessionId] = useState<string | null>(null);",
  "",
  "  if (sessionId) {",
  "    return (",
  '      <SessionViewer sessionId={sessionId} org="acme" audience="endUser" />',
  "    );",
  "  }",
  "  return (",
  "    <NewSessionViewer",
  '      org="acme"',
  '      audience="endUser"',
  '      initialAgentRef={{ org: "acme", slug: "support-agent" }}',
  "      onSessionCreated={setSessionId}",
  "    />",
  "  );",
  "}",
];

/** Lines of {@link EMBED_CODE} the editor beat highlights (1-based). */
export const EMBED_CODE_HIGHLIGHTS = [16, 20];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const embedAgentTourSteps: ScenarioStep<EmbedAgentTourStep>[] = [
  {
    // Establishing beat — cursor-less by the step-0 rule (demos/README.md).
    delayMs: 0,
    data: { view: "host-launcher" },
    narration:
      "This is a product page, not the Stigmer Console. The chat inside it " +
      "is embedded with Stigmer's React components.",
  },
  {
    delayMs: 3500,
    data: { view: "host-typing" },
    narration:
      "A customer asks for help. Sending the first message creates a " +
      "session pinned to the agent the product chose.",
    interactions: [
      { atPercent: 0.2, type: "set_cursor", target: "embed-chat" },
      { atPercent: 0.9, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 4000,
    data: { view: "host-reply", execution: replyExecution },
    narration:
      "The agent answers from the product's own knowledge and tools — the " +
      "same session surface the Stigmer Console ships, inside your app.",
    // Lean into the conversation while the narration reads it, pull back
    // before the beat ends — legibility comes from the camera, not scale.
    interactions: [
      {
        type: "viewport_transition",
        target: "embed-chat",
        viewportZoom: 1.4,
        atPercent: 0.25,
      },
      { type: "viewport_transition", viewportReset: true, atPercent: 0.8 },
    ],
  },
  {
    delayMs: 3500,
    data: { view: "host-code" },
    narration:
      "The entire embed is one provider and two components. Your app " +
      "decides the agent. The SDK does the rest.",
  },
];
