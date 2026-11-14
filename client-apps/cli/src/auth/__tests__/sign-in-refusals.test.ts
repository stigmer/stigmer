// The sign-in's refusals and fallbacks, each in its own words (auth/oidc.ts,
// auth/device.ts, auth/login.ts, auth/callback-server.ts, auth/browser.ts):
// an issuer that is plain http off this machine, unreachable, answering an
// error or something that is not JSON; a device endpoint that refuses the
// client, refuses for another reason, or answers no code; a poll that runs
// past its deadline, meets a network failure or an error the grant does not
// name; a forged callback's state; a backend with no endpoint; every loopback
// port taken; and the system opener, the real clock and the server read the
// default dependencies use.

import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeIssuer, startFakeIssuer } from "../../__test-utils__/fake-issuer.js";
import { freePort } from "../../__test-utils__/ports.js";
import { load, save } from "../../config/index.js";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { CallbackServer } from "../callback-server.js";
import { pollDeviceToken, realTiming, requestDeviceCode } from "../device.js";
import { defaultLoginDeps, login, type LoginDeps } from "../login.js";
import { discover, forgetDiscovery, hostOf, postTokenForm, providerOnServersSite } from "../oidc.js";

const openMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("open", () => ({ default: openMock }));

let issuer: FakeIssuer | undefined;

beforeEach(() => {
  forgetDiscovery();
  delete process.env.STIGMER_SERVER_ADDRESS;
});

afterEach(async () => {
  await issuer?.close();
  issuer = undefined;
  vi.unstubAllGlobals();
});

async function refusal(run: () => Promise<unknown>): Promise<CliExitError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof CliExitError) return err;
    throw err;
  }
  throw new Error("expected a refusal");
}

const NATIVE = (fake: FakeIssuer) => ({ issuer: fake.issuer, audience: "https://api.example.test/", clientId: fake.clientId });

describe("reading the issuer", () => {
  it("refuses an issuer that is plain http off this machine before dialing it", async () => {
    const err = await refusal(() => discover("http://id.example.test/"));
    expect(err.message).toBe("the server names the sign-in provider http://id.example.test/, which is not https");
  });

  it("says when the issuer cannot be reached, as a connection failure", async () => {
    const port = await freePort();
    const err = await refusal(() => discover(`http://127.0.0.1:${port}`));
    expect(err.exitCode).toBe(ExitCode.Connection);
    expect(err.message).toMatch(/^failed to reach the sign-in provider http:\/\/127\.0\.0\.1:\d+:/);
  });

  it("says what the issuer answered when its discovery document is not there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const err = await refusal(() => discover("https://id.example.test/"));
    expect(err.message).toBe("the sign-in provider https://id.example.test/ answered 404 for its discovery document");
  });

  it("refuses a discovery document that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html></html>", { status: 200 })));
    const err = await refusal(() => discover("https://id.example.test/"));
    expect(err.message).toBe("https://id.example.test/ published no OpenID Connect discovery document the CLI can read");
  });

  it("finds no host in what is no address, and no site to share", () => {
    expect(hostOf("http://[")).toBe("");
    expect(providerOnServersSite("http://[", "https://id.example.test/")).toBe(false);
  });
});

describe("a token request", () => {
  it("says when the token endpoint cannot be reached", async () => {
    const port = await freePort();
    const err = await refusal(() => postTokenForm(`http://127.0.0.1:${port}/token`, { grant_type: "refresh_token" }));
    expect(err.exitCode).toBe(ExitCode.Connection);
    expect(err.message).toMatch(/^failed to reach the sign-in provider:/);
  });

  it("names the status when an error answer is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    const err = await refusal(() => postTokenForm("https://id.example.test/token", { grant_type: "refresh_token" }));
    expect(err.message).toBe("authentication failed: HTTP 502");
  });
});

