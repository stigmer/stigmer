// ---------------------------------------------------------------------------
// The Slack install callback route — hands the popup to the SDK's handler
//
// Slack's "Add to Slack" consent redirects the popup here; the page's whole
// job is to render the React SDK's OAuthCallbackHandler full-height, which
// posts the code and state back to the opener and closes the window. A
// route that drifted to another component, or lost the full-height class
// the popup lays out with, would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  OAuthCallbackHandler: ({ className }: { className?: string }) => (
    <p data-testid="oauth-callback-handler" className={className}>
      oauth callback handler
    </p>
  ),
}));

import SlackOAuthCallbackPage from "../page";

describe("Slack OAuth callback route", () => {
  it("renders the SDK's callback handler at full screen height", () => {
    render(<SlackOAuthCallbackPage />);
    const handler = screen.getByTestId("oauth-callback-handler");
    expect(handler.textContent).toBe("oauth callback handler");
    expect(handler.className).toBe("min-h-screen");
  });
});
