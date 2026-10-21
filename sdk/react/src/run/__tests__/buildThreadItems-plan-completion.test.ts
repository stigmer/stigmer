/**
 * buildThreadItems and Plan-mode turns: a completed Plan turn closes its
 * segment with a plan card (only the newest plan holds the build action; a
 * superseded plan without a plan File is skipped), collapses its plan
 * message behind the card when the turn returned its plan File (lifting the
 * plan's H1 as the card's title) or promotes it to an inline plan document
 * when it was not; the live Plan turn's plan being written collapses behind
 * a plan-writing card that shares the completion card's key; a
 * Build-from-plan turn shows no prompt and offers no inline Retry; and the
 * pending bubble yields to the turn it became, but never to an older one
 * when its send failed.
 */
import { describe, it, expect } from "vitest";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { TurnPhase } from "@stigmer/client";
import { buildThreadItems, type BuildThreadItemsOptions, type ThreadItem } from "../MessageThread";
import { runOf, said, status, turnsOf, user } from "./__fixtures__/thread-events";

interface TurnFixture {
  readonly id: string;
  readonly phase?: TurnPhase;
  readonly mode?: InteractionMode;
  readonly messages?: readonly string[];
  readonly withPlanFile?: boolean;
  readonly specMessage?: string;
  readonly buildFromPlan?: boolean;
  readonly error?: string;
}

function turnEvents(t: TurnFixture): SessionEvent[] {
  const events = [user(t.id, t.specMessage ?? "test message"), status(t.id, "running")];
  (t.messages ?? []).forEach((text, index) => events.push(said(t.id, index, text)));
  const phase = t.phase ?? "completed";
  if (phase !== "running") events.push(status(t.id, phase, { error: t.error ?? "" }));
  return events;
}

function runFor(t: TurnFixture): Run {
  return runOf(t.id, {
    spec: {
      message: t.specMessage ?? "test message",
      interactionMode: t.mode ?? InteractionMode.UNSPECIFIED,
      buildFromPlan: t.buildFromPlan ?? false,
    },
    status: { error: t.error ?? "" },
  });
}

/** The plan File a fixture's turn returned, when it returned one. */
function planFiles(fixtures: readonly TurnFixture[]): ReadonlyMap<string, StigmerFile> {
  const byRun = new Map<string, StigmerFile>();
  for (const t of fixtures) {
    if (!t.withPlanFile) continue;
    byRun.set(
      t.id,
      create(FileSchema, {
        metadata: { id: `file_${t.id}` },
        spec: { filename: "plan.md" },
        status: { runId: t.id, outputPath: "plan.md" },
      }),
    );
  }
  return byRun;
}

function build(fixtures: readonly TurnFixture[], options: BuildThreadItemsOptions = {}): ThreadItem[] {
  return buildThreadItems(turnsOf(...fixtures.map(turnEvents)), fixtures.map(runFor), {
    planFiles: planFiles(fixtures),
    ...options,
  });
}

const PLAN = InteractionMode.PLAN;
const AGENT = InteractionMode.AGENT;

function planItems(items: readonly ThreadItem[]) {
  return items.filter((i): i is Extract<ThreadItem, { kind: "plan-completion" }> => i.kind === "plan-completion");
}

function messageItems(items: readonly ThreadItem[]) {
  return items.filter((i): i is Extract<ThreadItem, { kind: "message" }> => i.kind === "message");
}

const m = (id: string, index: number) => `${id}.root.m${index}`;

describe("buildThreadItems plan-completion variant", () => {
  it("emits plan-completion for a completed Plan-mode turn", () => {
    const cards = planItems(build([{ id: "p", mode: PLAN, messages: ["Here is the plan"] }]));

    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe("p-plan-completion");
    expect(cards[0]!.executionId).toBe("p");
    expect(cards[0]!.isLatestPlan).toBe(true);
  });

  it("emits none for an Agent-mode turn, a turn with no mode, or a run the list does not hold", () => {
    expect(planItems(build([{ id: "a", mode: AGENT, messages: ["Done"] }]))).toHaveLength(0);
    expect(planItems(build([{ id: "d", messages: ["Done"] }]))).toHaveLength(0);
    expect(planItems(buildThreadItems(turnsOf(turnEvents({ id: "x", messages: ["Plan"] })), []))).toHaveLength(0);
  });

  it("emits none for a failed, terminated or live Plan turn", () => {
    expect(planItems(build([{ id: "f", phase: "failed", mode: PLAN, messages: ["Error"] }]))).toHaveLength(0);
    expect(planItems(build([{ id: "t", phase: "terminated", mode: PLAN }]))).toHaveLength(0);
    expect(planItems(build([{ id: "l", phase: "running", mode: PLAN, messages: ["Analyzing..."] }]))).toHaveLength(0);
  });

  it("keeps the plan card, with build authority, in the plan's own segment after a later Agent turn", () => {
    const items = build([
      { id: "plan", mode: PLAN, messages: ["Here is the plan"], withPlanFile: true },
      { id: "impl", mode: AGENT, messages: ["Implemented"] },
    ]);
    const cards = planItems(items);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.isLatestPlan).toBe(true);
    expect(items.indexOf(cards[0]!)).toBeLessThan(items.findIndex((i) => i.key === "impl-spec"));
  });

  it("emits a card per plan; only the newest carries isLatestPlan", () => {
    const cards = planItems(
      build([
        { id: "a", mode: PLAN, messages: ["Plan A"], withPlanFile: true },
        { id: "b", mode: PLAN, messages: ["Plan B"], withPlanFile: true },
      ]),
    );

    expect(cards.map((c) => [c.key, c.isLatestPlan])).toEqual([
      ["a-plan-completion", false],
      ["b-plan-completion", true],
    ]);
    expect(cards[0]!.planFile?.spec?.filename).toBe("plan.md");
  });

  it("skips a superseded plan that never returned a plan File", () => {
    const cards = planItems(
      build([
        { id: "a", mode: PLAN, messages: ["Plan A"] },
        { id: "b", mode: PLAN, messages: ["Plan B"] },
      ]),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe("b-plan-completion");
    expect(cards[0]!.planFile).toBeUndefined();
  });
});