describe("a code on any device", () => {
  it("says the operator must allow the grant when the issuer refuses the client", async () => {
    issuer = await startFakeIssuer({ device: true, deviceCodeAnswer: { status: 401, body: { error: "unauthorized_client", error_description: "grant not allowed" } } });
    const err = await refusal(async () => requestDeviceCode(await discover(issuer!.issuer), NATIVE(issuer!)));
    expect(err.message).toBe("the sign-in provider refused a sign-in with a code: unauthorized_client: grant not allowed");
    expect(err.hints).toEqual(["The server's operator has to allow the device grant for its native client."]);
  });

  it("offers the browser when the issuer refuses for another reason", async () => {
    issuer = await startFakeIssuer({ device: true, deviceCodeAnswer: { status: 400, body: { error: "invalid_scope" } } });
    const err = await refusal(async () => requestDeviceCode(await discover(issuer!.issuer), NATIVE(issuer!)));
    expect(err.hints).toEqual(["Sign in from a machine with a browser instead: stigmer auth login"]);
  });

  it("refuses an answer that carries no code", async () => {
    issuer = await startFakeIssuer({ device: true, deviceCodeAnswer: { status: 200, body: { interval: 5 } } });
    const err = await refusal(async () => requestDeviceCode(await discover(issuer!.issuer), NATIVE(issuer!)));
    expect(err.message).toBe("the sign-in provider answered no code to sign in with");
  });

  it("says when the device endpoint cannot be reached", async () => {
    const port = await freePort();
    const discovery = { authorizationEndpoint: "x", tokenEndpoint: "x", deviceAuthorizationEndpoint: `http://127.0.0.1:${port}/device/code` };
    const err = await refusal(() => requestDeviceCode(discovery, { issuer: "x", audience: "x", clientId: "c" }));
    expect(err.exitCode).toBe(ExitCode.Connection);
  });

  it("ends the poll once the code's lifetime has passed", async () => {
    let now = 0;
    const timing = { now: () => now, sleep: async (ms: number) => void (now += ms) };
    const code = { deviceCode: "d", userCode: "U", verificationUri: "https://x", expiresInSeconds: 1, intervalSeconds: 2 };
    const err = await refusal(() => pollDeviceToken({ authorizationEndpoint: "x", tokenEndpoint: "x" }, { issuer: "x", audience: "x", clientId: "c" }, code, timing));
    expect(err.message).toBe("the sign-in code expired before it was entered");
  });

  it.each([
    ["an error the grant does not name", ["server_error"] as const, "the sign-in provider ended the sign-in: server_error: the tenant is down"],
    ["an answer that is not JSON", ["not_json"] as const, "the sign-in provider ended the sign-in: HTTP 502"],
  ])("ends on %s, in the provider's words", async (_label, answers, words) => {
    issuer = await startFakeIssuer({ device: true, deviceAnswers: [...answers] });
    const discovery = await discover(issuer.issuer);
    const code = await requestDeviceCode(discovery, NATIVE(issuer));
    const err = await refusal(() => pollDeviceToken(discovery, NATIVE(issuer!), code, { now: () => 0, sleep: async () => undefined }));
    expect(err.message).toBe(words);
  });

  it("passes a network failure during the poll on as it is", async () => {
    const port = await freePort();
    const code = { deviceCode: "d", userCode: "U", verificationUri: "https://x", expiresInSeconds: 600, intervalSeconds: 1 };
    const err = await refusal(() =>
      pollDeviceToken({ authorizationEndpoint: "x", tokenEndpoint: `http://127.0.0.1:${port}/token` }, { issuer: "x", audience: "x", clientId: "c" }, code, { now: () => 0, sleep: async () => undefined }),
    );
    expect(err.exitCode).toBe(ExitCode.Connection);
  });

  it("waits on the real clock by default", async () => {
    const before = realTiming.now();
    await realTiming.sleep(5);
    expect(realTiming.now()).toBeGreaterThanOrEqual(before + 4);
  });
});

describe("the browser sign-in", () => {
  it("refuses a callback whose state is not the one it sent", async () => {
    issuer = await startFakeIssuer({ stateOverride: "forged" });
    save({ backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost", endpoint: "127.0.0.1:7999" } } });
    const deps: LoginDeps = {
      ...defaultLoginDeps,
      readServerSignIn: async () => ({ authenticationRequired: true, nativeSignIn: NATIVE(issuer!) }),
      openBrowser: async (url) => {
        setTimeout(() => {
          void fetch(url, { redirect: "manual" }).then((r) => fetch(r.headers.get("location") ?? ""));
        }, 0);
      },
      progress: () => undefined,
      ports: [await freePort()],
    };
    const err = await refusal(() => login({}, deps));
    expect(err.message).toBe("OAuth state mismatch — possible CSRF attack, aborting login");
    expect(load().backends?.acme?.token).toBeUndefined();
  });

  it("refuses a self-hosted backend with no endpoint", async () => {
    save({ backend: {}, current_backend: "bare", backends: { bare: { type: "selfhost" } } });
    const err = await refusal(() => login({}, defaultLoginDeps));
    expect(err.message).toBe('backend "bare" has no endpoint configured');
  });

  it("says when every loopback port is taken", async () => {
    const taken: Server[] = [];
    const ports = [await freePort(), await freePort()];
    for (const port of ports) {
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      taken.push(server);
    }
    try {
      const callback = new CallbackServer(ports, "/auth/callback");
      expect(() => callback.port).toThrow("callback server not started");
      const err = await refusal(() => callback.start());
      expect(err.message).toBe(`failed to start the sign-in callback on 127.0.0.1 (ports ${ports.join(", ")} are in use)`);
      expect(err.hints?.[0]).toBe("Finish or stop the other sign-in, then try again.");
    } finally {
      for (const server of taken) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("a sign-in left unfinished in the browser", () => {
  it("says nothing was saved and names the two commands that try again", async () => {
    const callback = new CallbackServer([await freePort()], "/auth/callback");
    await callback.start();
    try {
      const err = await refusal(() => callback.waitForCallback(20));
      expect(err.message).toBe("the sign-in wasn't finished in the browser in time, so nothing was saved");
      // The exit code scripts read is unchanged: 1, as before the words changed.
      expect(err.exitCode).toBe(ExitCode.General);
      expect(err.hints).toEqual([
        "Run 'stigmer auth login' again and finish signing in on the page it opens.",
        "Where no browser can open here, run 'stigmer auth login --device' instead.",
      ]);
    } finally {
      await callback.shutdown();
    }
  });
});

describe("the default dependencies", () => {
  it("open the system's browser without BROWSER, and write progress to stderr", async () => {
    const env = process.env.BROWSER;
    delete process.env.BROWSER;
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await defaultLoginDeps.openBrowser("https://id.example.test/authorize");
      expect(openMock).toHaveBeenCalledWith("https://id.example.test/authorize");
      defaultLoginDeps.progress("Signing in...\n");
      expect(write).toHaveBeenCalledWith("Signing in...\n");
      expect(typeof defaultLoginDeps.canOpenBrowser()).toBe("boolean");
    } finally {
      write.mockRestore();
      if (env !== undefined) process.env.BROWSER = env;
    }
  });
});
