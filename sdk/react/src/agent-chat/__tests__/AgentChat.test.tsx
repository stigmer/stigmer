/**
 * Proves <AgentChat> (../AgentChat.tsx): the launcher until a conversation
 * exists, then the conversation, in every frame; the agent named by
 * "org/slug" and its organization by default; the first message's refusal
 * shown under its box; a controlled conversation; the panel's header, new
 * conversation and host-owned close; and the popup's corner button, which
 * opens a non-modal chat, takes focus into it, closes on Escape only from
 * inside, returns focus to the button, and says while closed what the
 * conversation reports (working, waiting, done until seen). Nothing renders
 * for the popup on the server.
 *
 * The two session views are prop-capturing probes, covered by their own
 * tests; the conversation probe reports activity through the frame's
 * context, as the real view does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useContext } from "react";
import { SCENARIO_CLOCK, conversationOf, scenarios } from "../../test";
import type { ChatActivity } from "../chat-activity";
import { chatActivityOf } from "../chat-activity-of";

type CapturedProps = Record<string, unknown>;

const newSessionViewerProps: CapturedProps[] = [];
/** Whether the launcher probe draws a portaled menu (never on the server, which has no portals). */
const probe = { menu: false, preview: false };
vi.mock("../../session/NewSessionViewer", async () => {
  const { createPortal } = await import("react-dom");
  const { DialogShell } = await import("../../internal/DialogShell");
  return {
    NewSessionViewer: (props: CapturedProps) => {
      newSessionViewerProps.push(props);
      return (
        <div data-testid="new-session-probe">
          {props.footerContent as never}
          {/* A composer menu, portaled out of the chat as the kit's menus are. */}
          {probe.menu && createPortal(<button type="button">Menu item</button>, document.body)}
          {/* A dialog the chat opens inside the popup, as a File's preview is. */}
          {probe.preview && (
            <DialogShell open modal={false} onOpenChange={() => {}} aria-label="ledger.csv">
              <button type="button">Download</button>
            </DialogShell>
          )}
        </div>
      );
    },
  };
});

const sessionViewerProps: CapturedProps[] = [];
const reporter: { current: ((activity: ChatActivity) => void) | null } = { current: null };
vi.mock("../../session/SessionViewer", async () => {
  const { ChatActivityReporterContext } = await import("../chat-activity");
  return {
    SessionViewer: (props: CapturedProps) => {
      sessionViewerProps.push(props);
      reporter.current = useContext(ChatActivityReporterContext);
      return <div data-testid="session-probe">{String(props.sessionId)}</div>;
    },
  };
});

vi.mock("../../agent/useAgent", () => ({
  useAgent: (org: string | null, slug: string | null) => ({
    agent: org && slug === "billing-agent" ? { metadata: { name: "Billing agent" } } : null,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: () => {},
  }),
}));

import { AgentChat } from "../AgentChat";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
  newSessionViewerProps.length = 0;
  sessionViewerProps.length = 0;
  reporter.current = null;
  probe.menu = false;
  probe.preview = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const busy = (): ChatActivity => (chatActivityOf(conversationOf(scenarios.busy).activeTurn!, undefined, [], Date.parse(SCENARIO_CLOCK)));
const waiting = (): ChatActivity => (chatActivityOf(conversationOf(scenarios.approval).activeTurn!, undefined, [], Date.parse(SCENARIO_CLOCK)));
const done: ChatActivity = { kind: "ended", runId: "run_9", phase: "completed", filesMade: 2 };

function startConversation(id = "ses_1") {
  const created = newSessionViewerProps.at(-1)!.onSessionCreated as (id: string) => void;
  act(() => created(id));
}

function report(activity: ChatActivity) {
  act(() => reporter.current!(activity));
}