describe("buildThreadItems plan-message collapse (plan File returned)", () => {
  it("removes the plan message — the card is the turn's sole plan representation", () => {
    const items = build([{ id: "p", mode: PLAN, messages: ["Let me look around first.", "# The Plan\n\n1. Do the thing"], withPlanFile: true }]);
    const keys = messageItems(items).map((i) => i.key);

    expect(keys).toContain(m("p", 0));
    expect(keys).not.toContain(m("p", 1));
    expect(messageItems(items).some((i) => i.isPlanDocument === true)).toBe(false);
  });

  it("lifts the plan's leading H1 onto the card, through a plan-scoped fence, or none", () => {
    expect(planItems(build([{ id: "p", mode: PLAN, messages: ["# Refactor auth\n\nSteps…"], withPlanFile: true }]))[0]!.planTitle).toBe("Refactor auth");
    expect(planItems(build([{ id: "p", mode: PLAN, messages: ["```\n# Fenced Plan\n\nBody\n```"], withPlanFile: true }]))[0]!.planTitle).toBe("Fenced Plan");
    expect(planItems(build([{ id: "p", mode: PLAN, messages: ["Just prose, no title"], withPlanFile: true }]))[0]!.planTitle).toBeUndefined();
  });

  it("gives no title to the latest plan's card when it returned no plan File", () => {
    expect(planItems(build([{ id: "p", mode: PLAN, messages: ["# Titled"] }]))[0]!.planTitle).toBeUndefined();
  });
});

describe("buildThreadItems plan-document stamping (no-plan-File fallback)", () => {
  const docs = (items: readonly ThreadItem[]) => messageItems(items).filter((i) => i.isPlanDocument === true);

  it("stamps the last agent message with content of a completed Plan turn", () => {
    const items = build([{ id: "p", mode: PLAN, messages: ["Let me look around first.", "# The Plan\n\n1. Do the thing", "   "] }]);

    expect(docs(items).map((i) => i.key)).toEqual([m("p", 1)]);
  });

  it("stamps nothing on an Agent-mode turn or a live Plan turn", () => {
    expect(docs(build([{ id: "a", mode: AGENT, messages: ["# Not a plan"] }]))).toHaveLength(0);
    expect(docs(build([{ id: "l", phase: "running", mode: PLAN, messages: ["Draft so far..."] }]))).toHaveLength(0);
  });

  it("scores the final answer of a completed turn that is not a plan", () => {
    const items = build([{ id: "a", mode: AGENT, messages: ["Working.", "Done."] }]);

    expect(messageItems(items).filter((i) => i.scoresRunId === "a").map((i) => i.key)).toEqual([m("a", 1)]);
  });
});

