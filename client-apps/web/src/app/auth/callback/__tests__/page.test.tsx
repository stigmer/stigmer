// ---------------------------------------------------------------------------
// The sign-in return page — the wait while the console finishes the sign-in
//
// The code exchange runs in the OIDC provider, which draws its own failure;
// this route is the page the browser lands on, so it says what it waits for
// in the kit's sign-in return view.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk/console", () => ({
  SignInReturnView: ({ error }: { error: Error | null }) => (error === null ? <p>Finishing the sign-in…</p> : null),
}));

import OidcCallbackPage from "../page";

describe("the sign-in return page", () => {
  it("says it is finishing the sign-in", () => {
    render(<OidcCallbackPage />);
    expect(screen.getByText("Finishing the sign-in…")).toBeTruthy();
  });
});
