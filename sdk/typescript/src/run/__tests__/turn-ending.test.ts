// Proves how an ended turn reads (../turn-ending.ts): every stop kind the
// runner names has its own words, tone and act; a turn with no kind reads
// its cause's generic sentence, and the raw error is never the headline;
// the provider and the model read as the names the caller resolved, or as
// "the model provider" and "this model"; the comfort counts what the turn's
// own to-do list finished; a viewer who can't fix the cause gets the
// reader's comfort and no link, and one who can't act gets no act; a
// person's own stop reads "Stopped by you"; a turn no sandbox had room for
// reads as one that didn't start, not as a lost runner; and a turn still working, one
// that finished on its own, and an ending its own surface tells read
// nothing.

import { describe, it, expect } from "vitest";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse, Turn, TurnStatus } from "@stigmer/session-log";
import { describeTurnEnding, type TurnEndingViewer } from "../turn-ending";

const ADMIN: TurnEndingViewer = { canManageProviders: true, canOpenAgent: true, canAct: true, stoppedIt: true };
const MEMBER: TurnEndingViewer = { canManageProviders: false, canOpenAgent: true, canAct: true, stoppedIt: false };
const READER: TurnEndingViewer = { canManageProviders: false, canOpenAgent: false, canAct: false, stoppedIt: false };
const NAMES = { provider: "Anthropic", model: "Claude Sonnet 4.6" };

function todoCall(statuses: readonly string[]): ToolUse {
  const input: JsonObject = { todos: statuses.map((status, index) => ({ content: `Item ${index + 1}`, status })) };
  return {
    kind: "tool_use",
    id: "run_1.tc-todos",
    runId: "run_1",
    threadId: "",
    name: "write_todos",
    mcpServerName: "",
    input,
    evaluatedPermission: "",
    state: "completed",
    ask: undefined,
    confirmation: undefined,
    grant: undefined,
    result: { id: "run_1.tc-todos.r", text: "ok", isError: false, processedAt: "2026-07-20T11:00:01.000Z" },
    fullOutput: undefined,
    liveOutput: "",
    background: undefined,
    stoppedBackground: undefined,
    thread: undefined,
    processedAt: "2026-07-20T11:00:00.000Z",
  };
}

function turnOf(status: Partial<TurnStatus> & Pick<TurnStatus, "phase">, items: readonly ToolUse[] = [], ended = true): Turn {
  return {
    runId: "run_1",
    userMessage: undefined,
    items,
    status: { stopCause: "", error: "", processedAt: "", ...status },
    ended,
    asks: [],
    todos: [],
    structuredOutput: undefined,
    memory: undefined,
    fileReview: [],
    errors: [],
    answer: "",
    liveness: undefined,
  };
}

const failed = (stopCause: string, kind?: string, extra: { model?: string; app?: string } = {}) =>
  turnOf({ phase: "failed", stopCause, error: "[RAW] provider prose", ...(kind === undefined ? {} : { stopDetail: { kind, model: extra.model ?? "", app: extra.app ?? "" } }) });

