// A call of the app's own tools in a real Chromium, light and dark, as an
// app that answers it meets it. The app registers a card for the tool and
// opens its own side panel from the viewer's callback, both answering
// through the answer the chat hands them. Live, the call waiting: the card
// sits inside the kit's row, the panel opens, and the person fills the
// panel's form and answers by keyboard alone; the answer reaches the
// conversation's handler with the call's id, and no key is taken from the
// page. Mounted again over the same stored record, the call still waiting
// (what a reload is on the client side), the panel opens again. Once the
// call is answered, the card draws it as history and nothing opens. The
// card, the panel's host and the kit's own row with no card each pass axe.
//
// The app is composed from the parts SessionViewer composes (the thread,
// the per-call answers, the callback), so what the viewer's own data
// hooks add (the session's stream) stays with their tests.

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import { useState, type FormEvent } from "react";
import type { Turn } from "@stigmer/client";
import { auditA11y, COLOR_MODES, renderAudited, resetAudit } from "../../../__tests__/helpers/a11y-audit";
import { MessageThread } from "../../MessageThread";
import { ToolCardsContext, type CustomToolAnswer, type ToolCallInfo, type ToolCardProps, type ToolCards } from "../../tool-cards-context";
import { useCustomToolAnswers, type AnswerCustomToolUse } from "../../CustomToolAnswerContext";
import { useCustomToolUseCallback } from "../../../session/useCustomToolUseCallback";
import { customResult, customUse, said, status, toolId, turnsOf, user } from "../__fixtures__/thread-events";

afterEach(() => {
  resetAudit();
  cleanup();
});

const R = "run_c";
const CALL = toolId(R, "reg");
const INPUT = { account_name: "payments-prod", provider: "aws", region: "us-east-1", auth_method: "role" };
const ASKED = [user(R, "Connect our payments production AWS account"), status(R, "running"), said(R, 0, "I'll fill in the registration form for you to check."), customUse(R, "reg", "register_cloud_account", INPUT)];

/** The stored record while the call waits, and once the app answered it and the turn finished. */
const WAITING: readonly Turn[] = turnsOf(...ASKED, status(R, "waiting"));
const ANSWERED: readonly Turn[] = turnsOf(...ASKED, customResult(R, "reg", "Registered payments-prod as acct_7Q2F"), said(R, 1, "Registered payments-prod."), status(R, "completed"));

/** The app's own card: the form's summary, read-only, and the state it is in. */
function AccountCard({ call }: ToolCardProps) {
  return (
    <section aria-label="Cloud account" style={{ border: "1px solid var(--stgm-border)", borderRadius: 8, padding: 12 }}>
      <p style={{ margin: 0 }}>
        {String(call.input["account_name"])} · {call.state === "waiting-on-host" ? "Check it in the panel" : call.result?.text}
      </p>
    </section>
  );
}
const CARDS: ToolCards = { register_cloud_account: AccountCard };

/** The app's side panel: its own form, answering the call it was handed. */
function Panel({ call, answer, onDone }: { call: ToolCallInfo; answer: CustomToolAnswer; onDone: () => void }) {
  const [name, setName] = useState(String(call.input["account_name"]));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void answer(`Registered ${name}`).then(onDone);
  };
  return (
    <aside aria-label="Register cloud account">
      <form onSubmit={submit}>
        <label>
          Account name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">Register</button>
      </form>
    </aside>
  );
}

/** The app: the chat's thread with its card, and its own panel opened from the callback. */
function App({ turns, answer, opened }: { turns: readonly Turn[]; answer: AnswerCustomToolUse; opened: ToolCallInfo[] }) {
  const [panel, setPanel] = useState<{ call: ToolCallInfo; answer: CustomToolAnswer } | null>(null);
  const answerFor = useCustomToolAnswers(answer);
  useCustomToolUseCallback({
    calls: turns.at(-1)?.ended === false ? turns.at(-1)!.customToolUses : [],
    sessionId: "ses_1",
    answerFor,
    onCustomToolUse: (call, reply) => {
      opened.push(call);
      setPanel({ call, answer: reply });
    },
  });
  return (
    <ToolCardsContext.Provider value={CARDS}>
      <input aria-label="Search accounts" />
      <MessageThread turns={turns} sessionId="ses_1" onAnswerCustomToolUse={answer} />
      {panel !== null && <Panel call={panel.call} answer={panel.answer} onDone={() => setPanel(null)} />}
    </ToolCardsContext.Provider>
  );
}

