// ---------------------------------------------------------------------------
// The server the app points at: connecting, why one cannot be used, and
// choosing another
//
// The real ServerProvider and screens over Tauri's IPC mock, the host
// answering `current_server` and `choose_server` as src-tauri/src/server.rs
// does; the SDK client's getServerInfo is the test's. Pinned: the app asks
// the host which server (the build's default when none was chosen) and
// connects to it; each way a server cannot be used says what happened and
// offers another server; an address the host refuses shows its reason; an
// accepted one is connected to.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauri, type TauriMock } from "../../__test-utils__/tauri";

type Answer = () => Promise<Record<string, unknown>>;
const sdk = vi.hoisted(() => ({
  answers: new Map<string, () => Promise<Record<string, unknown>>>(),
  asked: [] as string[],
}));
vi.mock("@stigmer/client", () => ({
  Stigmer: class {
    platform: { getServerInfo: () => Promise<Record<string, unknown>> };
    constructor(config: { baseUrl: string }) {
      this.platform = {
        getServerInfo: () => {
          sdk.asked.push(config.baseUrl);
          const answer = sdk.answers.get(config.baseUrl);
          return answer ? answer() : new Promise(() => {});
        },
      };
    }
  },
}));

import { ServerProvider, useServer } from "../ServerProvider";
import { ConnectScreen, DESKTOP_SIGN_IN_GUIDE } from "../ConnectScreen";

const ACME = "https://stigmer.acme.internal";
const CLOUD = "https://api.stigmer.ai";

function answers(origin: string, answer: Answer) {
  sdk.answers.set(origin, answer);
}

/** A network failure, as the client reports one: its cause is the transport's own error. */
function unreachable(): Promise<never> {
  const transport = new TypeError("error sending request: Connection refused");
  const connect = Object.assign(new Error("Connection refused"), { name: "ConnectError", cause: transport });
  return Promise.reject(Object.assign(new Error("Connection refused"), { code: "unknown", cause: connect }));
}

function notStigmer(): Promise<never> {
  const connect = Object.assign(new Error("HTTP 404"), { name: "ConnectError" });
  return Promise.reject(Object.assign(new Error("HTTP 404"), { code: "unimplemented", cause: connect }));
}

/** Shows what the provider decided, beside the screen, when it is connected. */
function Outcome() {
  const { connection, origin } = useServer();
  return connection.phase === "connected" ? (
    <p data-testid="outcome">
      {origin} {connection.outcome.kind}
    </p>
  ) : null;
}

function renderScreen(): void {
  render(
    <ServerProvider>
      <ConnectScreen />
      <Outcome />
    </ServerProvider>,
  );
}

function host(chosen: string | null = null, extra: Parameters<typeof mockTauri>[0] = {}): TauriMock {
  return mockTauri({
    current_server: (args) => chosen ?? String(args.buildDefault).replace(/\/$/, ""),
    open_auth_in_browser: () => null,
    ...extra,
  });
}

beforeEach(() => {
  sdk.answers.clear();
  sdk.asked = [];
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_STIGMER_API_URL", CLOUD);
});

describe("DSK-07 connecting to the chosen server", () => {
  it("asks the host which server, offering the build's default, and connects to the one it names", async () => {
    const tauri = host(ACME);
    answers(ACME, async () => ({ authenticationRequired: false, deploymentMode: "local" }));
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe(`${ACME} open`));
    expect(tauri.callsTo("current_server")).toEqual([{ buildDefault: CLOUD }]);
    expect(sdk.asked).toEqual([ACME]);
  });

  it("says it is connecting while the server has not answered", async () => {
    host(ACME);
    renderScreen();

    expect(await screen.findByText("Connecting to stigmer.acme.internal…")).toBeTruthy();
  });

  it("says when nothing answered at the address, and tries again on request", async () => {
    host(ACME);
    answers(ACME, unreachable);
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Can't reach stigmer.acme.internal" })).toBeTruthy();
    answers(ACME, async () => ({ authenticationRequired: false, deploymentMode: "local" }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe(`${ACME} open`));
    expect(sdk.asked).toEqual([ACME, ACME]);
  });

  it("says when what answered is not a Stigmer server", async () => {
    host(ACME);
    answers(ACME, notStigmer);
    renderScreen();

    expect(
      await screen.findByRole("heading", { name: "stigmer.acme.internal doesn't look like a Stigmer server" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says a server that signs people in but offers the app no sign-in is not set up, and how an operator sets it up", async () => {
    const tauri = host(CLOUD);
    answers(CLOUD, async () => ({ authenticationRequired: true, deploymentMode: "cloud" }));
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Stigmer Cloud isn’t set up for the desktop app" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "How an operator sets it up" }));
    expect(tauri.callsTo("open_auth_in_browser")).toEqual([{ authUrl: DESKTOP_SIGN_IN_GUIDE }]);
  });
});

describe("DSK-07 choosing another server", () => {
  it("shows the host's reason for an address it refuses, and connects to one it accepts", async () => {
    const tauri = host(ACME, {
      choose_server: (args) => {
        if (String(args.url).startsWith("http://")) {
          throw "http://intranet uses http, which would send your sign-in in clear across the network.";
        }
        return "https://other.acme.internal";
      },
    });
    answers(ACME, unreachable);
    answers("https://other.acme.internal", async () => ({ authenticationRequired: false, deploymentMode: "local" }));
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "Use another server" }));
    const address = screen.getByLabelText("Server address");
    await userEvent.type(address, "http://intranet");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toContain("would send your sign-in in clear");
    expect(address.getAttribute("aria-invalid")).toBe("true");

    await userEvent.clear(address);
    await userEvent.type(address, "other.acme.internal");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(screen.getByTestId("outcome").textContent).toBe("https://other.acme.internal open"));
    expect(tauri.callsTo("choose_server").map((call) => call.url)).toEqual(["http://intranet", "other.acme.internal"]);
  });

  it("goes back from the form to where the person was", async () => {
    host(ACME);
    answers(ACME, notStigmer);
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "Use another server" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("heading", { name: "stigmer.acme.internal doesn't look like a Stigmer server" })).toBeTruthy();
  });

  it("asks for another server, with no way back, when the build's own address is not usable", async () => {
    host(null, {
      current_server: () => {
        throw "This build's server address is not usable: ftp://x uses ftp:, not a web address.";
      },
    });
    renderScreen();

    expect((await screen.findByRole("alert")).textContent).toContain("This build's server address is not usable");
    expect(screen.getByLabelText("Server address")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
