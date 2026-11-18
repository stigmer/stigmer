/**
 * Pins the console's sign-in screens: the sign-in in its five states (ready,
 * the sign-in page on another site named before the person goes on, handing
 * off to create an account, waiting for the browser with Reopen and Cancel,
 * and a failure said in plain words with Try again); the return from the
 * sign-in page (the wait, then the failure with Sign in again); and the
 * page that hands the browser back to the desktop app with its way back.
 * The sign-in screen ends with the deployment's help line (CON-13).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, type ConnectRouter } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { StigmerProvider } from "../../provider";
import { SignInView } from "../SignInView";
import { SignInReturnView } from "../SignInReturnView";
import { AppHandoffView } from "../AppHandoffView";

afterEach(cleanup);

describe("SignInView", () => {
  it("names where the person signs in, with one Sign in", () => {
    const onSignIn = vi.fn();
    render(<SignInView state={{ status: "ready" }} serverName="Stigmer" onSignIn={onSignIn} />);
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to Stigmer" })).toBeTruthy();
    expect(screen.getByText("You'll continue on your sign-in page, then come straight back here.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Use another server" })).toBeNull();
  });

  it("names a sign-in page on another site before the person goes on", () => {
    render(
      <SignInView
        state={{ status: "ready" }}
        serverName="Acme"
        lead="stigmer.acme.example"
        onSignIn={() => {}}
        onUseAnotherServer={() => {}}
        elsewhere={{ server: "stigmer.acme.example", provider: "login.othercorp.example" }}
      />,
    );
    expect(screen.getByText("stigmer.acme.example signs people in at login.othercorp.example, on another site.")).toBeTruthy();
    expect(screen.getByText("Go on only if you trust stigmer.acme.example with your login.othercorp.example account.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in at login.othercorp.example" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use another server" })).toBeTruthy();
  });

  it("says it is taking the person to create an account", () => {
    render(<SignInView state={{ status: "handing-off" }} serverName="Stigmer" onSignIn={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Taking you to create your account…");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("waits for the browser, with Reopen the browser and Cancel", () => {
    const onReopen = vi.fn();
    const onCancel = vi.fn();
    render(<SignInView state={{ status: "waiting" }} serverName="Acme" onSignIn={() => {}} onReopen={onReopen} onCancel={onCancel} />);
    expect(screen.getByRole("heading", { name: "Finish signing in in your browser" })).toBeTruthy();
    expect(screen.getByText("Your browser opened Acme's sign-in page. Come back here when it's done.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen the browser" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReopen).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("says a sign-in that couldn't start in plain words, and tries again", () => {
    const onSignIn = vi.fn();
    render(
      <SignInView state={{ status: "failed", error: new Error("Failed to fetch") }} serverName="Stigmer" onSignIn={onSignIn} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stigmer couldn't start the sign-in.");
    expect(alert.textContent).toContain("Nothing changed in your account.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("takes the host's own headline for a sign-in that didn't finish", () => {
    render(
      <SignInView
        state={{ status: "failed", error: new Error("closed"), headline: "The sign-in didn't finish." }}
        serverName="Acme"
        onSignIn={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("The sign-in didn't finish.");
  });
});

describe("CON-13 the sign-in screen's help line", () => {
  it("offers the deployment's help link under Sign in", async () => {
    const client = new Stigmer({
      baseUrl: "/",
      getAccessToken: () => null,
      customTransport: createRouterTransport((router: ConnectRouter) => {
        router.service(PlatformQueryController, {
          getServerInfo: () =>
            create(GetServerInfoOutputSchema, {
              edition: ServerEdition.cloud,
              version: "dev",
              help: { url: "https://help.acme.example/stigmer", label: "Ask the platform team" },
            }),
        });
      }),
    });
    render(
      <StigmerProvider client={client}>
        <SignInView state={{ status: "ready" }} serverName="Stigmer" onSignIn={() => {}} />
      </StigmerProvider>,
    );
    const help = await screen.findByRole("link", { name: "Ask the platform team" });
    expect(help.getAttribute("href")).toBe("https://help.acme.example/stigmer");
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("SignInReturnView", () => {
  it("says it is finishing the sign-in", () => {
    render(<SignInReturnView error={null} onSignInAgain={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Finishing the sign-in…");
  });

  it("says the sign-in didn't finish, and signs in again", () => {
    const onSignInAgain = vi.fn();
    render(<SignInReturnView error={new Error("No matching state found in storage")} onSignInAgain={onSignInAgain} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The sign-in didn't finish.");
    expect(alert.textContent).toContain("Nothing changed in your account.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(onSignInAgain).toHaveBeenCalledTimes(1);
  });
});

describe("AppHandoffView", () => {
  it("says what happened and keeps the way back to the app", () => {
    render(
      <AppHandoffView
        title="Your card is saved"
        lead="Go back to Stigmer Desktop to carry on. You can close this tab."
        href="stigmer://billing/return"
        actLabel="Open Stigmer Desktop"
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Your card is saved" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Stigmer Desktop" }).getAttribute("href")).toBe("stigmer://billing/return");
  });

  it("draws only its wait while the browser hands back", () => {
    render(<AppHandoffView wait="Going back to Stigmer Desktop…" />);
    expect(screen.getByRole("status").textContent).toBe("Going back to Stigmer Desktop…");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
