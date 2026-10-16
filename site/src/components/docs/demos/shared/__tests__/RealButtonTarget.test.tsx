/**
 * `RealButtonTarget`, the wrapper a plugin demo puts around a real
 * `@stigmer/react-sdk` page so its cursor can point at, and press, a button the
 * page draws with no cursor target of its own.
 *
 * Pins: the button whose accessible name matches (its `aria-label`, else its
 * text) gets the cursor target, and no other button does; a button that only
 * appears once the page fills in is found when it renders; with `press`, the
 * button is clicked exactly once, not while it is disabled, and again only
 * when the wrapper remounts; without `press`, it is never clicked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { RealButtonTarget } from "../RealButtonTarget";

afterEach(cleanup);

/** A page whose buttons count their clicks, as a real hook's RPC would fire. */
function CountingPage({ disabled = false }: { readonly disabled?: boolean }) {
  const [checks, setChecks] = useState(0);
  return (
    <div>
      <button type="button">Back</button>
      <button type="button" aria-label="Sign in to github">
        Sign in
      </button>
      <button type="button" disabled={disabled} onClick={() => setChecks((n) => n + 1)}>
        {" Check tools "}
      </button>
      <p>checks: {checks}</p>
    </div>
  );
}

/** A page that draws its button only once its data arrives. */
function LoadingPage({ loaded }: { readonly loaded: boolean }) {
  const [checks, setChecks] = useState(0);
  return loaded ? (
    <div>
      <button type="button" onClick={() => setChecks((n) => n + 1)}>
        Check tools
      </button>
      <p>checks: {checks}</p>
    </div>
  ) : (
    <p>Loading…</p>
  );
}

describe("RealButtonTarget", () => {
  it("tags the button its label names, by aria-label or by text, and nothing else", () => {
    render(
      <RealButtonTarget label="Sign in to github" target="sign-in-button">
        <CountingPage />
      </RealButtonTarget>,
    );
    expect(screen.getByRole("button", { name: "Sign in to github" }).getAttribute("data-cursor-target")).toBe(
      "sign-in-button",
    );
    expect(screen.getByRole("button", { name: "Back" }).hasAttribute("data-cursor-target")).toBe(false);
    expect(screen.getByRole("button", { name: "Check tools" }).hasAttribute("data-cursor-target")).toBe(false);
    expect(screen.getByText("checks: 0")).toBeTruthy();
  });

  it("presses the named button once when asked, matching its trimmed text", async () => {
    render(
      <RealButtonTarget label="Check tools" target="check-tools" press>
        <CountingPage />
      </RealButtonTarget>,
    );
    expect(screen.getByRole("button", { name: "Check tools" }).getAttribute("data-cursor-target")).toBe("check-tools");
    expect(await screen.findByText("checks: 1")).toBeTruthy();
  });

  it("finds a button that renders later, and presses it then", async () => {
    const { rerender } = render(
      <RealButtonTarget label="Check tools" target="check-tools" press>
        <LoadingPage loaded={false} />
      </RealButtonTarget>,
    );
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <RealButtonTarget label="Check tools" target="check-tools" press>
        <LoadingPage loaded />
      </RealButtonTarget>,
    );

    expect(await screen.findByText("checks: 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check tools" }).getAttribute("data-cursor-target")).toBe("check-tools");
    // The page re-rendering after the press does not press it again.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("checks: 1")).toBeTruthy();
  });

  it("waits while the button is disabled, and presses it once it is enabled", async () => {
    const { rerender } = render(
      <RealButtonTarget label="Check tools" target="check-tools" press>
        <CountingPage disabled />
      </RealButtonTarget>,
    );
    expect(screen.getByText("checks: 0")).toBeTruthy();

    // Enabling the button changes an attribute only; a later child render
    // lets the wrapper see it.
    rerender(
      <RealButtonTarget label="Check tools" target="check-tools" press>
        <div>
          <CountingPage />
          <span>ready</span>
        </div>
      </RealButtonTarget>,
    );
    expect(await screen.findByText("checks: 1")).toBeTruthy();
  });

  it("presses again only when it remounts, the way a scenario replays a beat", async () => {
    const { rerender } = render(
      <RealButtonTarget key="first" label="Check tools" target="check-tools" press>
        <CountingPage />
      </RealButtonTarget>,
    );
    expect(await screen.findByText("checks: 1")).toBeTruthy();

    rerender(
      <RealButtonTarget key="second" label="Check tools" target="check-tools" press>
        <CountingPage />
      </RealButtonTarget>,
    );
    // A fresh mount draws a fresh page, which the wrapper presses once.
    expect(await screen.findByText("checks: 1")).toBeTruthy();
  });

  it("never presses without press, and stops watching once unmounted", async () => {
    const { unmount } = render(
      <RealButtonTarget label="Check tools" target="check-tools">
        <CountingPage />
      </RealButtonTarget>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("checks: 0")).toBeTruthy();
    unmount();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
