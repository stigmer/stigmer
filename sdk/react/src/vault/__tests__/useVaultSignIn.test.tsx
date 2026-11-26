/**
 * The shared sign-in at an address: it starts at the address for the
 * destination named (My vault, or a shared vault by id), sends the popup to
 * the login page, and finishes by asking the server with the sign-in's
 * state and no code; a blocked popup starts nothing; a login page that is
 * not an https address is never visited; the login page's refusal says why,
 * closes the popup and goes idle; cancelling mid-sign-in ends the wait,
 * closes the popup and records no error; and the start input says where the
 * login page returns (the console, the desktop bridge, or a loopback port).
 *
 * The asking itself ({@link awaitSignIn}): every second for the first half
 * minute, then every two; a transient failure is asked again and never ends
 * the wait; a refusal with SIGN_IN_ENDED right after a failed ask reports
 * that ask's failure (it took the sign-in), and on its own ends the wait as
 * itself; an abort ends it with an AbortError.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer, StigmerError } from "@stigmer/client";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import {
  CompleteSignInOutputSchema,
  SignInReturn,
  StartSignInOutputSchema,
  type CompleteSignInInput,
  type CompleteSignInOutput,
  type StartSignInInput,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { StigmerContext } from "@stigmer/react-core";
import { AbortError } from "@stigmer/react-core/internal";
import { SIGN_IN_ENDED, awaitSignIn, startSignInInput, useVaultSignIn } from "../useVaultSignIn";

const popup = vi.hoisted(() => ({
  blocked: false,
  opened: { location: { href: "" }, closed: false, close: () => {} },
}));
const popupModule = vi.hoisted(() => ({
  closeOAuthPopup: vi.fn(),
}));
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => (popup.blocked ? null : popup.opened)),
  popupBlockedError: vi.fn(() => new Error("Your browser blocked the authentication popup.")),
  closeOAuthPopup: popupModule.closeOAuthPopup,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  popup.blocked = false;
  popupModule.closeOAuthPopup.mockClear();
});

const SAVED = create(CompleteSignInOutputSchema, {
  address: "https://mcp.linear.app/mcp",
  description: "Signed in at mcp.linear.app",
});
const PENDING = create(CompleteSignInOutputSchema, { pending: true });

/** How the server answers each ask: the saved login, pending for ever, or the login page's refusal. */
type Server = "saved" | "pending" | "refused";

function render(started: StartSignInInput[], asked: string[], server: Server = "saved", loginPage = "https://login.example/authorize") {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultCommandController, {
        startSignIn: (input) => {
          started.push(input);
          return create(StartSignInOutputSchema, { authorizationUrl: loginPage, state: "st-1" });
        },
        completeSignIn: (input) => {
          asked.push(`${input.state}:${input.code}`);
          if (server === "refused") {
            throw new ConnectError("The login page did not sign you in: access_denied. Nothing was saved", Code.FailedPrecondition);
          }
          return server === "pending" ? PENDING : SAVED;
        },
      });
    }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return renderHook(() => useVaultSignIn(), { wrapper });
}

describe("useVaultSignIn", () => {
  it("signs in at the address into My vault, then a shared vault by id, finishing by asking with no code", async () => {
    const started: StartSignInInput[] = [];
    const asked: string[] = [];
    const { result } = render(started, asked);

    let saved: Awaited<ReturnType<typeof result.current.signIn>> | undefined;
    await act(async () => {
      saved = await result.current.signIn("https://mcp.linear.app/mcp", { org: "org_acme" });
    });
    expect(started[0]).toMatchObject({
      address: "https://mcp.linear.app/mcp",
      vault: { org: "org_acme", vault: { case: "mine", value: true } },
      returnTo: SignInReturn.web,
    });
    expect(popup.opened.location.href).toBe("https://login.example/authorize");
    expect(asked).toEqual(["st-1:"]);
    expect(saved?.description).toBe("Signed in at mcp.linear.app");
    expect(result.current.phase).toBe("done");

    await act(async () => {
      await result.current.signIn("github.com", { org: "org_acme", vaultId: "vlt_team" });
    });
    expect(started[1]).toMatchObject({ address: "github.com", vault: { vault: { case: "id", value: "vlt_team" } } });
  });

  it("starts nothing when the browser blocks the popup", async () => {
    popup.blocked = true;
    const started: StartSignInInput[] = [];
    const { result } = render(started, []);
    await act(async () => {
      await expect(result.current.signIn("github.com", { org: "org_acme" })).rejects.toThrow(/blocked/);
    });
    expect(started).toEqual([]);
    expect(result.current.error?.message).toMatch(/blocked/);
  });
});

describe("useVaultSignIn when the sign-in does not finish", () => {
  it("never sends the popup to a login page that is not an https address", async () => {
    popup.opened.location.href = "";
    const asked: string[] = [];
    const { result } = render([], asked, "saved", "javascript:alert(document.domain)//");
    await act(async () => {
      await expect(result.current.signIn("github.com", { org: "org_acme" })).rejects.toThrow(
        "The login page's address is not an https address",
      );
    });
    expect(popup.opened.location.href).toBe("");
    expect(asked).toEqual([]);
    expect(popupModule.closeOAuthPopup).toHaveBeenCalledWith(popup.opened);
  });

  it("the login page's refusal says why, closes the popup and goes idle", async () => {
    const { result } = render([], [], "refused");
    await act(async () => {
      await expect(result.current.signIn("github.com", { org: "org_acme" })).rejects.toThrow("access_denied");
    });
    expect(result.current.error?.message).toContain("The login page did not sign you in: access_denied");
    expect(result.current.phase).toBe("idle");
    expect(popupModule.closeOAuthPopup).toHaveBeenCalledWith(popup.opened);
  });

  it("cancelling mid-sign-in ends the wait, closes the popup and records no error", async () => {
    const asked: string[] = [];
    const { result } = render([], asked, "pending");
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.signIn("github.com", { org: "org_acme" }).catch((err: unknown) => err);
    });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(result.current.phase).toBe("awaiting-callback");
    act(() => result.current.clearError());
    expect(((await pending) as Error).message).toBe("The sign-in was cancelled.");
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(popupModule.closeOAuthPopup).toHaveBeenCalledWith(popup.opened);
  });
});

