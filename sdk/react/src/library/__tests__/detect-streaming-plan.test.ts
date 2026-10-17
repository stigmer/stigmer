/**
 * findStreamingPlan: the plan a live Plan-mode turn is writing, read from
 * the turn's folded items and its run's mode. Gated on Plan mode and on the
 * turn not having ended (a wait for a person keeps it live); the candidate
 * is the turn's LAST content-bearing agent message (live or stored), and it
 * qualifies only with a leading `# ` title, tolerating an enclosing plan
 * fence that has not closed yet while leaving inner code fences and other
 * languages alone.
 */
import { describe, it, expect } from "vitest";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionLog, type Turn, type TurnPhase } from "@stigmer/client";
import { findStreamingPlan } from "../detect-streaming-plan";
import { samples } from "../../test/samples";
import {
  previewDelta,
  previewStart,
  runOf,
  said,
  status,
  thought,
  turnsOf,
  use,
  user,
} from "../../run/__tests__/__fixtures__/thread-events";

const R = "run_a";

function turnWith(phase: TurnPhase, ...extra: SessionEvent[]): Turn {
  return turnsOf(user(R, "plan it"), status(R, "running"), ...extra, ...(phase === "running" ? [] : [status(R, phase)]))[0]!;
}

const planRun = (mode = InteractionMode.PLAN) => runOf(R, { spec: { interactionMode: mode }, status: {} });

/** A live Plan-mode turn whose agent messages are `texts`, in order. */
function livePlan(...texts: string[]) {
  return findStreamingPlan(turnWith("running", ...texts.map((text, i) => said(R, i, text))), planRun());
}

describe("findStreamingPlan — mode and phase gating", () => {
  const PLAN_TEXT = "# The Plan\n\nBody";

  it("detects a plan on a live Plan-mode turn", () => {
    expect(livePlan(PLAN_TEXT)).toEqual({ messageId: `${R}.root.m0`, displayText: PLAN_TEXT });
  });

  it("returns undefined without a turn", () => {
    expect(findStreamingPlan(null, planRun())).toBeUndefined();
    expect(findStreamingPlan(undefined, planRun())).toBeUndefined();
  });

  it("returns undefined for an Agent-mode turn, no mode, or no run", () => {
    const turn = turnWith("running", said(R, 0, PLAN_TEXT));
    expect(findStreamingPlan(turn, planRun(InteractionMode.AGENT))).toBeUndefined();
    expect(findStreamingPlan(turn, planRun(InteractionMode.UNSPECIFIED))).toBeUndefined();
    expect(findStreamingPlan(turn, undefined)).toBeUndefined();
  });

  it.each<TurnPhase>(["completed", "failed", "cancelled", "terminated"])("returns undefined once the turn ended (%s)", (phase) => {
    expect(findStreamingPlan(turnWith(phase, said(R, 0, PLAN_TEXT)), planRun())).toBeUndefined();
  });

  it("detects while the turn waits for a person", () => {
    expect(findStreamingPlan(turnWith("waiting", said(R, 0, PLAN_TEXT)), planRun())).toBeDefined();
  });

  it("detects a plan still being written (a live preview)", () => {
    const log = new SessionLog();
    log.apply(samples.sessionEventList([user(R, "plan it"), status(R, "running")]).events);
    log.applyFrame(previewStart(`${R}.root.m0`));
    log.applyFrame(previewDelta(`${R}.root.m0`, "# Live"));

    expect(findStreamingPlan(log.snapshot().turns[0], planRun())?.displayText).toBe("# Live");
  });
});

describe("findStreamingPlan — candidate selection", () => {
  it("considers only the LAST content-bearing agent message", () => {
    expect(livePlan("# Early heading in narration", "Now let me check the tests.")).toBeUndefined();
  });

  it("skips trailing empty messages", () => {
    expect(livePlan("# The Plan\n\nBody", "   ")?.messageId).toBe(`${R}.root.m0`);
  });

  it("ignores thinking and tool calls when selecting the candidate", () => {
    const turn = turnWith("running", said(R, 0, "# The Plan\n\nBody"), ...thought(R, 0, "hmm, one more thing"), use(R, "c1", "read_file"));
    expect(findStreamingPlan(turn, planRun())?.messageId).toBe(`${R}.root.m0`);
  });

  it("returns undefined when there are no messages", () => {
    expect(livePlan()).toBeUndefined();
  });
});

describe("findStreamingPlan — H1 convention", () => {
  it("does not detect narration, a lone '#', or an H2-led message", () => {
    expect(livePlan("Let me explore the codebase.")).toBeUndefined();
    expect(livePlan("#")).toBeUndefined();
    expect(livePlan("## Notes\n\nSome section")).toBeUndefined();
  });

  it("detects the moment the H1 gains its first title character", () => {
    expect(livePlan("# T")?.displayText).toBe("# T");
  });

  it("tolerates leading blank lines before the H1", () => {
    expect(livePlan("\n\n# The Plan\n\nBody")).toBeDefined();
  });
});

describe("findStreamingPlan — unterminated-fence tolerance", () => {
  it.each([
    ["```markdown\n# The Plan\n\nBody", "# The Plan\n\nBody"],
    ["```md\n# The Plan", "# The Plan"],
    ["```\n# The Plan", "# The Plan"],
    ["```markdown\n# The Plan\n\nBody\n```", "# The Plan\n\nBody"],
    ["```markdown\n# The Plan\n\n```ts\nconst x = 1;\n```\n\nMore", "# The Plan\n\n```ts\nconst x = 1;\n```\n\nMore"],
  ])("unwraps the enclosing plan fence of %j", (text, displayText) => {
    expect(livePlan(text)?.displayText).toBe(displayText);
  });

  it("never unwraps a fence with another language tag, nor detects a fenced body without an H1", () => {
    expect(livePlan("```python\n# not a heading, a comment")).toBeUndefined();
    expect(livePlan("```\nplain fenced text")).toBeUndefined();
  });
});
