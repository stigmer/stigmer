/**
 * Pins the confirm dialog that does its act. Given an `action`, confirming
 * keeps the dialog open while the act runs (the confirm button waits with
 * a spinner; Cancel and the close button are held), a failure is said in
 * the dialog (with what did not change under it, when the page says) and
 * the confirm button reading "Try again", trying again
 * runs the act again, and the dialog closes, resolving `confirm()` true,
 * only once the act succeeds. Without an `action` the dialog behaves as it
 * always has: it closes on confirm and resolves true before anything runs.
 * While the act runs, Escape, a second confirm and a cancel are held; an
 * act that settles after its confirmation was replaced touches nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Code, ConnectError } from "@connectrpc/connect";
import { useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { useConfirmAction } from "../useConfirmAction";
import type { ConfirmOptions } from "../types";

afterEach(cleanup);

/** A deferred promise the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A page with one Remove button that asks first, and records what confirm() answered. */
function Page({ options, answers }: { readonly options: ConfirmOptions; readonly answers: boolean[] }) {
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [, setDone] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          answers.push(await confirm(options));
          setDone((n) => n + 1);
        }}
      >
        Remove Grace
      </button>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </>
  );
}

const BASE: ConfirmOptions = {
  title: "Remove Grace Hopper from acme?",
  description: "Grace loses the Admin role.",
  confirmLabel: "Remove",
  variant: "destructive",
};

describe("ConfirmDialog with an action", () => {
  it("stays open while the act runs: the confirm button waits, Cancel and close are held", async () => {
    const run = deferred();
    const answers: boolean[] = [];
    render(<Page options={{ ...BASE, action: () => run.promise }} answers={answers} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    const confirmButton = screen.getByRole("button", { name: "Remove" });
    expect(confirmButton).toHaveProperty("disabled", true);
    expect(confirmButton.getAttribute("aria-busy")).toBe("true");
    expect(confirmButton.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Remove Grace Hopper from acme?")).toBeTruthy();
    expect(answers).toEqual([]);

    await act(async () => run.resolve());
    await waitFor(() => expect(screen.queryByText("Remove Grace Hopper from acme?")).toBeNull());
    expect(answers).toEqual([true]);
  });

  it("says a failure in the dialog, with the confirm button as Try again, and closes once a retry succeeds", async () => {
    const action = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("grace is the organization's last owner"))
      .mockResolvedValueOnce(undefined);
    const answers: boolean[] = [];
    render(<Page options={{ ...BASE, action, failureTitle: "Couldn't remove Grace Hopper." }} answers={answers} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Couldn't remove Grace Hopper.")).toBeTruthy();
    expect(screen.getByText(/last owner/)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(answers).toEqual([]);

    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByText("Remove Grace Hopper from acme?")).toBeNull());
    expect(action).toHaveBeenCalledTimes(2);
    expect(answers).toEqual([true]);
  });

  it("says what did not change under the failure when the page gives it", async () => {
    const action = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("the server did not answer in time"));
    render(
      <Page
        options={{ ...BASE, action, failureTitle: "Couldn't remove the key.", failureComfort: "The key is still connected." }}
        answers={[]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Couldn't remove the key.")).toBeTruthy();
    expect(screen.getByText("The key is still connected.")).toBeTruthy();
  });

  it("keeps the act's own word, not Try again, on a refusal trying again cannot change", async () => {
    const action = () =>
      Promise.reject(new ConnectError("grace is the organization's last owner", Code.FailedPrecondition));
    render(<Page options={{ ...BASE, action, failureTitle: "Couldn't remove Grace Hopper." }} answers={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Couldn't remove Grace Hopper.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("lets the person cancel after a failure, resolving false", async () => {
    const answers: boolean[] = [];
    render(<Page options={{ ...BASE, action: () => Promise.reject(new Error("refused")) }} answers={answers} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByRole("button", { name: "Try again" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(answers).toEqual([false]));
    expect(screen.queryByText("Remove Grace Hopper from acme?")).toBeNull();
  });

  it("reads a thrown non-Error as a failure too", async () => {
    render(<Page options={{ ...BASE, action: () => Promise.reject("refused") }} answers={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("ConfirmDialog without an action", () => {
  it("closes on confirm and resolves true, as it always has", async () => {
    const answers: boolean[] = [];
    render(<Page options={BASE} answers={answers} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(answers).toEqual([true]));
    expect(screen.queryByText("Remove Grace Hopper from acme?")).toBeNull();
  });

  it("closes on Cancel and resolves false", async () => {
    const answers: boolean[] = [];
    render(<Page options={BASE} answers={answers} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(answers).toEqual([false]));
  });
});

describe("useConfirmAction while an act runs", () => {
  it("holds Escape while the act runs, and lets it close the dialog after a failure", async () => {
    const run = deferred();
    const answers: boolean[] = [];
    render(<Page options={{ ...BASE, action: () => run.promise }} answers={answers} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Grace" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByText("Remove Grace Hopper from acme?").closest("dialog") as HTMLElement;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByText("Remove Grace Hopper from acme?")).toBeTruthy();
    expect(answers).toEqual([]);
    await act(async () => run.reject(new Error("refused")));
    await screen.findByRole("button", { name: "Try again" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(answers).toEqual([false]));
  });

  it("runs the act once however often confirm is pressed, and holds a cancel while it runs", async () => {
    const run = deferred();
    const action = vi.fn(() => run.promise);
    const { result } = renderHook(() => useConfirmAction());
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = result.current.confirm({ ...BASE, action });
    });
    act(() => result.current.handleConfirm());
    act(() => result.current.handleConfirm());
    act(() => result.current.handleCancel());
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.confirmState?.busy).toBe(true);
    await act(async () => run.resolve());
    await expect(answer).resolves.toBe(true);
    expect(result.current.confirmState).toBeNull();
  });

  it("leaves a newer confirmation alone when a replaced one's act settles", async () => {
    const first = deferred();
    const second = deferred();
    const { result } = renderHook(() => useConfirmAction());
    act(() => {
      void result.current.confirm({ ...BASE, title: "First?", action: () => first.promise });
    });
    act(() => result.current.handleConfirm());
    act(() => {
      void result.current.confirm({ ...BASE, title: "Second?", action: () => second.promise });
    });
    await act(async () => first.resolve());
    expect(result.current.confirmState?.title).toBe("Second?");
    act(() => {
      void result.current.confirm({ ...BASE, title: "Third?", action: () => second.promise });
    });
    act(() => result.current.handleConfirm());
    act(() => {
      void result.current.confirm({ ...BASE, title: "Fourth?" });
    });
    await act(async () => second.reject(new Error("refused")));
    expect(result.current.confirmState?.title).toBe("Fourth?");
    expect(result.current.confirmState?.error).toBeUndefined();
  });
});
