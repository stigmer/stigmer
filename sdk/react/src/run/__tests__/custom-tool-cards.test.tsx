// Pins a call of the app's own tools (the session's `custom_tools`) in the
// thread: a card registered under the tool's declared name draws it, and
// gets an `answer` bound to the call only while the call waits on the app
// and the viewer may answer; the answer reaches the thread's handler with
// the call's id, the text and `isError`, one stable function per call, kept
// in the conversation it was made in; a call named like a built-in tool
// still reads as the app's; once
// answered the card draws the result as history with no answer. With no
// card, the kit's row says "Waiting for the app" and opens to what the
// agent asked, with no button. A plan item and a run group read a call
// waiting on the app as open, and the thread's working line holds back
// while one waits.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import type { ToolUse } from "@stigmer/client";
import { ToolCallItem } from "../ToolCallItem";
import { ToolRunGroup } from "../ToolRunGroup";
import { MessageThread } from "../MessageThread";
import { ThreadPresentationContext } from "../ThreadPresentationContext";
import { ToolCardsContext, type CustomToolAnswer, type ToolCardProps, type ToolCards } from "../tool-cards-context";
import { CustomToolAnswerContext, useCustomToolAnswers, type AnswerCustomToolUse } from "../CustomToolAnswerContext";
import { hostCardOf } from "../tool-card";
import { useCustomToolUseCallback } from "../../session/useCustomToolUseCallback";
import { toolUse } from "./__fixtures__/fold-values";
import { customUse, said, status, turnsOf, user } from "./__fixtures__/thread-events";

afterEach(cleanup);

const INPUT = { account_name: "payments-prod", provider: "aws", region: "us-east-1", auth_method: "role" };

function register(init: Partial<Parameters<typeof toolUse>[0]> = {}): ToolUse {
  return toolUse({ name: "register_cloud_account", custom: true, input: INPUT, ...init });
}

/** What the host's card was handed, and its Register button when it may answer. */
const handed: { answer: CustomToolAnswer | undefined }[] = [];
function AccountCard({ call, answer }: ToolCardProps) {
  handed.push({ answer });
  return (
    <div data-testid="account-card">
      {call.state} · {String(call.input["account_name"])} · {call.result?.text ?? "no result"}
      {answer !== undefined && (
        <button type="button" onClick={() => void answer("Registered as acct_7Q2F")}>
          Register
        </button>
      )}
    </div>
  );
}

const CARDS: ToolCards = { register_cloud_account: AccountCard };

function view(node: ReactNode, opts: { cards?: ToolCards | null; answer?: AnswerCustomToolUse } = {}): ReactNode {
  return (
    <ToolCardsContext.Provider value={opts.cards === undefined ? CARDS : opts.cards}>
      <ThreadPresentationContext.Provider value={{ sessionId: "session_1" }}>
        <AnswerProvider answer={opts.answer}>{node}</AnswerProvider>
      </ThreadPresentationContext.Provider>
    </ToolCardsContext.Provider>
  );
}

function AnswerProvider({ answer, children }: { answer: AnswerCustomToolUse | undefined; children: ReactNode }) {
  const answerFor = useCustomToolAnswers(answer);
  return <CustomToolAnswerContext.Provider value={{ answerFor }}>{children}</CustomToolAnswerContext.Provider>;
}

describe("hostCardOf for the app's own tools", () => {
  it("matches a custom call by its declared name, and a same-named built-in or server tool by theirs", () => {
    expect(hostCardOf(CARDS, { name: "register_cloud_account", mcpServerName: "", custom: true })).toBe(AccountCard);
    expect(hostCardOf(CARDS, { name: "register_cloud_account", mcpServerName: "billing", custom: false })).toBeUndefined();
  });
});

