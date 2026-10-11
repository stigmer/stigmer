/**
 * The callback page's handling of a login page's refusal: the page that
 * started the sign-in is told at once, on the broadcast channel and through
 * its opener, with the refusal and the state it belongs to, and the page
 * shows the refusal; a refusal with no state tells no one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OAUTH_BROADCAST_CHANNEL, OAUTH_CALLBACK_MESSAGE_TYPE } from "../../internal/oauthPopup";
import { OAuthCallbackHandler } from "../OAuthCallbackHandler";

const posted: Array<{ channel: string; data: unknown }> = [];

class RecordingBroadcastChannel {
  constructor(private readonly name: string) {}
  postMessage(data: unknown): void {
    posted.push({ channel: this.name, data });
  }
  close(): void {}
}

function at(search: string, opener: unknown) {
  vi.stubGlobal("location", { ...window.location, search });
  vi.stubGlobal("opener", opener);
  vi.stubGlobal("BroadcastChannel", RecordingBroadcastChannel);
}

afterEach(() => {
  cleanup();
  posted.length = 0;
  vi.unstubAllGlobals();
});

describe("OAuthCallbackHandler when the login page refused", () => {
  it("tells the page that started the sign-in at once, and shows the refusal", async () => {
    const opener = { closed: false, postMessage: vi.fn() };
    at("?error=access_denied&error_description=The+user+denied+access&state=st-1", opener);
    render(<OAuthCallbackHandler />);

    const message = { type: OAUTH_CALLBACK_MESSAGE_TYPE, code: "", state: "st-1", error: "The user denied access" };
    expect(await screen.findByText("Authentication failed: The user denied access")).toBeTruthy();
    expect(posted).toEqual([{ channel: OAUTH_BROADCAST_CHANNEL, data: message }]);
    expect(opener.postMessage).toHaveBeenCalledWith(message, window.location.origin);
  });

  it("tells no one a refusal that names no state", async () => {
    const opener = { closed: false, postMessage: vi.fn() };
    at("?error=server_error", opener);
    render(<OAuthCallbackHandler />);

    expect(await screen.findByText("Authentication failed: server_error")).toBeTruthy();
    expect(posted).toEqual([]);
    expect(opener.postMessage).not.toHaveBeenCalled();
  });
});
