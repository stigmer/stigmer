/**
 * Proves <AgentChat>'s state rules (../agent-chat-state.ts): an agent named
 * "org/slug" or by reference, and a refused string that says the shape;
 * the open and conversation changes; a new conversation dropping the last
 * one's activity; an ended turn seen only while the chat is on screen; and
 * the closed popup button's words in each state: the conversation's own
 * working line while a turn runs, "Needs your answer" while it waits on the
 * person, how the last turn ended until it is seen, else an invitation.
 * Drawn over the scenario catalogue's busy and approval turns at its clock.
 */
import { describe, it, expect } from "vitest";
import { SCENARIO_CLOCK, conversationOf, scenarios } from "../../test";
import {
  agentChatReducer,
  initialAgentChatState,
  launcherView,
  parseAgent,
  type AgentChatState,
} from "../agent-chat-state";
import type { ChatActivity } from "../chat-activity";
import { chatActivityOf } from "../chat-activity-of";

const NOW = Date.parse(SCENARIO_CLOCK);
const busy = (): ChatActivity => (chatActivityOf(conversationOf(scenarios.busy).activeTurn!, undefined, [], NOW));
const waiting = (): ChatActivity => (chatActivityOf(conversationOf(scenarios.approval).activeTurn!, undefined, [], NOW));
const ended = (phase = "completed", filesMade = 2, runId = "run_9"): ChatActivity => ({
  kind: "ended",
  runId,
  phase,
  filesMade,
});

function withActivity(activity: ChatActivity, state = initialAgentChatState(false, "ses_1")): AgentChatState {
  return agentChatReducer(state, { type: "activity", activity });
}

describe("parseAgent", () => {
  it("reads org/slug", () => {
    expect(parseAgent("acme/variance-reporter")).toEqual({ org: "acme", slug: "variance-reporter" });
  });

  it("passes a reference through as given", () => {
    const ref = { org: "acme", slug: "variance-reporter", version: "v2" };
    expect(parseAgent(ref)).toBe(ref);
  });

  it.each(["variance-reporter", "acme/", "/variance-reporter", "acme/variance/reporter", ""])(
    "refuses %j, saying the shape it takes",
    (agent) => {
      expect(() => parseAgent(agent)).toThrow(
        `AgentChat: agent "${agent}" is not "org/slug" (for example "acme/variance-reporter")`,
      );
    },
  );
});

describe("agentChatReducer", () => {
  it("starts with nothing reported and nothing seen", () => {
    expect(initialAgentChatState(true, "ses_1")).toEqual({
      open: true,
      sessionId: "ses_1",
      activity: { kind: "idle" },
      seenRunId: null,
    });
  });

  it("opens and closes, keeping the same state when nothing changes", () => {
    const closed = initialAgentChatState(false, null);
    const opened = agentChatReducer(closed, { type: "set-open", open: true });
    expect(opened.open).toBe(true);
    expect(agentChatReducer(opened, { type: "set-open", open: true })).toBe(opened);
    expect(agentChatReducer(opened, { type: "set-open", open: false }).open).toBe(false);
  });

  it("drops the last conversation's activity and seen turn when the conversation changes", () => {
    const seen = agentChatReducer(withActivity(ended()), { type: "seen" });
    const next = agentChatReducer(seen, { type: "set-session", sessionId: null });
    expect(next).toEqual({ open: false, sessionId: null, activity: { kind: "idle" }, seenRunId: null });
  });

  it("keeps the same state when the conversation is the same", () => {
    const state = withActivity(busy());
    expect(agentChatReducer(state, { type: "set-session", sessionId: "ses_1" })).toBe(state);
  });

  it("marks an ended turn seen", () => {
    expect(agentChatReducer(withActivity(ended()), { type: "seen" }).seenRunId).toBe("run_9");
  });

  it("marks nothing seen while a turn works or nothing has run", () => {
    const working = withActivity(busy());
    expect(agentChatReducer(working, { type: "seen" })).toBe(working);
    const idle = initialAgentChatState(false, null);
    expect(agentChatReducer(idle, { type: "seen" })).toBe(idle);
  });

  it("keeps the same state when the ended turn is already seen", () => {
    const seen = agentChatReducer(withActivity(ended()), { type: "seen" });
    expect(agentChatReducer(seen, { type: "seen" })).toBe(seen);
  });
});

describe("launcherView", () => {
  it("invites the person to ask before anything has run", () => {
    expect(launcherView(initialAgentChatState(false, null), "Billing agent", NOW)).toEqual({
      icon: "chat",
      label: "Ask Billing agent",
      detail: undefined,
      ariaLabel: "Open the chat with Billing agent",
      announcement: "",
    });
  });

  it("says what a working turn is doing and for how long, in the conversation's words, and announces nothing", () => {
    expect(launcherView(withActivity(busy()), "Billing agent", NOW)).toEqual({
      icon: "working",
      label: "Running a command",
      detail: "1 min 30 s",
      ariaLabel: "Open the chat. Billing agent: Running a command, 1 min 30 s",
      announcement: "",
    });
  });

  it("says the agent needs an answer, and announces it", () => {
    expect(launcherView(withActivity(waiting()), "Billing agent", NOW)).toEqual({
      icon: "waiting",
      label: "Needs your answer",
      detail: undefined,
      ariaLabel: "Open the chat. Billing agent needs your answer",
      announcement: "Billing agent needs your answer",
    });
  });

  it("says a finished turn is done and what it made, until it is seen", () => {
    const state = withActivity(ended());
    expect(launcherView(state, "Billing agent", NOW)).toEqual({
      icon: "done",
      label: "Done",
      detail: "2 files made",
      ariaLabel: "Open the chat. Billing agent: Done, 2 files made",
      announcement: "Billing agent: Done, 2 files made",
    });
    const seen = agentChatReducer(state, { type: "seen" });
    expect(launcherView(seen, "Billing agent", NOW).label).toBe("Ask Billing agent");
  });

  it("counts one file made in the singular", () => {
    expect(launcherView(withActivity(ended("completed", 1)), "Billing agent", NOW).detail).toBe("1 file made");
  });

  it("names no files when the turn made none", () => {
    const view = launcherView(withActivity(ended("completed", 0)), "Billing agent", NOW);
    expect(view.detail).toBeUndefined();
    expect(view.ariaLabel).toBe("Open the chat. Billing agent: Done");
  });

  it.each([
    ["failed", "Failed"],
    ["cancelled", "Stopped"],
  ])("says a %s turn %s, without the done mark", (phase, word) => {
    const view = launcherView(withActivity(ended(phase, 0)), "Billing agent", NOW);
    expect(view.icon).toBe("ended");
    expect(view.label).toBe(word);
  });

  it("announces a later turn's end even after an earlier one was seen", () => {
    const seen = agentChatReducer(withActivity(ended("completed", 2, "run_1")), { type: "seen" });
    const later = agentChatReducer(seen, { type: "activity", activity: ended("completed", 1, "run_2") });
    expect(launcherView(later, "Billing agent", NOW).label).toBe("Done");
  });
});
