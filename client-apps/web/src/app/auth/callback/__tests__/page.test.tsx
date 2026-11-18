// ---------------------------------------------------------------------------
// The sign-in return page — the wait while the console finishes the sign-in
//
// The code exchange runs in the OIDC provider, which draws its own failure;
// this route is the page the browser lands on, so it says what it waits for
// in the kit's sign-in return view.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const view = vi.hoisted(() => ({ onSignInAgain: null as (() => void) | null }));
vi.mock("@stigmer/react-sdk/console", () => ({
  SignInReturnView: ({ error, onSignInAgain }: { error: Error | null; onSignInAgain: () => void }) => {
    view.onSignInAgain = onSignInAgain;
    return error === null ? <p>Finishing the sign-in…</p> : null;
  },
}));

import OidcCallbackPage from "../page";

describe("the sign-in return page", () => {
  it("says it is finishing the sign-in", () => {
    render(<OidcCallbackPage />);
    expect(screen.getByText("Finishing the sign-in…")).toBeTruthy();
  });

  it("starts over at the sign-in page when asked to sign in again", () => {
    const replace = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, replace } });
    try {
      render(<OidcCallbackPage />);
      view.onSignInAgain?.();
      expect(replace).toHaveBeenCalledWith("/login");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