describe("a host's card for a call waiting on the app", () => {
  it("is drawn under the kit's line, which says it waits for the app", () => {
    render(view(<ToolCallItem toolUse={register()} />, { answer: vi.fn() }));
    expect(screen.getByTestId("account-card").textContent).toContain("waiting-on-host · payments-prod · no result");
    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
  });

  it("answers through the thread's handler with the call's id, the text and no error", async () => {
    const answer = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    render(view(<ToolCallItem toolUse={register()} />, { answer }));
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(answer).toHaveBeenCalledWith("run_1.register_cloud_account", "Registered as acct_7Q2F", undefined);
  });

  it("passes isError through, for a cancel", async () => {
    const answer = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    handed.length = 0;
    render(view(<ToolCallItem toolUse={register()} />, { answer }));
    await handed.at(-1)!.answer!("The person cancelled", { isError: true });
    expect(answer).toHaveBeenCalledWith("run_1.register_cloud_account", "The person cancelled", { isError: true });
  });

  it("gets no answer for a viewer who may not answer: the card shows the call and offers nothing", () => {
    render(view(<ToolCallItem toolUse={register()} />));
    expect(screen.getByTestId("account-card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("gets no answer once the call is answered, and draws the result as history", () => {
    render(view(<ToolCallItem toolUse={register({ result: "Registered as acct_7Q2F" })} />, { answer: vi.fn() }));
    expect(screen.getByTestId("account-card").textContent).toContain("completed · payments-prod · Registered as acct_7Q2F");
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
    expect(screen.queryByText(/Waiting for the app/)).toBeNull();
  });

  it("keeps one answer function per call across renders", () => {
    const answer = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    handed.length = 0;
    const { rerender } = render(view(<ToolCallItem toolUse={register()} />, { answer }));
    rerender(view(<ToolCallItem toolUse={register({ input: { ...INPUT, region: "us-west-2" } })} />, { answer }));
    expect(handed.length).toBeGreaterThan(1);
    expect(handed.at(-1)!.answer).toBe(handed[0]!.answer);
  });
});

describe("useCustomToolAnswers", () => {
  it("still answers after the viewer that made it unmounted, for a panel that outlives the chat", async () => {
    const answer = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useCustomToolAnswers(answer));
    const bound = result.current!("ctu-1");
    unmount();
    await bound("ok");
    expect(answer).toHaveBeenCalledWith("ctu-1", "ok", undefined);
  });

  it("keeps an answer in the conversation it was made in when the viewer moves to another", async () => {
    const first = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    const second = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ fn, scope }) => useCustomToolAnswers(fn, scope), { initialProps: { fn: first, scope: "ses_a" } });
    const fromA = result.current!("ctu-a");
    rerender({ fn: second, scope: "ses_b" });
    await fromA("ok");
    expect(first).toHaveBeenCalledWith("ctu-a", "ok", undefined);
    expect(second).not.toHaveBeenCalled();
    expect(result.current!("ctu-a")).not.toBe(fromA);
  });

  it("gives nothing while there is no handler", () => {
    const { result } = renderHook(() => useCustomToolAnswers(undefined));
    expect(result.current).toBeUndefined();
  });

  it("keeps the same answer per id while the handler changes, and calls the newest", async () => {
    const first = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    const second = vi.fn<AnswerCustomToolUse>().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ fn }) => {
      const answerFor = useCustomToolAnswers(fn);
      const kept = useRef(answerFor?.("ctu-1"));
      return { now: answerFor?.("ctu-1"), kept: kept.current };
    }, { initialProps: { fn: first } });
    rerender({ fn: second });
    expect(result.current.now).toBe(result.current.kept);
    await result.current.now!("ok");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("useCustomToolUseCallback", () => {
  it("tells the host about a call that arrives later, and never again about one it told", () => {
    const heard = vi.fn();
    const a = register({ id: "run_1.a" });
    const b = register({ id: "run_1.b" });
    const answerFor = () => async () => undefined;
    const { rerender } = renderHook(({ calls }) => useCustomToolUseCallback({ calls, sessionId: "s", answerFor, onCustomToolUse: heard }), {
      initialProps: { calls: [a] },
    });
    rerender({ calls: [a, b] });
    expect(heard.mock.calls.map(([call]) => call.id)).toEqual(["run_1.a", "run_1.b"]);
  });
});

describe("the kit's row for a call waiting on the app, with no card", () => {
  it("says it waits for the app, opens to what the agent asked, and offers no answer", () => {
    render(view(<ToolCallItem toolUse={register()} />, { cards: null, answer: vi.fn() }));
    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
    expect(screen.getByText("payments-prod")).toBeTruthy();
    expect(screen.getByText("auth_method")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(allow|deny|approve|register|submit|answer)$/i })).toBeNull();
  });

  it("reads a call named like a built-in tool as the app's, waiting for the app", () => {
    render(view(<ToolCallItem toolUse={toolUse({ name: "search", custom: true, input: { query: "accounts" } })} />, { cards: null }));
    expect(screen.getByText(/Waiting for the app/)).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
  });

  it("never says the person is the one waited on", () => {
    render(view(<ToolCallItem toolUse={register()} />, { cards: null }));
    expect(screen.queryByText(/Waiting for you/)).toBeNull();
    expect(screen.queryByText(/Waiting for the owner/)).toBeNull();
  });
});

describe("readers of an open call", () => {
  it("a run group holding a call waiting on the app stays open with the working mark, never a done tick", () => {
    const { container } = render(
      view(<ToolRunGroup category="read" toolUses={[toolUse({ id: "r1", name: "Read", input: { path: "/a.ts" }, result: "x" }), register()]} />, { cards: null }),
    );
    expect(container.querySelector('[data-cursor-target="thread-card-toggle"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".stg\\:text-status-running")).not.toBeNull();
  });

  it("the working line holds back while the turn waits on the app", () => {
    const LINE = '[data-cursor-target="liveness-status-line"]';
    const base = [user("run_1", "Connect our account"), status("run_1", "running"), said("run_1", 0, "I'll fill in the form.")];
    const working = render(view(<MessageThread turns={turnsOf(...base)} runs={[]} />, { cards: null }));
    expect(working.container.querySelector(LINE)).not.toBeNull();
    cleanup();

    const waits = render(view(<MessageThread turns={turnsOf(...base, customUse("run_1", "c1", "register_cloud_account", INPUT))} runs={[]} />, { cards: null }));
    expect(waits.container.querySelector(LINE)).toBeNull();
  });
});
