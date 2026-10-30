// KIT-11 and the popup's audit, in a real browser against the shipped
// stylesheet: the popup's button and the open chat pass axe in light and
// dark; the chat never traps focus (Tab walks out of it to the host's page)
// and takes no key from the host (a key pressed in it still reaches the
// host's own listener, and Escape on the host's page leaves it open); Escape
// from inside closes it and focus returns to its button; on a phone it fills
// the screen; the moment the agent needs the person is announced while the
// chat is closed.
//
// The two session views are small probes (a text box and a button, and a
// conversation that reports its activity): what is under test is the frame.

import "../../../dist/styles.css";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { page, userEvent } from "@vitest/browser/context";
import { useContext, useState } from "react";
import type { Stigmer } from "@stigmer/client";
import { COLOR_MODES, auditA11y, resetAudit } from "../../__tests__/helpers/a11y-audit.js";
import { DialogShell } from "../../internal/DialogShell.js";
import { StigmerProvider } from "../../provider.js";
import { SCENARIO_CLOCK, conversationOf, scenarios } from "../../test/index.js";
import type { ChatActivity } from "../chat-activity.js";
import { chatActivityOf } from "../chat-activity-of.js";

/** Whether the launcher probe opens a modal File preview inside the chat, as the session view does. */
const probe = { preview: false };

/** A modal dialog the chat opens inside the popup (a File's preview), on the kit's one dialog shell. */
function FilePreview() {
  const [open, setOpen] = useState(true);
  return (
    <DialogShell open={open} onOpenChange={setOpen} aria-label="ledger.csv">
      <button type="button">Download</button>
    </DialogShell>
  );
}

vi.mock("../../session/NewSessionViewer.js", () => ({
  NewSessionViewer: () => (
    <form aria-label="First message" onSubmit={(event) => event.preventDefault()}>
      <label>
        Message
        <textarea />
      </label>
      <button type="submit">Send</button>
      {probe.preview && <FilePreview />}
    </form>
  ),
}));

const reporter: { current: ((activity: ChatActivity) => void) | null } = { current: null };
vi.mock("../../session/SessionViewer.js", async () => {
  const { ChatActivityReporterContext } = await import("../chat-activity.js");
  return {
    SessionViewer: () => {
      reporter.current = useContext(ChatActivityReporterContext);
      return (
        <label>
          Reply
          <textarea />
        </label>
      );
    },
  };
});

vi.mock("../../agent/useAgent.js", () => ({
  useAgent: () => ({ agent: null, isLoading: false, isRefetching: false, error: null, refetch: () => {} }),
}));

import { AgentChat } from "../AgentChat.js";

const CLIENT = { baseUrl: "https://example.test", getAuthCredential: async () => null } as unknown as Stigmer;

beforeEach(async () => {
  await page.viewport(1280, 800);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
  reporter.current = null;
  probe.preview = false;
});

afterEach(() => {
  cleanup();
  resetAudit();
  vi.useRealTimers();
});

/** The host's page: a search box, the chat, and a link after it. */
function renderHost(mode: "light" | "dark", sessionId: string | null = null, onHostKey?: (key: string) => void) {
  const listener = (event: KeyboardEvent) => onHostKey?.(event.key);
  document.addEventListener("keydown", listener);
  render(
    <StigmerProvider client={CLIENT} colorMode={mode}>
      <input aria-label="Search invoices" />
      <AgentChat agent="acme/billing-agent" title="Billing agent" variant="popup" defaultSessionId={sessionId} />
      <a href="#help">Help</a>
    </StigmerProvider>,
  );
  return () => document.removeEventListener("keydown", listener);
}

function portal(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-stgm-portal]")!;
}

function dialog(): HTMLDialogElement {
  return portal().querySelector("dialog")!;
}

describe("AgentChat popup", () => {
  it.each(COLOR_MODES)("passes the audit closed while a turn works, and open (%s)", async (mode) => {
    renderHost(mode, "ses_1");
    await vi.waitFor(() => expect(reporter.current).not.toBeNull());
    act(() => reporter.current!(chatActivityOf(conversationOf(scenarios.busy).activeTurn!, undefined, [], Date.parse(SCENARIO_CLOCK))));
    await screen.findByRole("button", { name: "Open the chat. Billing agent: Running a command, 1 min 30 s" });
    await auditA11y(portal(), `popup closed · ${mode}`);
    await userEvent.click(screen.getByRole("button", { name: /^Open the chat/ }));
    await auditA11y(portal(), `popup open · ${mode}`);
  });

  it("KIT-11 opens from the keyboard and moves focus into the chat", async () => {
    renderHost("light");
    screen.getByRole("textbox", { name: "Search invoices" }).focus();
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    await userEvent.keyboard("{Enter}");
    expect(dialog().open).toBe(true);
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("KIT-11 never traps focus: Tab and Shift+Tab walk out of the open chat to the page", async () => {
    renderHost("light");
    await userEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    for (let step = 0; step < 12 && dialog().contains(document.activeElement); step += 1) await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close the chat with Billing agent" }));

    await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
    for (let step = 0; step < 12 && dialog().contains(document.activeElement); step += 1) await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Help" }));
    expect(dialog().open).toBe(true);
  });

  it("KIT-11 takes no key from the host: keys typed in it reach the host's listener, and the host's Escape leaves it open", async () => {
    const keys: string[] = [];
    const stop = renderHost("light", null, (key) => keys.push(key));
    await userEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
    await userEvent.keyboard("k");
    expect(keys).toContain("k");
    await userEvent.click(screen.getByRole("textbox", { name: "Search invoices" }));
    await userEvent.keyboard("{Escape}");
    expect(dialog().open).toBe(true);
    stop();
  });

  it("KIT-11 closes on Escape from inside, returning focus to its button", async () => {
    renderHost("light");
    await userEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
    await userEvent.keyboard("{Escape}");
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
  });

  it("KIT-11 leaves a File preview's Escape to the preview: it closes, the popup stays, the page stays usable", async () => {
    probe.preview = true;
    let hostClicks = 0;
    render(
      <StigmerProvider client={CLIENT} colorMode="light">
        <button type="button" onClick={() => (hostClicks += 1)}>
          Host action
        </button>
        <AgentChat agent="acme/billing-agent" title="Billing agent" variant="popup" defaultOpen />
      </StigmerProvider>,
    );
    const preview = screen.getByRole("dialog", { name: "ledger.csv" }) as HTMLDialogElement;
    expect(preview.open).toBe(true);
    screen.getByRole("button", { name: "Download" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(preview.open).toBe(false);
    expect(dialog().open).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Host action" }));
    expect(hostClicks).toBe(1);
  });

  it("fills a phone's screen, closing from its header back to the button", async () => {
    await page.viewport(390, 844);
    renderHost("light");
    await userEvent.click(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
    const box = dialog().getBoundingClientRect();
    expect([box.left, box.top, box.width, box.height]).toEqual([0, 0, 390, 844]);
    await userEvent.click(screen.getByRole("button", { name: "Close the chat" }));
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open the chat with Billing agent" }));
  });

  it("announces, while closed, that the agent needs the person", async () => {
    renderHost("light", "ses_1");
    await vi.waitFor(() => expect(reporter.current).not.toBeNull());
    act(() => reporter.current!(chatActivityOf(conversationOf(scenarios.approval).activeTurn!, undefined, [], Date.parse(SCENARIO_CLOCK))));
    const live = portal().querySelector("[aria-live='polite']")!;
    expect(live.textContent).toBe("Billing agent needs your answer");
  });
});
