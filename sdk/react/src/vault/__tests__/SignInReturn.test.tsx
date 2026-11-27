/**
 * The page a login page returns a sign-in to: it hands the answer in its
 * address to Stigmer once (the state and the code, or the state and the
 * login page's refusal) and says only what it knows, never "Connected".
 * Pins: a handed-back code says where the person signed in and to go back
 * where they started, and closes the window; a refusal is handed back too
 * and shown in the login page's words, with "Nothing was saved"; a sign-in
 * that expired or was used says so in the server's words; a failure on the
 * way offers a retry, which loads the page again; under StrictMode's double
 * effect the answer is handed back once; a page with no answer, or with both
 * a code and a refusal, hands nothing back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { HandBackSignInOutputSchema, type HandBackSignInInput } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { StigmerContext } from "@stigmer/react-core";
import { SignInReturn } from "../SignInReturn";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** How the server answers the hand-back. */
type Server = "accepts" | "ended" | "unavailable";

function renderAt(search: string, server: Server = "accepts", strict = false) {
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, search, reload });
  const close = vi.fn();
  vi.stubGlobal("close", close);
  const handedBack: HandBackSignInInput[] = [];
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => null,
    customTransport: createRouterTransport(({ service }) => {
      service(VaultCommandController, {
        handBackSignIn: (input) => {
          handedBack.push(input);
          if (server === "ended") {
            throw new ConnectError("this sign-in has expired or was already used: start it again", Code.FailedPrecondition);
          }
          if (server === "unavailable") throw new ConnectError("upstream connect error", Code.Unavailable);
          return create(HandBackSignInOutputSchema, { providerName: "Sentry", address: "https://mcp.sentry.dev/mcp" });
        },
      });
    }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  render(strict ? <StrictMode><SignInReturn /></StrictMode> : <SignInReturn />, { wrapper });
  return { handedBack, close, reload };
}

describe("SignInReturn", () => {
  it("hands the code back, says where the person signed in and to go back, and closes the window", async () => {
    const { handedBack, close } = renderAt("?code=c-1&state=st-1");

    expect(await screen.findByRole("heading", { name: "You're signed in at Sentry" })).toBeTruthy();
    expect(screen.getByText("Go back to where you started; it finishes there.")).toBeTruthy();
    expect(handedBack.map((input) => [input.state, input.code, input.error])).toEqual([["st-1", "c-1", ""]]);
    // The window closes in an effect after the heading renders.
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it("hands a refusal back and shows it in the login page's words", async () => {
    const { handedBack, close } = renderAt("?error=access_denied&error_description=The+user+denied+access&state=st-1");

    expect(await screen.findByText("The sign-in didn't finish.")).toBeTruthy();
    expect(screen.getByText("The login page did not sign you in: The user denied access")).toBeTruthy();
    expect(screen.getByText("Nothing was saved. Go back to where you started and try again.")).toBeTruthy();
    expect(handedBack.map((input) => [input.state, input.code, input.error, input.errorDescription])).toEqual([
      ["st-1", "", "access_denied", "The user denied access"],
    ]);
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it("says a sign-in that expired or was used is over, in the server's words", async () => {
    const { close } = renderAt("?code=c-1&state=st-1", "ended");

    expect(await screen.findByText("The sign-in didn't finish.")).toBeTruthy();
    expect(screen.getByText(/this sign-in has expired or was already used: start it again/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it("offers a retry when the answer failed on the way, which loads the page again", async () => {
    const { reload } = renderAt("?code=c-1&state=st-1", "unavailable");
    expect(await screen.findByText("The sign-in didn't finish.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("hands the answer back once when React runs its effect twice", async () => {
    const { handedBack } = renderAt("?code=c-1&state=st-1", "accepts", true);
    expect(await screen.findByRole("heading", { name: "You're signed in at Sentry" })).toBeTruthy();
    expect(handedBack).toHaveLength(1);
  });

  it.each([
    ["no answer at all", ""],
    ["a code with no state", "?code=c-1"],
    ["both a code and a refusal", "?code=c-1&error=access_denied&state=st-1"],
  ])("hands nothing back for %s", async (_case, search) => {
    const { handedBack } = renderAt(search);
    expect(await screen.findByText(/this page was opened without a sign-in's answer/)).toBeTruthy();
    expect(handedBack).toEqual([]);
  });
});
