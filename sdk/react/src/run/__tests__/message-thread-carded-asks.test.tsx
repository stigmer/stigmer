/**
 * MessageThread decides where each ask is answered, once, and its rows read
 * that decision (`cardedAsks` on ThreadPresentationContext): in a turn
 * drawn as its plan, the owner answers a helper's waiting step in the card
 * below the plan, the item and the helper's row saying it waits, and the
 * decision is offered nowhere else; a viewer who cannot answer sees the
 * waiting step inside its item, with no decision anywhere. The presentation
 * the rows read keeps its identity across streamed frames that bring no new
 * ask, and changes when one arrives.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { Turn } from "@stigmer/client";
import { MessageThread } from "../MessageThread";
import { useThreadPresentation, type ThreadPresentation } from "../ThreadPresentationContext";
import { asked, conversation, result, subagent, toolId, use } from "./__fixtures__/thread-events";

afterEach(cleanup);

const B = "b";

/** A to-do write that returned. */
function todos(runId: string, content: string): SessionEvent[] {
  return [use(runId, "t1", "write_todos", { todos: [{ content, status: "in_progress" }] }), result(runId, "t1", "ok")];
}

/** A plan turn whose helper waits for a person to run its command. */
function helperWaits() {
  const task = toolId(B, "task1");
  return conversation({
    id: B,
    phase: "running",
    reply: "",
    extra: [
      ...todos(B, "Check the tests"),
      use(B, "task1", "task", { description: "Run the suite" }),
      ...subagent(B, "task1", { items: [use(B, "s1", "execute", { command: "npm test" }, { ask: true, threadId: task }), asked(B, "s1", { threadId: task })] }),
    ],
  });
}

/** The line of a plan item, by its words. */
function itemLine(words: string): HTMLElement {
  return screen.getByText(words).closest("li")!.querySelector<HTMLElement>(":scope > div")!;
}

describe("MessageThread carded asks", () => {
  it("answers a helper's waiting step in a plan in the card below the plan, the decision drawn once", () => {
    const conv = helperWaits();
    render(<MessageThread turns={conv.turns} runs={conv.runs} onAnswerToolUse={() => undefined} />);

    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(itemLine("Check the tests")).getByText("Waiting for you")).toBeTruthy();
    expect(within(plan).queryByLabelText("Allow")).toBeNull();
    expect(screen.getAllByLabelText("Allow")).toHaveLength(1);
    expect(plan.compareDocumentPosition(screen.getByLabelText("Allow")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a watcher the helper's waiting step inside its item, with no decision anywhere", () => {
    const conv = helperWaits();
    render(<MessageThread turns={conv.turns} runs={conv.runs} approverName="Maya Okafor" />);

    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(itemLine("Check the tests")).getByText("Waiting for Maya Okafor to approve")).toBeTruthy();
    expect(within(plan).getByText("Run the suite")).toBeTruthy();
    expect(screen.queryByLabelText("Allow")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the presentation's identity across frames with the same asks, and changes it when an ask arrives", () => {
    const seen: ThreadPresentation[] = [];
    function Probe() {
      seen.push(useThreadPresentation());
      return null;
    }
    const turnOutcome = (_turn: Turn) => <Probe />;
    const onAnswer = () => undefined;
    const frame = (extra: readonly SessionEvent[]) =>
      conversation({ id: "a" }, { id: B, phase: "running", reply: "", extra: [...todos(B, "Read the code"), ...extra] });
    const draw = (conv: ReturnType<typeof frame>) => (
      <MessageThread turns={conv.turns} runs={conv.runs} turnOutcome={turnOutcome} onAnswerToolUse={onAnswer} />
    );

    const first = frame([use(B, "c1", "read_file", { path: "a.ts" }), result(B, "c1", "ok")]);
    const { rerender } = render(draw(first));
    const second = frame([use(B, "c1", "read_file", { path: "a.ts" }), result(B, "c1", "ok"), use(B, "c2", "read_file", { path: "b.ts" }), result(B, "c2", "ok")]);
    rerender(draw(second));

    expect(new Set(seen).size).toBe(1);
    expect(seen[0]!.cardedAsks?.size).toBe(0);

    const third = frame([
      use(B, "c1", "read_file", { path: "a.ts" }),
      result(B, "c1", "ok"),
      use(B, "c2", "read_file", { path: "b.ts" }),
      result(B, "c2", "ok"),
      use(B, "c3", "execute", { command: "git push" }, { ask: true }),
      asked(B, "c3"),
    ]);
    rerender(draw(third));

    expect(new Set(seen).size).toBe(2);
    expect([...(seen.at(-1)!.cardedAsks ?? [])]).toEqual([toolId(B, "c3")]);
  });
});