describe("AgentChat, the page", () => {
  it("opens on the launcher, pinned to the agent, for an end user, in the agent's organization", () => {
    render(<AgentChat agent="acme/billing-agent" />);
    expect(screen.getByTestId("new-session-probe")).toBeTruthy();
    expect(newSessionViewerProps.at(-1)).toMatchObject({
      org: "acme",
      audience: "endUser",
      initialAgentRef: { org: "acme", slug: "billing-agent" },
      autoFocus: true,
    });
  });

  it("starts the conversation in the organization it is given", () => {
    render(<AgentChat agent="acme/billing-agent" org="acme-customer-7" />);
    expect(newSessionViewerProps.at(-1)).toMatchObject({ org: "acme-customer-7" });
  });

  it("hands off to the conversation once the first message starts one, and says so", async () => {
    const onSessionChange = vi.fn();
    render(<AgentChat agent="acme/billing-agent" onSessionChange={onSessionChange} />);
    startConversation();
    expect(onSessionChange).toHaveBeenCalledWith("ses_1");
    expect((await screen.findByTestId("session-probe")).textContent).toBe("ses_1");
    expect(sessionViewerProps.at(-1)).toMatchObject({ sessionId: "ses_1", org: "acme", audience: "endUser" });
  });

  it("shows the conversation it is given first", async () => {
    render(<AgentChat agent="acme/billing-agent" defaultSessionId="ses_4" />);
    expect((await screen.findByTestId("session-probe")).textContent).toBe("ses_4");
  });

  it("follows a controlled conversation, back to the launcher on null", async () => {
    const { rerender } = render(<AgentChat agent="acme/billing-agent" sessionId="ses_1" />);
    expect((await screen.findByTestId("session-probe")).textContent).toBe("ses_1");
    rerender(<AgentChat agent="acme/billing-agent" sessionId="ses_2" />);
    expect(screen.getByTestId("session-probe").textContent).toBe("ses_2");
    rerender(<AgentChat agent="acme/billing-agent" sessionId={null} />);
    expect(screen.getByTestId("new-session-probe")).toBeTruthy();
  });

  it("keeps a controlled conversation where it is until the host moves it", () => {
    const onSessionChange = vi.fn();
    render(<AgentChat agent="acme/billing-agent" sessionId={null} onSessionChange={onSessionChange} />);
    startConversation();
    expect(onSessionChange).toHaveBeenCalledWith("ses_1");
    expect(screen.getByTestId("new-session-probe")).toBeTruthy();
  });

  it("shows why the first message was refused under its box, and tells the host", () => {
    const onError = vi.fn();
    render(<AgentChat agent="acme/billing-agent" onError={onError} />);
    const error = new Error("quota");
    act(() => (newSessionViewerProps.at(-1)!.onError as (m: string, e: Error) => void)("Agent hours used up", error));
    expect(screen.getByRole("alert").textContent).toBe("Agent hours used up");
    expect(onError).toHaveBeenCalledWith("Agent hours used up", error);
  });

  it("passes the inspector to the page's views", async () => {
    const inspector = <div />;
    render(<AgentChat agent="acme/billing-agent" inspector={inspector} />);
    expect(newSessionViewerProps.at(-1)!.inspector).toBe(inspector);
    startConversation();
    await screen.findByTestId("session-probe");
    expect(sessionViewerProps.at(-1)!.inspector).toBe(inspector);
  });
});

