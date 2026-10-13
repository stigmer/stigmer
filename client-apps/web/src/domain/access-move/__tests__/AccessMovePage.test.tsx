// ---------------------------------------------------------------------------
// The access move's first half, its SSO starter and its refusal screen
//
// AccessMovePage asks for the ticket once for the organization the URL
// names, shows what the move will do, and on "Continue" keeps the ticket in
// this tab and starts the provider's sign-in, landing on the finish page; a
// refused ask says why; no organization asks nothing. startSsoLogin records
// the provider for the callback and where to land. The error boundaries
// answer an SSO_REQUIRED refusal with the sign-in notice instead of
// "Access denied".
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

const mocks = vi.hoisted(() => ({
  org: "org_acme" as string | null,
  asked: [] as string[],
  refuse: false,
  redirects: [] as Array<{ issuer: string; extra: unknown }>,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(mocks.org === null ? "" : `org=${mocks.org}`),
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: (config: { issuer: string }) => ({
    signinRedirect: (options: { extraQueryParams: unknown }) => {
      mocks.redirects.push({
        issuer: config.issuer,
        extra: options.extraQueryParams,
      });
      return Promise.resolve();
    },
  }),
}));
vi.mock("@stigmer/react", async (original) => {
  const { create: make } = await import("@bufbuild/protobuf");
  const io =
    await import("@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb");
  return {
    ...(await original<typeof import("@stigmer/react")>()),
    useCreateAccessMove: () => ({
      createMove: (org: string) => {
        mocks.asked.push(org);
        return mocks.refuse
          ? Promise.reject(new Error("refused"))
          : Promise.resolve(
              make(io.AccessMoveTicketSchema, {
                ticket: "tkt_secret",
                org,
                provider: {
                  displayName: "Acme Okta",
                  issuer: "https://acme.okta.test",
                  oidcClientId: "client",
                  expectedAudience: "api://acme",
                },
                preview: { movedPolicies: 2 },
              }),
            );
      },
      isCreating: false,
      error: mocks.refuse
        ? new Error("You hold no access in this organization to move")
        : null,
      clearError: () => {},
    }),
    useRedeemAccessMove: () => ({
      redeem: () => Promise.reject(new Error("no ticket")),
      isRedeeming: false,
      error: null,
    }),
    AccessMoveSummary: () => <div data-testid="summary" />,
    SsoRequiredNotice: ({
      moveHref,
      onSignIn,
    }: {
      moveHref: (org: string) => string;
      onSignIn: (
        provider: {
          issuer: string;
          oidcClientId: string;
          expectedAudience: string;
        },
        org: string,
      ) => void;
    }) => (
      <div>
        <a href={moveHref("org_acme")}>Bring my access with me</a>
        <button
          type="button"
          onClick={() =>
            onSignIn(
              {
                issuer: "https://acme.okta.test",
                oidcClientId: "client",
                expectedAudience: "",
              },
              "org_acme",
            )
          }
        >
          Sign in with Acme Okta
        </button>
      </div>
    ),
  };
});

import { AccessMovePage, FINISH_PATH } from "../AccessMovePage";
import { readPendingMove } from "../move-ticket";
import { getSsoLoginState } from "@/auth/oidc/sso-session";
import { REDIRECT_PATH_KEY } from "@/auth/oidc/start-sso-login";
import RootError from "@/app/error";
import SettingsError from "@/app/settings/error";
import AccessMoveRoute from "@/app/sso/move/page";
import AccessMoveFinishRoute from "@/app/sso/move/finish/page";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  mocks.org = "org_acme";
  mocks.asked = [];
  mocks.refuse = false;
  mocks.redirects = [];
});

describe("AccessMovePage", () => {
  it("asks once, shows the move, and continues to the provider with the ticket kept in the tab", async () => {
    render(<AccessMovePage />);
    expect(await screen.findByTestId("summary")).toBeTruthy();
    expect(mocks.asked).toEqual(["org_acme"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Acme Okta" }),
    );
    expect(readPendingMove()).toEqual({
      ticket: "tkt_secret",
      org: "org_acme",
    });
    expect(sessionStorage.getItem(REDIRECT_PATH_KEY)).toBe(FINISH_PATH);
    expect(getSsoLoginState()).toMatchObject({
      issuer: "https://acme.okta.test",
      org: "org_acme",
    });
    expect(mocks.redirects).toEqual([
      { issuer: "https://acme.okta.test", extra: { audience: "api://acme" } },
    ]);
  });

  it("says why a refused ask was refused", async () => {
    mocks.refuse = true;
    render(<AccessMovePage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "You hold no access in this organization to move",
    );
  });

  it("asks nothing when no organization is named", () => {
    mocks.org = null;
    render(<AccessMovePage />);
    expect(screen.getByText("No organization was named.")).toBeTruthy();
    expect(mocks.asked).toEqual([]);
  });

  it("is served by its routes", async () => {
    render(<AccessMoveRoute />);
    expect(await screen.findByTestId("summary")).toBeTruthy();
    cleanup();
    render(<AccessMoveFinishRoute />);
    expect(await screen.findByText(/There is no move to finish/)).toBeTruthy();
  });
});

describe("the move's ticket in the tab", () => {
  it("reads none from what is not a ticket", () => {
    sessionStorage.setItem("stigmer:access-move:ticket", "not json");
    expect(readPendingMove()).toBeNull();
    sessionStorage.setItem("stigmer:access-move:ticket", "null");
    expect(readPendingMove()).toBeNull();
    sessionStorage.setItem(
      "stigmer:access-move:ticket",
      JSON.stringify({ ticket: "", org: "org_acme" }),
    );
    expect(readPendingMove()).toBeNull();
  });
});

describe("the error boundaries on an organization's sign-in requirement", () => {
  const refusal = new ConnectError(
    "This organization requires you to sign in through Acme Okta.",
    Code.PermissionDenied,
    undefined,
    [
      {
        desc: ErrorInfoSchema,
        value: create(ErrorInfoSchema, {
          reason: "SSO_REQUIRED",
          domain: "stigmer.ai",
          metadata: { org: "org_acme", provider: "acme-okta" },
        }),
      },
    ],
  );

  it.each([
    ["the root boundary", RootError],
    ["the settings boundary", SettingsError],
  ])("%s offers the way in instead of 'Access denied'", (_name, Boundary) => {
    render(<Boundary error={refusal} reset={() => {}} />);
    expect(
      screen
        .getByRole("link", { name: "Bring my access with me" })
        .getAttribute("href"),
    ).toBe("/sso/move?org=org_acme");
    expect(screen.queryByText("Access denied")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with Acme Okta" }),
    );
    expect(mocks.redirects).toEqual([
      { issuer: "https://acme.okta.test", extra: {} },
    ]);
    expect(sessionStorage.getItem(REDIRECT_PATH_KEY)).toBe(
      `${window.location.pathname}${window.location.search}`,
    );
  });
});
