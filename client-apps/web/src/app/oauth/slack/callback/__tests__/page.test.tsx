// ---------------------------------------------------------------------------
// The Slack install callback route — hands the popup to the SDK's handler
//
// Slack's "Add to Slack" consent redirects the popup here; the page's whole
// job is to render the React SDK's OAuthCallbackHandler on the console's
// standalone frame, naming Stigmer as the app to go back to; the handler
// posts the code and state back to the opener and closes the window. A
// route that drifted to another component would show here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@stigmer/react-sdk", () => ({
  OAuthCallbackHandler: ({ appName }: { appName?: string }) => (
    <p data-testid="oauth-callback-handler">oauth callback handler for {appName}</p>
  ),
}));
vi.mock("@stigmer/react-sdk/console", () => ({
  StandaloneScreen: ({ children }: { children?: React.ReactNode }) => <main data-testid="frame">{children}</main>,
}));

import SlackOAuthCallbackPage from "../page";

describe("Slack OAuth callback route", () => {
  it("renders the SDK's callback handler on the console's frame, naming Stigmer", () => {
    render(<SlackOAuthCallbackPage />);
    const handler = screen.getByTestId("oauth-callback-handler");
    expect(handler.textContent).toBe("oauth callback handler for Stigmer");
    expect(screen.getByTestId("frame").contains(handler)).toBe(true);
  });
});