describe("AgentChat, the panel", () => {
  it("names the agent in its header, from its own name, else its slug, else the title given", () => {
    const { rerender } = render(<AgentChat agent="acme/billing-agent" variant="panel" />);
    expect(screen.getByRole("heading", { name: "Billing agent" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Billing agent" })).toBeTruthy();
    rerender(<AgentChat agent="acme/other-agent" variant="panel" />);
    expect(screen.getByRole("heading", { name: "other-agent" })).toBeTruthy();
    rerender(<AgentChat agent="acme/billing-agent" variant="panel" title="Ledger help" />);
    expect(screen.getByRole("heading", { name: "Ledger help" })).toBeTruthy();
  });

  it("never takes focus from the host's page by itself", () => {
    render(<AgentChat agent="acme/billing-agent" variant="panel" />);
    expect(newSessionViewerProps.at(-1)).toMatchObject({ autoFocus: false });
  });

  it("starts a new conversation from its header, which does nothing while one is new", async () => {
    const onSessionChange = vi.fn();
    render(<AgentChat agent="acme/billing-agent" variant="panel" onSessionChange={onSessionChange} />);
    const newButton = screen.getByRole("button", { name: "New conversation" }) as HTMLButtonElement;
    expect(newButton.disabled).toBe(true);
    startConversation();
    await screen.findByTestId("session-probe");
    fireEvent.click(newButton);
    expect(onSessionChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("new-session-probe")).toBeTruthy();
  });

  it("offers close only when the host can reopen it, and hides without unmounting the conversation", async () => {
    const { rerender } = render(<AgentChat agent="acme/billing-agent" variant="panel" />);
    expect(screen.queryByRole("button", { name: "Close the chat" })).toBeNull();

    const onOpenChange = vi.fn();
    rerender(<AgentChat agent="acme/billing-agent" variant="panel" onOpenChange={onOpenChange} />);
    startConversation();
    await screen.findByTestId("session-probe");
    fireEvent.click(screen.getByRole("button", { name: "Close the chat" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const region = screen.getByTestId("session-probe").closest("section")!;
    expect(region.className).toContain("stg:hidden");
  });

  it("KIT-06 shows the panel's and popup's conversation without the inspector, where what a turn made opens in place", async () => {
    for (const variant of ["panel", "popup"] as const) {
      render(<AgentChat agent="acme/billing-agent" variant={variant} defaultOpen defaultSessionId="ses_1" inspector={<div />} />);
      await screen.findByTestId("session-probe");
      // SessionViewer with no inspector opens a turn's Files and changes from
      // the conversation itself (SessionViewer-noInspector.test.tsx).
      expect(sessionViewerProps.at(-1)!.inspector).toBeUndefined();
      cleanup();
    }
  });
});

describe("AgentChat, the popup", () => {
  function popupDialog() {
    return document.querySelector("dialog")!;
  }

  it("starts closed, with a button in the corner inviting the person to ask", () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" />);
    const button = screen.getByRole("button", { name: "Open the chat with Billing agent" });
    expect(button.textContent).toBe("Ask Billing agent");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(popupDialog().open).toBe(false);
  });

  it("opens beside the button without trapping focus, and takes focus into the chat", () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" />);
    fireEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    const dialog = popupDialog();
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: "Billing agent" }).id);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Close the chat with Billing agent" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape from inside, returning focus to the button", () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" />);
    fireEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(popupDialog().open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
  });

  it("leaves an Escape the host's page handled, or one pressed outside it, alone", () => {
    render(
      <>
        <input aria-label="Host search" />
        <AgentChat agent="acme/billing-agent" variant="popup" defaultOpen />
      </>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Host search" }), { key: "Escape" });
    expect(popupDialog().open).toBe(true);
    const inside = screen.getByRole("button", { name: "New conversation" });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      inside.dispatchEvent(event);
    });
    expect(popupDialog().open).toBe(true);
  });

  it("leaves the popup open on an Escape from a menu portaled out of it, which closes itself", () => {
    probe.menu = true;
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultOpen />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Menu item" }), { key: "Escape" });
    expect(popupDialog().open).toBe(true);
  });

  it("leaves an Escape pressed in a dialog inside the chat to that dialog", () => {
    probe.preview = true;
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultOpen />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Download" }), { key: "Escape" });
    expect(popupDialog().open).toBe(true);
  });

  it("ticks the closed button's time on, once a second", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(SCENARIO_CLOCK));
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByTestId("session-probe")).toBeTruthy();
    report(busy());
    expect(screen.getByRole("button", { name: /^Open the chat/ }).textContent).toBe("Running a command1 min 30 s");
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: /^Open the chat/ }).textContent).toBe("Running a command1 min 32 s");
  });

  it("says a turn that failed while closed failed, without the done mark", async () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" />);
    await screen.findByTestId("session-probe");
    report({ kind: "ended", runId: "run_9", phase: "failed", filesMade: 0 });
    expect(screen.getByRole("button", { name: "Open the chat. Billing agent: Failed" }).textContent).toBe("Failed");
  });

  it("closes from its header and from the button, returning focus to the button", () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Close the chat" }));
    expect(popupDialog().open).toBe(false);
    const opener = screen.getByRole("button", { name: "Open the chat with Billing agent" });
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Close the chat with Billing agent" }));
    expect(popupDialog().open).toBe(false);
  });

  it("follows a controlled open state, telling the host what the person asked for", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <AgentChat agent="acme/billing-agent" variant="popup" open={false} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(popupDialog().open).toBe(false);
    rerender(<AgentChat agent="acme/billing-agent" variant="popup" open onOpenChange={onOpenChange} />);
    expect(popupDialog().open).toBe(true);
  });

  it("says while closed what the working turn is doing, and announces nothing as the time ticks", async () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" />);
    await screen.findByTestId("session-probe");
    report(busy());
    const button = screen.getByRole("button", { name: "Open the chat. Billing agent: Running a command, 1 min 30 s" });
    expect(button.textContent).toBe("Running a command1 min 30 s");
    expect(document.querySelector("[aria-live='polite']")!.textContent).toBe("");
  });

  it("says, and announces, that the agent needs an answer", async () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" />);
    await screen.findByTestId("session-probe");
    report(waiting());
    expect(screen.getByRole("button", { name: "Open the chat. Billing agent needs your answer" }).textContent).toBe(
      "Needs your answer",
    );
    expect(document.querySelector("[aria-live='polite']")!.textContent).toBe("Billing agent needs your answer");
  });

  it("says a turn that ended while closed is done until the person opens the chat", async () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" />);
    await screen.findByTestId("session-probe");
    report(done);
    const button = screen.getByRole("button", { name: "Open the chat. Billing agent: Done, 2 files made" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Close the chat with Billing agent" }));
    expect(screen.getByRole("button", { name: "Open the chat with Billing agent" }).textContent).toBe("Ask Billing agent");
  });

  it("counts a turn that ends while the chat is open as seen", async () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" defaultOpen />);
    await screen.findByTestId("session-probe");
    report(done);
    fireEvent.click(screen.getByRole("button", { name: "Close the chat with Billing agent" }));
    expect(screen.getByRole("button", { name: "Open the chat with Billing agent" })).toBeTruthy();
  });

  it("forgets the last conversation's activity on a new conversation", async () => {
    render(<AgentChat agent="acme/billing-agent" variant="popup" defaultSessionId="ses_1" defaultOpen />);
    await screen.findByTestId("session-probe");
    report(busy());
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close the chat with Billing agent" }));
    expect(screen.getByRole("button", { name: "Open the chat with Billing agent" })).toBeTruthy();
  });

  it("renders nothing on the server", () => {
    expect(renderToString(<AgentChat agent="acme/billing-agent" variant="popup" />)).toBe("");
  });
});

describe("AgentChat on the server", () => {
  it("renders the page and the panel", () => {
    expect(renderToString(<AgentChat agent="acme/billing-agent" />)).toContain("new-session-probe");
    expect(renderToString(<AgentChat agent="acme/billing-agent" variant="panel" />)).toContain("Billing agent");
  });
});