/** The refusal of a sign-in that is over, as the client hands it over: its reason in an ErrorInfo. */
function signInEnded(): StigmerError {
  const message = "this sign-in has expired or was already used: start it again";
  const cause = new ConnectError(message, Code.FailedPrecondition, undefined, [
    { desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason: SIGN_IN_ENDED, domain: "stigmer.ai" }) },
  ]);
  return new StigmerError("failed-precondition", message, Code.FailedPrecondition, { cause });
}

function unavailable(message: string): StigmerError {
  return new StigmerError("unavailable", message, Code.Unavailable);
}

/**
 * A server answering each ask with the next of `answers` (an output, or an
 * error thrown) and the last one after, recording when each ask came.
 */
function askedServer(answers: ReadonlyArray<CompleteSignInOutput | Error>) {
  const asks: Array<{ at: number; input: CompleteSignInInput }> = [];
  const stigmer = {
    vault: {
      completeSignIn: async (input: CompleteSignInInput) => {
        asks.push({ at: Date.now(), input });
        const answer = answers[Math.min(asks.length, answers.length) - 1];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  } as unknown as Parameters<typeof awaitSignIn>[0];
  return { stigmer, asks };
}

/** Runs the wait on the fake clock until it settles. */
async function settled<T>(wait: Promise<T>): Promise<T> {
  const outcome = wait.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

describe("awaitSignIn", () => {
  it("asks every second for the first half minute, then every two, until the login is saved", async () => {
    vi.useFakeTimers({ now: 0 });
    const answers: CompleteSignInOutput[] = [...Array<CompleteSignInOutput>(32).fill(PENDING), SAVED];
    const { stigmer, asks } = askedServer(answers);

    await expect(settled(awaitSignIn(stigmer, "st-1", new AbortController().signal))).resolves.toBe(SAVED);
    expect(asks.every((ask) => ask.input.state === "st-1" && ask.input.code === "")).toBe(true);
    const gaps = asks.slice(1).map((ask, i) => ask.at - asks[i]!.at);
    expect(gaps.slice(0, 30)).toEqual(Array<number>(30).fill(1000));
    expect(gaps.slice(30)).toEqual([2000, 2000]);
  });

  it("asks again after a transient failure, and never ends the wait on one", async () => {
    vi.useFakeTimers({ now: 0 });
    const { stigmer, asks } = askedServer([unavailable("server restarting"), new TypeError("Failed to fetch"), PENDING, SAVED]);
    await expect(settled(awaitSignIn(stigmer, "st-1", new AbortController().signal))).resolves.toBe(SAVED);
    expect(asks).toHaveLength(4);
  });

  it("reports the failed ask that took the sign-in, not that the sign-in ended", async () => {
    vi.useFakeTimers({ now: 0 });
    // The exchange failed at the login server (UNAVAILABLE); that ask took the sign-in.
    const exchange = unavailable("token exchange failed: invalid_grant");
    const { stigmer } = askedServer([PENDING, exchange, signInEnded()]);
    await expect(settled(awaitSignIn(stigmer, "st-1", new AbortController().signal))).rejects.toBe(exchange);
  });

  it("ends with the refusal itself when the sign-in ended with no failure before it", async () => {
    vi.useFakeTimers({ now: 0 });
    const ended = signInEnded();
    const { stigmer } = askedServer([PENDING, ended]);
    await expect(settled(awaitSignIn(stigmer, "st-1", new AbortController().signal))).rejects.toBe(ended);
  });

  it("ends a wait that is not transient in the server's words, after a pending ask cleared any failure", async () => {
    vi.useFakeTimers({ now: 0 });
    const refused = new StigmerError("failed-precondition", "The login page did not sign you in. Nothing was saved", Code.FailedPrecondition);
    const { stigmer } = askedServer([unavailable("blip"), PENDING, refused]);
    await expect(settled(awaitSignIn(stigmer, "st-1", new AbortController().signal))).rejects.toBe(refused);
  });

  it("ends with an AbortError when cancelled", async () => {
    vi.useFakeTimers({ now: 0 });
    const cancel = new AbortController();
    const { stigmer, asks } = askedServer([PENDING]);
    const wait = awaitSignIn(stigmer, "st-1", cancel.signal).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(2500);
    cancel.abort();
    expect(await wait).toBeInstanceOf(AbortError);
    expect(asks).toHaveLength(3);
  });
});

describe("startSignInInput", () => {
  it("says where the login page returns", () => {
    expect(startSignInInput("github.com", { org: "o" }, { kind: "desktop" }).returnTo).toBe(SignInReturn.desktop);
    const loopback = startSignInInput("github.com", { org: "o" }, { kind: "loopback", port: 17238 });
    expect(loopback.returnTo).toBe(SignInReturn.loopback);
    expect(loopback.loopbackPort).toBe(17238);
    expect(startSignInInput("github.com", { org: "o" }).loopbackPort).toBe(0);
  });
});