describe("describeTurnEnding", () => {
  it("names the provider and the model the caller resolved, and offers the admin the fix", () => {
    const ending = describeTurnEnding({ turn: failed("model_error", "provider_key_rejected", { model: "claude-sonnet-4-6" }), viewer: ADMIN, names: NAMES });
    expect(ending).toEqual({
      tone: "failed",
      pill: "Didn't finish",
      headline: "Anthropic refused this organization's model key.",
      comfort:
        "The key on Models & providers isn't valid any more. Replace it, then Run again: the turn picks up where it stopped, and your message isn't sent twice. Nothing was lost.",
      stepNote: "Stopped here",
      act: "run_again",
      link: "models_hub",
      kind: "provider_key_rejected",
    });
  });

  it("tells a member who can't replace the key who can, with no link", () => {
    const ending = describeTurnEnding({ turn: failed("model_error", "provider_key_rejected"), viewer: MEMBER, names: NAMES })!;
    expect(ending.comfort).toContain("Ask an admin of this organization to replace it.");
    expect([ending.act, ending.link]).toEqual(["run_again", "none"]);
  });

  it("offers a reader no act and no link", () => {
    const ending = describeTurnEnding({ turn: failed("failed", "app_unreachable", { app: "issue-tracker" }), viewer: READER })!;
    expect(ending.headline).toBe("The issue-tracker app wouldn't connect.");
    expect([ending.act, ending.link]).toEqual(["none", "none"]);
    expect(ending.comfort).not.toContain("agent's page");
  });

  it("leads an agent's setup failure with the runner's own sentence, for one who can fix the agent", () => {
    const turn = turnOf({ phase: "failed", stopCause: "failed", error: "Fixer's tools list names no tool this turn has: [x].", stopDetail: { kind: "agent_setup", model: "", app: "" } });
    expect(describeTurnEnding({ turn, viewer: ADMIN })!.comfort).toBe("Fixer's tools list names no tool this turn has: [x]. Change the agent, then Run again. Nothing was lost.");
    expect(describeTurnEnding({ turn, viewer: READER })!.comfort).not.toContain("tools list");
  });

  it("reads an unknown provider and model as the model provider and this model", () => {
    expect(describeTurnEnding({ turn: failed("model_error", "provider_overloaded"), viewer: ADMIN })!.headline).toBe("The model provider was too busy to answer.");
    expect(describeTurnEnding({ turn: failed("model_error", "model_unavailable"), viewer: ADMIN })!.headline).toBe("This key can't use this model.");
  });

  it("gives every kind its act: choose another model, nothing for a refused request, resume for a cut-off turn", () => {
    const actOf = (cause: string, kind: string) => describeTurnEnding({ turn: failed(cause, kind), viewer: ADMIN })!.act;
    expect(actOf("model_error", "model_unavailable")).toBe("choose_model");
    expect(actOf("model_error", "request_rejected")).toBe("none");
    expect(actOf("timeout", "stalled")).toBe("resume");
    expect(actOf("timeout", "workspace_busy")).toBe("resume");
    expect(actOf("infrastructure", "runner_lost")).toBe("resume");
    expect(actOf("failed", "internal")).toBe("run_again");
  });

  it("reads a turn no sandbox had room for as one that didn't start, never as a lost runner", () => {
    const turn = failed("infrastructure", "no_sandbox_room");
    expect(describeTurnEnding({ turn, viewer: MEMBER })).toEqual({
      tone: "failed",
      pill: "Didn't start",
      headline: "Every sandbox was busy, so this turn didn't start.",
      comfort: "Nothing was lost: your message is still here. Run again waits for room again.",
      stepNote: "Didn't start",
      act: "run_again",
      link: "none",
      kind: "no_sandbox_room",
    });
    expect(describeTurnEnding({ turn, viewer: READER })).toMatchObject({ comfort: "Nothing was lost: your message is still here.", act: "none" });
  });

  it("reads a budget stop amber, counts what the to-do list finished, and continues", () => {
    const turn = turnOf({ phase: "terminated", stopCause: "budget_reached", stopDetail: { kind: "cost_cap", model: "", app: "" } }, [
      todoCall(["completed", "completed", "in_progress", "pending", "pending"]),
    ]);
    const ending = describeTurnEnding({ turn, viewer: ADMIN })!;
    expect([ending.tone, ending.pill, ending.act, ending.link, ending.stepNote]).toEqual(["paused", "Paused at its spending cap", "continue", "agent", "Paused here"]);
    expect(ending.comfort).toMatch(/^What it finished is kept: 2 of 5 to-dos are done\. Continue sends "Continue"/);
    const noList = describeTurnEnding({ turn: turnOf({ phase: "terminated", stopCause: "budget_reached", stopDetail: { kind: "tool_call_limit", model: "", app: "" } }), viewer: READER })!;
    expect(noList.comfort).toContain("What it finished is kept.");
  });

  it("reads a turn the runner named no kind for by its cause, never by its error", () => {
    const model = describeTurnEnding({ turn: failed("model_error"), viewer: ADMIN })!;
    expect(model.headline).toBe("The model provider didn't finish this turn.");
    expect(model.kind).toBe("model_error");
    const plain = describeTurnEnding({ turn: failed(""), viewer: ADMIN })!;
    expect(plain.headline).toBe("This turn didn't finish.");
    for (const ending of [model, plain]) expect(`${ending.headline} ${ending.comfort}`).not.toContain("RAW");
    expect(describeTurnEnding({ turn: failed("budget_reached"), viewer: ADMIN })!.pill).toBe("Paused at a limit");
    expect(describeTurnEnding({ turn: failed("infrastructure"), viewer: ADMIN })!.pill).toBe("Interrupted");
  });

  it("reads a person's stop grey, as theirs to the one who stopped it", () => {
    const turn = turnOf({ phase: "cancelled", stopCause: "user" });
    expect(describeTurnEnding({ turn, viewer: ADMIN })).toMatchObject({ tone: "stopped", pill: "Stopped by you", headline: "You stopped this turn.", act: "continue" });
    expect(describeTurnEnding({ turn, viewer: MEMBER })).toMatchObject({ pill: "Stopped", headline: "This turn was stopped." });
    expect(describeTurnEnding({ turn: turnOf({ phase: "terminated" }), viewer: MEMBER })!.pill).toBe("Stopped");
  });

  it("reads the platform's stop as Stigmer's, and runs the message again", () => {
    expect(describeTurnEnding({ turn: turnOf({ phase: "completed", stopCause: "platform_stop" }), viewer: ADMIN })).toMatchObject({
      tone: "stopped",
      pill: "Stopped by Stigmer",
      headline: "Stigmer stopped this turn.",
      act: "rerun",
    });
  });

  it("reads nothing for a working turn, a finished one, or an ending its own surface tells", () => {
    expect(describeTurnEnding({ turn: turnOf({ phase: "running" }, [], false), viewer: ADMIN })).toBeUndefined();
    expect(describeTurnEnding({ turn: turnOf({ phase: "completed" }), viewer: ADMIN })).toBeUndefined();
    expect(describeTurnEnding({ turn: turnOf({ phase: "terminated", stopCause: "eval_stopped" }), viewer: ADMIN })).toBeUndefined();
    expect(describeTurnEnding({ turn: turnOf({ phase: "completed", stopCause: "review_resolved" }), viewer: ADMIN })).toBeUndefined();
    expect(describeTurnEnding({ turn: { ...turnOf({ phase: "failed" }), status: undefined }, viewer: ADMIN })).toBeUndefined();
  });

  it("has words for every kind on the wire", () => {
    const kinds = [
      "provider_key_rejected", "provider_key_missing", "provider_out_of_credit", "provider_rate_limited", "provider_overloaded",
      "model_unavailable", "provider_unreachable", "request_rejected", "cost_cap", "tool_call_limit", "stalled", "operation_limit",
      "workspace_busy", "agent_setup", "app_unreachable", "app_needs_sign_in", "internal", "runner_lost", "no_sandbox_room",
    ];
    for (const kind of kinds) {
      const ending = describeTurnEnding({ turn: failed("x", kind, { app: "crm" }), viewer: ADMIN, names: NAMES })!;
      expect(ending.kind, kind).toBe(kind);
      expect(ending.headline, kind).not.toMatch(/\{|\}/);
      expect(ending.comfort, kind).not.toMatch(/\{|\}/);
    }
  });
});
