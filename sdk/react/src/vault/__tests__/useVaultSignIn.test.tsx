/**
 * The shared sign-in at an address: it starts at the address for the
 * destination named (My vault, or a shared vault by id), sends the popup to
 * the login page, and completes with what the callback page handed back; a
 * blocked popup starts nothing; a login page that is not an https address
 * is never visited; a failed callback says why, closes the
 * popup and goes idle; clearing the error mid-sign-in cancels the wait and
 * records nothing; and the start input says where the login page returns
 * (the console, the desktop bridge, or a loopback port).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import {
  CompleteSignInOutputSchema,
  SignInReturn,
  StartSignInOutputSchema,
  type StartSignInInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { StigmerContext } from "../../context";
import { startSignInInput, useVaultSignIn } from "../useVaultSignIn";

const popup = vi.hoisted(() => ({
  blocked: false,
  /** How the callback wait ends: with the code, with the login page's error, or only when cancelled. */
  callback: "code" as "code" | "error" | "until-cancelled",
  opened: { location: { href: "" }, closed: false, close: () => {} },
}));
const popupModule = vi.hoisted(() => ({
  closeOAuthPopup: vi.fn(),
}));
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => (popup.blocked ? null : popup.opened)),
  popupBlockedError: vi.fn(() => new Error("Your browser blocked the authentication popup.")),
  waitForOAuthCallback: vi.fn(
    (_popup: unknown, _state: string, onDispose: (dispose: () => void) => void) =>
      new Promise((resolve, reject) => {
        onDispose(() => reject(new Error("cancelled")));
        if (popup.callback === "code") resolve({ code: "code-1", state: "st-1" });
        if (popup.callback === "error") reject(new Error("access_denied: the person declined"));
      }),
  ),
  closeOAuthPopup: popupModule.closeOAuthPopup,
}));

afterEach(() => {
  cleanup();
  popup.blocked = false;
  popup.callback = "code";
  popupModule.closeOAuthPopup.mockClear();
});

function render(started: StartSignInInput[], completed: string[], loginPage = "https://login.example/authorize") {
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
          completed.push(`${input.state}:${input.code}`);
          return create(CompleteSignInOutputSchema, { address: "https://mcp.linear.app/mcp", description: "Signed in at mcp.linear.app" });
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
  it("signs in at the address into My vault, then a shared vault by id", async () => {
    const started: StartSignInInput[] = [];
    const completed: string[] = [];
    const { result } = render(started, completed);

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
    expect(completed).toEqual(["st-1:code-1"]);
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
    const completed: string[] = [];
    const { result } = render([], completed, "javascript:alert(document.domain)//");
    await act(async () => {
      await expect(result.current.signIn("github.com", { org: "org_acme" })).rejects.toThrow(
        "The login page's address is not an https address",
      );
    });
    expect(popup.opened.location.href).toBe("");
    expect(completed).toEqual([]);
    expect(popupModule.closeOAuthPopup).toHaveBeenCalledWith(popup.opened);
  });

  it("a failed callback says why, closes the popup and goes idle", async () => {
    popup.callback = "error";
    const { result } = render([], []);
    await act(async () => {
      await expect(result.current.signIn("github.com", { org: "org_acme" })).rejects.toThrow("access_denied");
    });
    expect(result.current.error?.message).toContain("access_denied");
    expect(result.current.phase).toBe("idle");
    expect(popupModule.closeOAuthPopup).toHaveBeenCalledWith(popup.opened);
  });

  it("clearing the error mid-sign-in cancels the wait and records nothing", async () => {
    popup.callback = "until-cancelled";
    const completed: string[] = [];
    const { result } = render([], completed);
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.signIn("github.com", { org: "org_acme" }).catch((err: unknown) => err);
    });
    await waitFor(() => expect(result.current.phase).toBe("awaiting-callback"));
    act(() => result.current.clearError());
    expect(await pending).toBeInstanceOf(Error);
    expect(result.current.phase).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(completed).toEqual([]);
    expect(popupModule.closeOAuthPopup).not.toHaveBeenCalled();
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
