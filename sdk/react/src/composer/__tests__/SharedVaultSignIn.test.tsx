/**
 * The composer's Sign in row for a run that never reads My vault: it saves
 * the login in the shared vault the panel chose, never in My vault. Pins:
 * Sign in starts at the pending sign-in's address with that vault's
 * organization and id as the destination, and once the login lands tells
 * the composer the address it was saved at; a start the server refuses
 * (the person may no longer edit the vault) shows the server's words in
 * the row and tells the composer nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import {
  CompleteSignInOutputSchema,
  StartSignInOutputSchema,
  type StartSignInInput,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { StigmerContext } from "@stigmer/react-core";
import { SharedVaultSignIn } from "../SharedVaultSignIn";

const popup = vi.hoisted(() => ({
  opened: { location: { href: "" }, closed: false, close: () => {} },
}));
vi.mock("../../internal/oauthPopup.js", () => ({
  openOAuthPopup: vi.fn(() => popup.opened),
  popupBlockedError: vi.fn(() => new Error("Your browser blocked the authentication popup.")),
  waitForOAuthCallback: vi.fn(async () => ({ code: "code-1", state: "st-1" })),
  closeOAuthPopup: vi.fn(),
}));

afterEach(cleanup);

const LINEAR_ADDRESS = "https://mcp.linear.app/mcp";
const LINEAR = {
  plugin: { org: "org_globex", slug: "linear" },
  pluginName: "linear",
  server: create(McpServerEntrySchema, { name: "linear", transport: { case: "http", value: { url: LINEAR_ADDRESS } }, signIn: {} }),
  address: LINEAR_ADDRESS,
  name: "Linear",
};
const TEAM = { org: "org_acme", id: "vlt_team", name: "Team logins" };

function renderRow(started: StartSignInInput[], onSignedIn: (address: string) => void, refuse = false) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(VaultCommandController, {
        startSignIn: (input) => {
          started.push(input);
          if (refuse) throw new ConnectError("unauthorized to save a sign-in in this vault", Code.PermissionDenied);
          return create(StartSignInOutputSchema, { authorizationUrl: "https://login.example/authorize", state: "st-1" });
        },
        completeSignIn: () => create(CompleteSignInOutputSchema, { address: LINEAR_ADDRESS, description: "Signed in at mcp.linear.app" }),
      });
    }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return render(<SharedVaultSignIn signIn={LINEAR} vault={TEAM} onSignedIn={onSignedIn} />, { wrapper });
}

describe("SharedVaultSignIn", () => {
  it("saves the login in the chosen shared vault and reports the address", async () => {
    const started: StartSignInInput[] = [];
    const onSignedIn = vi.fn();
    renderRow(started, onSignedIn);

    expect(screen.getByText("Not signed in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to linear" }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(LINEAR_ADDRESS));
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      address: LINEAR_ADDRESS,
      vault: { org: "org_acme", vault: { case: "id", value: "vlt_team" } },
    });
  });

  it("shows the server's refusal in the row and reports nothing", async () => {
    const onSignedIn = vi.fn();
    renderRow([], onSignedIn, true);

    fireEvent.click(screen.getByRole("button", { name: "Sign in to linear" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/unauthorized to save a sign-in in this vault/);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in to linear" })).toBeTruthy();
  });
});