describe("buildThreadItems plan-writing (live collapse)", () => {
  const live: TurnFixture = { id: "live", phase: "running", mode: PLAN, messages: ["Let me look around first.", "# Live Plan\n\nDraft body"] };

  function planWriting(items: readonly ThreadItem[]) {
    return items.filter((i): i is Extract<ThreadItem, { kind: "plan-writing" }> => i.kind === "plan-writing");
  }

  it("suppresses the plan being written and emits a plan-writing card", () => {
    const items = build([live], { collapseStreamingPlan: true });
    const keys = messageItems(items).map((i) => i.key);

    expect(keys).toContain(m("live", 0));
    expect(keys).not.toContain(m("live", 1));
    const cards = planWriting(items);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.executionId).toBe("live");
    expect(cards[0]!.planTitle).toBe("Live Plan");
    expect(cards[0]!.planSize).toBe("# Live Plan\n\nDraft body".length);
  });

  it("shares the completion item's key, so the card holds one thread position", () => {
    const liveCard = planWriting(build([live], { collapseStreamingPlan: true }))[0]!;
    const settled = planItems(build([{ ...live, phase: "completed", withPlanFile: true }], { collapseStreamingPlan: true }))[0]!;

    expect(liveCard.key).toBe(settled.key);
  });

  it("keeps the plan inline when the host has no plan surface", () => {
    const items = build([live]);

    expect(planWriting(items)).toHaveLength(0);
    expect(messageItems(items).map((i) => i.key)).toContain(m("live", 1));
  });

  it("does not collapse narration without a leading H1, nor an Agent-mode turn", () => {
    expect(planWriting(build([{ id: "l", phase: "running", mode: PLAN, messages: ["Exploring the repo…"] }], { collapseStreamingPlan: true }))).toHaveLength(0);
    expect(planWriting(build([{ id: "a", phase: "running", mode: AGENT, messages: ["# Looks like a plan"] }], { collapseStreamingPlan: true }))).toHaveLength(0);
  });

  it("reverts to inline text when the turn stops without completing", () => {
    const items = build([{ id: "c", phase: "cancelled", mode: PLAN, messages: ["# Live Plan\n\nPartial"] }], { collapseStreamingPlan: true });

    expect(planWriting(items)).toHaveLength(0);
    expect(planItems(items)).toHaveLength(0);
    expect(messageItems(items).map((i) => i.key)).toContain(m("c", 0));
  });

  it("extracts the live title through an unterminated plan fence, and a partial H1", () => {
    expect(planWriting(build([{ id: "l", phase: "running", mode: PLAN, messages: ["```markdown\n# Fenced Live Plan\n\nBody"] }], { collapseStreamingPlan: true }))[0]?.planTitle).toBe("Fenced Live Plan");
    expect(planWriting(build([{ id: "l", phase: "running", mode: PLAN, messages: ["# Re"] }], { collapseStreamingPlan: true }))[0]?.planTitle).toBe("Re");
  });
});

describe("buildThreadItems build-from-plan prompt suppression", () => {
  function promptItem(items: readonly ThreadItem[], id: string) {
    return messageItems(items).find((i) => i.key === `${id}-spec`);
  }

  it("synthesizes NO prompt for a build turn, while its output still renders", () => {
    const items = build([{ id: "b", specMessage: "Build from plan", mode: AGENT, buildFromPlan: true, messages: ["Implementing…"] }]);

    expect(promptItem(items, "b")).toBeUndefined();
    expect(messageItems(items).some((i) => i.message.text === "Implementing…")).toBe(true);
  });

  it("synthesizes the prompt for an ordinary turn, as a person's message", () => {
    const prompt = promptItem(build([{ id: "n", mode: AGENT, messages: ["Done"] }]), "n");

    expect(prompt?.message).toEqual({ kind: "user", id: "n.user", text: "test message" });
    expect(prompt?.interactionMode).toBe(AGENT);
  });

  it("uses the turn's own message while its run is not listed", () => {
    const items = buildThreadItems(turnsOf(turnEvents({ id: "x", specMessage: "from the log" })), []);

    expect(promptItem(items, "x")?.message.text).toBe("from the log");
  });

  function errorItem(items: readonly ThreadItem[]) {
    return items.find((i): i is Extract<ThreadItem, { kind: "execution-error" }> => i.kind === "execution-error");
  }

  it("offers no retryMessage on a failed build turn (a plain resend would drop the flag)", () => {
    const items = build([{ id: "bf", specMessage: "Build from plan", phase: "failed", mode: AGENT, buildFromPlan: true, error: "runner crashed" }]);

    expect(errorItem(items)?.retryMessage).toBeUndefined();
  });

  it("keeps retryMessage on an ordinary failed turn, but not for the execute placeholder", () => {
    expect(errorItem(build([{ id: "f", specMessage: "do the thing", phase: "failed", mode: AGENT, error: "runner crashed" }]))?.retryMessage).toBe("do the thing");
    expect(errorItem(build([{ id: "e", specMessage: "execute", phase: "failed", error: "boom" }]))?.retryMessage).toBeUndefined();
  });
});

describe("buildThreadItems pending-bubble tail guard", () => {
  function pendingItem(items: readonly ThreadItem[]) {
    return messageItems(items).find((i) => i.key === "pending-user-turn");
  }

  it("suppresses the pending bubble once the same turn has arrived (succeeded send)", () => {
    expect(pendingItem(build([{ id: "t", specMessage: "hello there", mode: AGENT }], { pendingUserMessage: "hello there" }))).toBeUndefined();
  });

  it("renders a FAILED pending message even when an older turn carries identical text", () => {
    const items = build(
      [{ id: "b1", specMessage: "Build from plan", mode: AGENT, buildFromPlan: true }],
      { pendingUserMessage: "Build from plan", pendingMessageFailed: true },
    );
    const failed = pendingItem(items);

    expect(failed?.isFailed).toBe(true);
    expect(failed?.message.text).toBe("Build from plan");
  });
});
