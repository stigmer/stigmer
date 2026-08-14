/**
 * Take-over-conversations tour — the screenshot journey behind
 * `docs/guides/channels/take-over-conversations.mdx` (stigmer-cloud#276).
 *
 * Five beats over the real `ConversationsWorkbench`, one per section of the
 * guide, each a settled frame the page places as a `<Still>`. The beats are
 * pure fixture variants: every depicted state is its own conversation in
 * `fixtures.ts` (the RPC mock is a pure function of its input), so selecting
 * a row is selecting a beat — no synthetic events drive component state.
 *
 * No interactions by design: the workbench is a live-fetching organism and
 * the stills are the deliverable; narration alone carries the playback.
 */
import type { ScenarioStep } from "@scenar/react";
import { JORDAN, PAT, RILEY, SAM } from "./fixtures";

/**
 * One beat = the conversation the workbench opens (`null` is the inbox's
 * select-a-conversation state). `renderStep` passes it straight through as
 * the workbench's controlled selection.
 */
export interface TakeOverTourStep {
  readonly conversationKey: string | null;
}

export const steps: ScenarioStep<TakeOverTourStep>[] = [
  {
    // Establishing beat (interaction-free by rule): the Conversations area
    // as you find it — four customers, the wants-human badge at 2, a muted
    // dot on Pat (the agent has it) and a strong dot on Jordan (your team
    // has it). Doubles as the guide's inbox still.
    delayMs: 6000,
    data: { conversationKey: null },
    shot: "conversations-inbox",
    narration:
      "Conversations lists every customer conversation across your channels. " +
      "The sidebar badge counts the ones that want a human, and a dot marks " +
      "an unanswered customer — muted while the agent has it, strong when " +
      "your team holds the conversation.",
  },
  {
    delayMs: 6000,
    data: { conversationKey: PAT.conversationKey },
    shot: "conversation-timeline",
    narration:
      "Open a row and you read the conversation the way the customer " +
      "experiences it — their messages, the agent's delivered replies with " +
      "WhatsApp-style ticks, and your teammates' replies, in order.",
  },
  {
    delayMs: 6000,
    data: { conversationKey: JORDAN.conversationKey },
    shot: "taken-over",
    narration:
      "Press Take over and the agent goes quiet on this one conversation. " +
      "The banner shows your team has it, and Hand back returns it to the " +
      "agent — informed by a digest of what happened while it was quiet.",
  },
  {
    delayMs: 6000,
    data: { conversationKey: SAM.conversationKey },
    shot: "closed-window-advisory",
    narration:
      "WhatsApp closes free-form replies twenty-four hours after the " +
      "customer's last message. When the window is closed, the composer " +
      "warns you before you send — and approved templates, the lane " +
      "WhatsApp provides for reaching out, still deliver from the template " +
      "button beside Send.",
  },
  {
    delayMs: 6000,
    data: { conversationKey: RILEY.conversationKey },
    shot: "attention-banner",
    narration:
      "When the agent decides a person should look, it flags the " +
      "conversation: the banner carries its reason, and you either take " +
      "over or dismiss the flag while the agent keeps serving the customer.",
  },
];
