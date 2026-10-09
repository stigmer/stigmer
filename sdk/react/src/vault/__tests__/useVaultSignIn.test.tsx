/**
 * The shared sign-in at an address: it starts at the address for the
 * destination named (My vault, or a shared vault by id), sends the popup to
 * the login page, and completes with what the callback page handed back; a
 * blocked popup starts nothing; and the start input says where the login
 * page returns (the console, the desktop bridge, or a loopback port).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
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

const popup = vi.hoisted(() => ({ blocked: false, opened: { location: { href: "" }, closed: false, close: () => {} } }));
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => (popup.blocked ? null : popup.opened)),
  popupBlockedError: vi.fn(() => new Error("Your browser blocked the authentication popup.")),
  waitForOAuthCallback: vi.fn(async () => ({ code: "code-1", state: "st-1" })),
  closeOAuthPopup: vi.fn(),
}));

afterEach(() => {
  cleanup();
  popup.blocked = false;
});

function render(started: StartSignInInput[], completed: string[]) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultCommandController, {
        startSignIn: (input) => {
          started.push(input);
          return create(StartSignInOutputSchema, { authorizationUrl: "https://login.example/authorize", state: "st-1" });
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

describe("startSignInInput", () => {
  it("says where the login page returns", () => {
    expect(startSignInInput("github.com", { org: "o" }, { kind: "desktop" }).returnTo).toBe(SignInReturn.desktop);
    const loopback = startSignInInput("github.com", { org: "o" }, { kind: "loopback", port: 17238 });
    expect(loopback.returnTo).toBe(SignInReturn.loopback);
    expect(loopback.loopbackPort).toBe(17238);
    expect(startSignInInput("github.com", { org: "o" }).loopbackPort).toBe(0);
  });
});
