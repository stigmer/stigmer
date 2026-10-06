/**
 * The demo views a playback scenario composes for its "conversation" step
 * (`approval-flow-playback`, `tool-calls-playback`): `AppShell` with the
 * run's widget sidebar as its aside, and `ComposerView` showing the run.
 *
 * Pins what a reader of those tours sees: the run's messages in the real
 * `MessageThread` (the prompt synthesised from `spec.message`, the agent's
 * reply), a "Run details" sidebar carrying the real `RunProgress` badge for
 * the run's phase, and no sidebar at all when a step passes no aside. The
 * views need a `StigmerProvider` (the widgets read it); its client points at
 * a transport whose fetches never settle, so nothing leaves the test and no
 * late state update lands after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AppShell } from "../AppShell";
import { ComposerView } from "../ComposerView";
import { renderWidgetsSidebar } from "../WidgetsSidebar";
import { snapshot } from "../../fixtures";

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

const completedRun = () =>
  snapshot(
    [samples.humanMessage("What is the status of order 42?"), samples.aiMessage("Order 42 has shipped.")],
    RunPhase.RUN_COMPLETED,
  );

describe("the conversation step of a playback demo", () => {
  it("shows the run's prompt and reply in the message thread", () => {
    renderInProvider(
      <AppShell contentKey="session">
        <ComposerView execution={completedRun()} />
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
    const run = completedRun();
    renderInProvider(
      <AppShell contentKey="session" aside={renderWidgetsSidebar(run)}>
        <ComposerView execution={run} />
      </AppShell>,
    );

    const aside = screen.getByRole("complementary", { name: "Run details" });
    const progress = within(aside).getByRole("region", { name: "Run progress" });
    expect(progress.textContent).toContain("Completed");
  });

  it("renders no sidebar when the step passes no aside", () => {
    renderInProvider(
      <AppShell contentKey="session">
        <ComposerView execution={completedRun()} />
      </AppShell>,
    );

    expect(screen.queryByRole("complementary", { name: "Run details" })).toBeNull();
  });
});
