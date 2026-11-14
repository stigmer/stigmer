/**
 * Pins where the console shows its server's help link (CON-13 on the UX
 * bar): the operator's address and words, from `getServerInfo`'s `help`.
 *
 *   - `useHelpLink` reads it, and reads nothing from a server that set none;
 *   - `HelpLink` draws a sidebar row or a "Stuck?" line, a web address in a
 *     new tab and a mail address in place, and nothing without a link;
 *   - a failed notice ends with the line only when the host turned it on
 *     (`StigmerProvider`'s `showHelpLink`): a builder's app, which leaves it
 *     off, never shows the server operator's help, and reads no server for it;
 *   - paused and plain notices never draw it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { StigmerProvider } from "../../provider";
import { useHelpLink } from "../../server-info";
import { ErrorMessage } from "../../error/ErrorMessage";
import { Notice } from "../../internal/surface/Notice";
import { HelpLink } from "../HelpLink";

afterEach(cleanup);

const ACME = { url: "https://help.acme.example/stigmer", label: "Ask IT on Slack" };

/** A client whose server announces `help` (or none), counting its getServerInfo reads. */
function clientWith(help: { url: string; label: string } | undefined) {
  const reads = vi.fn();
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport((router: ConnectRouter) => {
      router.service(PlatformQueryController, {
        getServerInfo: () => {
          reads();
          return create(GetServerInfoOutputSchema, {
            edition: ServerEdition.cloud,
            version: "dev",
            ...(help !== undefined ? { help } : {}),
          });
        },
      });
    }),
  });
  return { client, reads };
}

function inConsole(help: { url: string; label: string } | undefined, ui: ReactNode, showHelpLink = true) {
  const { client, reads } = clientWith(help);
  render(
    <StigmerProvider client={client} showHelpLink={showHelpLink}>
      {ui}
    </StigmerProvider>,
  );
  return { reads };
}

describe("CON-13 useHelpLink", () => {
  it("reads the server's link and its words", async () => {
    const { client } = clientWith(ACME);
    const { result } = renderHook(() => useHelpLink(), {
      wrapper: ({ children }) => <StigmerProvider client={client}>{children}</StigmerProvider>,
    });
    await waitFor(() => expect(result.current).toEqual(ACME));
  });

  it("reads nothing from a server that set none", async () => {
    const { client, reads } = clientWith(undefined);
    const { result } = renderHook(() => useHelpLink(), {
      wrapper: ({ children }) => <StigmerProvider client={client}>{children}</StigmerProvider>,
    });
    await waitFor(() => expect(reads).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("refuses an address a console must not render, whatever the server sent", async () => {
    const { client, reads } = clientWith({ url: "javascript:alert(1)", label: "Help" });
    const { result } = renderHook(() => useHelpLink(), {
      wrapper: ({ children }) => <StigmerProvider client={client}>{children}</StigmerProvider>,
    });
    await waitFor(() => expect(reads).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});

describe("CON-13 HelpLink", () => {
  it("draws the sidebar row: the words, opening the address in a new tab", async () => {
    inConsole(ACME, <HelpLink variant="row" />);
    const link = await screen.findByRole("link", { name: "Ask IT on Slack" });
    expect(link.getAttribute("href")).toBe(ACME.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("draws the line as 'Stuck? <words>'", async () => {
    inConsole(ACME, <HelpLink />);
    const link = await screen.findByRole("link", { name: "Ask IT on Slack" });
    expect(link.closest("p")?.textContent).toBe("Stuck? Ask IT on Slack");
  });

  it("opens a mail address in place", async () => {
    inConsole({ url: "mailto:it@acme.example", label: "Email IT" }, <HelpLink />);
    const link = await screen.findByRole("link", { name: "Email IT" });
    expect(link.getAttribute("href")).toBe("mailto:it@acme.example");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("draws nothing outside a provider: an error page drawn before the client exists stays whole", () => {
    render(<HelpLink variant="row" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("draws nothing when the server set no link", async () => {
    const { reads } = inConsole(undefined, <HelpLink variant="row" />);
    await waitFor(() => expect(reads).toHaveBeenCalled());
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("CON-13 a failure note's help line", () => {
  const failure = <ErrorMessage error={new ConnectError("the store is down", Code.Unavailable)} title="Couldn't load your agents." />;

  it("ends a console's failure note with the server's link", async () => {
    inConsole(ACME, failure);
    const alert = screen.getByRole("alert");
    const link = await screen.findByRole("link", { name: "Ask IT on Slack" });
    expect(alert.contains(link)).toBe(true);
    expect(alert.textContent).toContain("Stuck? Ask IT on Slack");
  });

  it("shows no line, and reads no server for it, in a builder's app (showHelpLink left off)", async () => {
    const { reads } = inConsole(ACME, failure, false);
    // Give a read the chance to happen before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("alert").textContent).not.toContain("Stuck?");
    expect(reads).not.toHaveBeenCalled();
  });

  it("draws a failure note outside any provider exactly as before", () => {
    render(failure);
    expect(screen.getByRole("alert").textContent).not.toContain("Stuck?");
  });

  it("never ends a paused or a plain note with it", async () => {
    const { reads } = inConsole(
      ACME,
      <>
        <Notice tone="paused" headline="Waiting for a sandbox." />
        <Notice tone="plain" headline="Nothing ran yet." />
      </>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/Stuck\?/)).toBeNull();
    expect(reads).not.toHaveBeenCalled();
  });
});
