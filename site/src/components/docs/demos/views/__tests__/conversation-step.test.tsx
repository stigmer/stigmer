/**
 * The demo views a playback scenario composes for its "conversation" step
 * (`approval-flow-playback`, `tool-calls-playback`): `AppShell` with the
 * conversation's widget sidebar as its aside, and `ComposerView` showing the
 * conversation.
 *
 * Pins what a reader of those tours sees: the turn, folded from its session
 * events, in the real `MessageThread` (the person's message, the agent's
 * reply), a "Run details" sidebar carrying the real `RunProgress` badge for
 * the run's phase and the turn's to-dos, and no sidebar at all when a step
 * passes no aside. The approval tour's waiting frame: the real inline gate on
 * the call's row, its reason line, and an Approve that answers that call.
 * And the
 * step before it: the real `SessionComposer` with the prompt typed in. The
 * views need a `StigmerProvider` (the widgets read it); its client points at
 * a transport whose fetches never settle, so nothing leaves the test and no
 * late state update lands after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { AppShell } from "../AppShell";
import { ComposerView } from "../ComposerView";
import { renderWidgetsSidebar } from "../WidgetsSidebar";
import { conversation } from "../../fixtures";
import { waitingConversation } from "../../scenarios/approval-flow-playback/steps";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderInProvider(node: ReactNode) {
  const client = new Stigmer({
    baseUrl: "/",
    apiKey: "demo-views-test",
    customTransport: createConnectTransport({ baseUrl: "/", useBinaryFormat: false }),
  });
  return render(<StigmerProvider client={client}>{node}</StigmerProvider>);
}

const completedTurn = () =>
  conversation(
    samples.turnEvents({ message: "What is the status of order 42?", reply: "Order 42 has shipped." }),
    RunPhase.RUN_COMPLETED,
  );

/** A turn still running whose agent keeps a to-do list (its `write_todos` call). */
const plannedTurn = () =>
  conversation(
    samples.turnEvents({
      message: "Refund order 42.",
      tools: [
        {
          name: "write_todos",
          input: { todos: [{ content: "Look up order 42", status: "in_progress" }] },
          result: "ok",
        },
      ],
      reply: "",
      phase: "running",
    }),
  );

describe("the conversation step of a playback demo", () => {
  it("shows the run's prompt and reply in the message thread", () => {
    renderInProvider(
      <AppShell contentKey="session">
        <ComposerView conversation={completedTurn()} />
      </AppShell>,
    );

    const thread = screen.getByRole("log");
    expect(within(thread).getByRole("article", { name: "User message" }).textContent).toContain(
      "What is the status of order 42?",
    );
    expect(within(thread).getByRole("article", { name: "AI response" }).textContent).toContain(
      "Order 42 has shipped.",
    );
  });

  it("renders the run's widgets in a Run details sidebar", () => {
    const turn = completedTurn();
    renderInProvider(
      <AppShell contentKey="session" aside={renderWidgetsSidebar(turn)}>
        <ComposerView conversation={turn} />
      </AppShell>,
    );

    const aside = screen.getByRole("complementary", { name: "Run details" });
    const progress = within(aside).getByRole("region", { name: "Run progress" });
    expect(progress.textContent).toContain("Completed");
  });

  it("lists the turn's to-dos under the run's phase in the sidebar", () => {
    const turn = plannedTurn();
    renderInProvider(
      <AppShell contentKey="session" aside={renderWidgetsSidebar(turn)}>
        <ComposerView conversation={turn} />
      </AppShell>,
    );

    const aside = screen.getByRole("complementary", { name: "Run details" });
    const progress = within(aside).getByRole("region", { name: "Run progress" });
    expect(progress.textContent).toContain("Look up order 42");
  });

  it("renders no sidebar when the step passes no aside", () => {
    renderInProvider(
      <AppShell contentKey="session">
        <ComposerView conversation={completedTurn()} />
      </AppShell>,
    );

    expect(screen.queryByRole("complementary", { name: "Run details" })).toBeNull();
  });
});

describe("the approval step of the approval-flow demo", () => {
  it("shows the waiting call's gate with its reason, and Approve answers that call", () => {
    const onAnswer = vi.fn();
    const { container } = renderInProvider(
      <ComposerView conversation={waitingConversation} onAnswerToolUse={onAnswer} />,
    );

    expect(container.querySelector('[data-cursor-target="approval-gate-reason"]')?.textContent).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    const waitingId = waitingConversation.turns[0]!.asks[0]!.id;
    expect(onAnswer).toHaveBeenCalledWith(waitingId, "allow", undefined);
  });
});

describe("the typing step of a playback demo", () => {
  it("fills the real composer's text box with the prompt being typed", () => {
    renderInProvider(<ComposerView typingMessage="What is the status of order 42?" />);

    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("What is the status of order 42?");
  });
});
