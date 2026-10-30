// <AgentChat>'s state as pure logic: which conversation shows, whether the
// panel or popup is open, whether the person has seen the last turn's end,
// and what the popup's closed button says. The component only wires these
// to React, so the rules are tested (and mutation-swept) without a render.
// It reads words the session view reports (`chat-activity-of.ts`), never a
// turn, so the chat's first download carries no turn derivation.

import { durationWords } from "../session/duration-words.js";
import { endingWord } from "../session/turn-endings.js";
import type { ChatActivity } from "./chat-activity.js";

/** An agent reference as {@link AgentChat} takes it. */
export interface AgentChatAgentRef {
  readonly org: string;
  readonly slug: string;
  readonly version?: string;
}

/**
 * Reads `"org/slug"` (or a reference) into a reference.
 *
 * @throws {Error} when the string is not `"org/slug"`
 */
export function parseAgent(agent: string | AgentChatAgentRef): AgentChatAgentRef {
  if (typeof agent !== "string") return agent;
  const parts = agent.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(`AgentChat: agent "${agent}" is not "org/slug" (for example "acme/variance-reporter")`);
  }
  return { org: parts[0]!, slug: parts[1]! };
}

/** The state the component keeps for what its host leaves uncontrolled. */
export interface AgentChatState {
  readonly open: boolean;
  readonly sessionId: string | null;
  readonly activity: ChatActivity;
  /** The run whose end the person has seen, so the closed button stops announcing it. */
  readonly seenRunId: string | null;
}

/** What changes the state. */
export type AgentChatAction =
  | { readonly type: "set-open"; readonly open: boolean }
  | { readonly type: "set-session"; readonly sessionId: string | null }
  | { readonly type: "activity"; readonly activity: ChatActivity }
  /** The conversation is on screen: whatever has ended is seen. */
  | { readonly type: "seen" };

const IDLE: ChatActivity = { kind: "idle" };

/** The state a chat starts in. */
export function initialAgentChatState(open: boolean, sessionId: string | null): AgentChatState {
  return { open, sessionId, activity: IDLE, seenRunId: null };
}

/** The reducer (module header). */
export function agentChatReducer(state: AgentChatState, action: AgentChatAction): AgentChatState {
  switch (action.type) {
    case "set-open":
      return state.open === action.open ? state : { ...state, open: action.open };
    case "set-session":
      // Another conversation (or a new one) reports its own activity; the
      // last one's must not linger on the button.
      return state.sessionId === action.sessionId
        ? state
        : { ...state, sessionId: action.sessionId, activity: IDLE, seenRunId: null };
    case "activity":
      return { ...state, activity: action.activity };
    case "seen":
      return state.activity.kind === "ended" && state.seenRunId !== state.activity.runId
        ? { ...state, seenRunId: state.activity.runId }
        : state;
  }
}

/** What the popup's closed button shows. */
export interface LauncherView {
  readonly icon: "chat" | "working" | "waiting" | "done" | "ended";
  /** The bold words. */
  readonly label: string;
  /** The quieter words after them, if any. */
  readonly detail: string | undefined;
  /** The button's accessible name, which says it opens the chat. */
  readonly ariaLabel: string;
  /**
   * What a screen reader is told when it changes: the moments the person
   * acts on (the agent needs them, the turn ended), never the ticking time.
   */
  readonly announcement: string;
}

/**
 * The closed button's words: the conversation's working line while a turn
 * runs, "Needs your answer" while it waits on the person, how the last turn
 * ended until the person has seen it, else an invitation to ask.
 */
export function launcherView(state: AgentChatState, agentName: string, nowMs: number): LauncherView {
  const { activity } = state;
  if (activity.kind === "working") {
    if (activity.waiting) {
      return {
        icon: "waiting",
        label: "Needs your answer",
        detail: undefined,
        ariaLabel: `Open the chat. ${agentName} needs your answer`,
        announcement: `${agentName} needs your answer`,
      };
    }
    const label = activity.phrase;
    const detail = durationWords(nowMs - activity.startedAtMs);
    return {
      icon: "working",
      label,
      detail,
      ariaLabel: `Open the chat. ${agentName}: ${label}, ${detail}`,
      announcement: "",
    };
  }
  if (activity.kind === "ended" && activity.runId !== state.seenRunId) {
    const label = endingWord(activity.phase);
    const detail =
      activity.filesMade === 0 ? undefined : `${activity.filesMade} ${activity.filesMade === 1 ? "file" : "files"} made`;
    const said = detail === undefined ? label : `${label}, ${detail}`;
    return {
      icon: activity.phase === "completed" ? "done" : "ended",
      label,
      detail,
      ariaLabel: `Open the chat. ${agentName}: ${said}`,
      announcement: `${agentName}: ${said}`,
    };
  }
  return {
    icon: "chat",
    label: `Ask ${agentName}`,
    detail: undefined,
    ariaLabel: `Open the chat with ${agentName}`,
    announcement: "",
  };
}