describe("a call of the app's own tools, in the app", () => {
  it.each(COLOR_MODES)("passes the audit with the card in the row and the panel open (%s)", async (mode) => {
    const container = renderAudited(<App turns={WAITING} answer={async () => undefined} opened={[]} />, mode);
    await screen.findByRole("complementary", { name: "Register cloud account" });
    expect(screen.getByRole("region", { name: "Cloud account" })).toBeTruthy();
    await auditA11y(container, `custom tool card and panel · ${mode}`);
  });

  it("opens the panel live, is answered by keyboard alone, and takes no key from the page", async () => {
    const answered: Array<[string, string]> = [];
    const opened: ToolCallInfo[] = [];
    const prevented: string[] = [];
    const listener = (event: KeyboardEvent) => {
      queueMicrotask(() => {
        if (event.defaultPrevented) prevented.push(event.key);
      });
    };
    document.addEventListener("keydown", listener);
    try {
      renderAudited(<App turns={WAITING} answer={async (id, text) => void answered.push([id, text])} opened={opened} />, "light");
      const field = await screen.findByRole("textbox", { name: "Account name" });
      expect(opened.map((call) => call.id)).toEqual([CALL]);

      field.focus();
      await userEvent.keyboard("{Control>}a{/Control}{Meta>}a{/Meta}payments-eu");
      await userEvent.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Register" }));
      await userEvent.keyboard("{Enter}");

      await waitFor(() => expect(answered).toEqual([[CALL, "Registered payments-eu"]]));
      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Register cloud account" })).toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(prevented.filter((key) => key === "Tab")).toEqual([]);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });

  it("opens the panel again when the app is opened again over the same record, the call still waiting", async () => {
    const opened: ToolCallInfo[] = [];
    renderAudited(<App turns={WAITING} answer={async () => undefined} opened={opened} />, "light");
    await screen.findByRole("complementary", { name: "Register cloud account" });
    cleanup();

    renderAudited(<App turns={WAITING} answer={async () => undefined} opened={opened} />, "light");
    await screen.findByRole("complementary", { name: "Register cloud account" });
    expect(opened.map((call) => call.id)).toEqual([CALL, CALL]);
  });

  it("draws an answered call as history and opens nothing", async () => {
    const opened: ToolCallInfo[] = [];
    renderAudited(<App turns={ANSWERED} answer={async () => undefined} opened={opened} />, "light");
    await screen.findByText("Registered payments-prod.");
    expect(screen.getAllByText(/Registered payments-prod as acct_7Q2F/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("complementary", { name: "Register cloud account" })).toBeNull();
    expect(opened).toEqual([]);
  });
});

describe("the kit's own row for a call waiting on the app, with no card", () => {
  it.each(COLOR_MODES)("says it waits for the app, opens to what was asked, and passes the audit (%s)", async (mode) => {
    const container = renderAudited(<MessageThread turns={WAITING} sessionId="ses_1" />, mode);
    expect(await screen.findByText(/Waiting for the app/)).toBeTruthy();
    expect(screen.getByText("payments-prod")).toBeTruthy();
    await auditA11y(container, `custom tool row · ${mode}`);
  });

  it("is reached and closed by keyboard alone", async () => {
    renderAudited(
      <>
        <input aria-label="Search accounts" />
        <MessageThread turns={WAITING} sessionId="ses_1" />
      </>,
      "light",
    );
    screen.getByRole("textbox", { name: "Search accounts" }).focus();
    let toggle: HTMLElement | null = null;
    for (let i = 0; i < 20 && toggle === null; i += 1) {
      await userEvent.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute("aria-expanded") === "true" && /Register cloud account/.test(active.getAttribute("aria-label") ?? active.textContent ?? "")) toggle = active;
    }
    expect(toggle).not.toBeNull();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(toggle!.getAttribute("aria-expanded")).toBe("false"));
  });
});
