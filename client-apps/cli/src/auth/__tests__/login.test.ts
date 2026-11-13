// Unit tests for `stigmer auth login`'s flow (auth/login.ts), against a fake
// issuer on loopback (src/__test-utils__/fake-issuer.ts) and a browser stub
// that follows the authorize address as a person's browser would.
//
// The sign-in goes where the server says: the announced issuer and native
// client, read from discovery; the token set is stored in the active
// backend's entry (a selfhost one included) beside that issuer and client.
// Refused in plain words: a server that trusts every caller, one with no
// native client, a provider on another site without `--trust-provider`, a
// discovery document naming another issuer, and `--device` where the issuer
// offers no device endpoint. The device grant prints the address and code,
// polls through `authorization_pending` and `slow_down`, and ends on a
// refusal or an expired code with the next step.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeIssuer, startFakeIssuer, type DeviceAnswer } from "../../__test-utils__/fake-issuer.js";
import { freePort } from "../../__test-utils__/ports.js";
import { type Config, load, save } from "../../config/index.js";
import { CliExitError } from "../../errors/index.js";
import type { DeviceTiming } from "../device.js";
import { type LoginDeps, login, type ServerSignIn } from "../login.js";
import { forgetDiscovery } from "../oidc.js";

const AUDIENCE = "https://api.example.test/";
const SELFHOST = "127.0.0.1:7999";

let issuer: FakeIssuer | undefined;

beforeEach(() => {
  forgetDiscovery();
  delete process.env.STIGMER_SERVER_ADDRESS;
});

afterEach(async () => {
  await issuer?.close();
  issuer = undefined;
});

/** A browser that follows the authorize address to the CLI's callback. */
async function followAuthorize(url: string): Promise<void> {
  const authorize = await fetch(url, { redirect: "manual" });
  const location = authorize.headers.get("location");
  if (location === null) throw new Error(`authorize answered ${authorize.status}`);
  await fetch(location);
}

/** A clock that moves only by what the poll sleeps, with every sleep recorded. */
function fakeTiming(): DeviceTiming & { readonly slept: number[] } {
  let now = 1_000_000;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

interface Harness {
  readonly deps: LoginDeps;
  readonly progress: string[];
  readonly opened: string[];
}

async function harness(
  answer: ServerSignIn,
  overrides: Partial<LoginDeps> = {},
): Promise<Harness> {
  const progress: string[] = [];
  const opened: string[] = [];
  const deps: LoginDeps = {
    readServerSignIn: async () => answer,
    openBrowser: async (url) => {
      opened.push(url);
      // The browser loads the page after the CLI is already waiting.
      setTimeout(() => void followAuthorize(url), 0);
    },
    canOpenBrowser: () => true,
    progress: (text) => progress.push(text),
    timing: fakeTiming(),
    ports: [await freePort()],
    timeoutMs: 10_000,
    ...overrides,
  };
  return { deps, progress, opened };
}

function announced(fake: FakeIssuer): ServerSignIn {
  return {
    authenticationRequired: true,
    nativeSignIn: { issuer: fake.issuer, audience: AUDIENCE, clientId: fake.clientId },
  };
}

function useSelfhost(extra: Partial<Config["backends"]> = {}): void {
  save({
    backend: {},
    current_backend: "acme",
    backends: { acme: { type: "selfhost", endpoint: SELFHOST, api_key: "stk_old" }, ...extra },
  });
}

async function refusal(promise: Promise<unknown>): Promise<CliExitError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExitError) return err;
    throw err;
  }
  throw new Error("expected the sign-in to be refused");
}

describe("login through the browser", () => {
  it("signs a selfhost backend in where its server says, and keeps the provider beside the tokens", async () => {
    issuer = await startFakeIssuer();
    useSelfhost();
    const h = await harness(announced(issuer));

    const outcome = await login({}, h.deps);

    expect(outcome).toMatchObject({ backendName: "acme", type: "selfhost", address: SELFHOST });
    const entry = load().backends?.acme;
    expect(entry?.token).toMatch(/^access-/);
    expect(entry?.refresh_token).toMatch(/^refresh-/);
    expect(Date.parse(entry?.token_expiry ?? "")).toBeGreaterThan(Date.now());
    expect(entry?.oidc_issuer).toBe(issuer.issuer);
    expect(entry?.oidc_client_id).toBe("native-client");
    expect(entry?.api_key).toBe("stk_old");
    expect(load().current_backend).toBe("acme");

    const authorize = issuer.authorizeRequests[0]?.searchParams;
    expect(authorize?.get("audience")).toBe(AUDIENCE);
    expect(authorize?.get("prompt")).toBe("login");
    expect(authorize?.get("redirect_uri")).toBe(`http://127.0.0.1:${h.deps.ports[0]}/auth/callback`);
    expect(h.progress.join("")).toContain(h.opened[0]);
  });

  it("from the local daemon, signs the cloud entry in once the person trusts its provider", async () => {
    issuer = await startFakeIssuer();
    save({ backend: {}, backends: {}, current_backend: "local" });
    const h = await harness(announced(issuer));

    const outcome = await login({ trustProvider: true }, h.deps);

    expect(outcome).toMatchObject({ backendName: "cloud", type: "cloud", address: "api.stigmer.ai:443" });
    expect(load().current_backend).toBe("cloud");
    expect(load().backends?.cloud?.oidc_issuer).toBe(issuer.issuer);
  });

  it("refuses a provider on another site than the server, naming both", async () => {
    save({ backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost", endpoint: "stigmer.acme.test:443" } } });
    const err = await refusal(
      login(
        {},
        (
          await harness({
            authenticationRequired: true,
            nativeSignIn: { issuer: "https://id.other.test/", audience: AUDIENCE, clientId: "c" },
          })
        ).deps,
      ),
    );
    expect(err.message).toBe("stigmer.acme.test signs people in at id.other.test, on another site");
    expect(err.hints?.join("\n")).toContain("stigmer auth login --trust-provider");
  });

  it("refuses a server that trusts every caller: nothing to sign in to", async () => {
    useSelfhost();
    const err = await refusal(login({}, (await harness({ authenticationRequired: false, nativeSignIn: undefined })).deps));
    expect(err.message).toBe(`the server at ${SELFHOST} trusts every caller: there is nothing to sign in to`);
  });

  it("refuses a server that announces no native client, with the API key route", async () => {
    useSelfhost();
    const err = await refusal(login({}, (await harness({ authenticationRequired: true, nativeSignIn: undefined })).deps));
    expect(err.message).toBe(`the server at ${SELFHOST} signs people in, but isn't set up for this app`);
    expect(err.hints?.join("\n")).toContain(`stigmer config backend add acme --endpoint ${SELFHOST} --api-key <key>`);
  });

  it("refuses a discovery document that names another issuer", async () => {
    issuer = await startFakeIssuer({ documentIssuer: () => "https://impostor.test/" });
    useSelfhost();
    const err = await refusal(login({}, (await harness(announced(issuer))).deps));
    expect(err.message).toBe(`the sign-in provider says it is https://impostor.test/, but this server named ${issuer.issuer}`);
  });

  it("takes the next loopback port when the first is in use", async () => {
    issuer = await startFakeIssuer();
    useSelfhost();
    const { createServer } = await import("node:net");
    const busy = createServer();
    const busyPort = await freePort();
    await new Promise<void>((resolve) => busy.listen(busyPort, "127.0.0.1", resolve));
    try {
      const nextPort = await freePort();
      const h = await harness(announced(issuer), { ports: [busyPort, nextPort] });
      await login({}, h.deps);
      expect(issuer.authorizeRequests[0]?.searchParams.get("redirect_uri")).toBe(
        `http://127.0.0.1:${nextPort}/auth/callback`,
      );
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }
  });

  it("prints the address before it waits, so the person can open it when the browser can't", async () => {
    issuer = await startFakeIssuer();
    useSelfhost();
    const progress: string[] = [];
    const h = await harness(announced(issuer), {
      openBrowser: async () => {
        const url = /https?:\/\/\S+authorize\S+/.exec(progress.join(""))?.[0];
        if (url !== undefined) setTimeout(() => void followAuthorize(url), 0);
        throw new Error("no browser here");
      },
      progress: (text) => progress.push(text),
    });
    await login({}, h.deps);
    expect(progress.join("")).toContain("Could not open the browser automatically");
    expect(load().backends?.acme?.token).toMatch(/^access-/);
  });

  it("refuses STIGMER_SERVER_ADDRESS pointing at another server than the backend", async () => {
    useSelfhost();
    process.env.STIGMER_SERVER_ADDRESS = "elsewhere.test:443";
    const err = await refusal(login({}, (await harness({ authenticationRequired: true, nativeSignIn: undefined })).deps));
    expect(err.message).toBe(
      `STIGMER_SERVER_ADDRESS points at elsewhere.test:443, but the sign-in is for backend "acme" at ${SELFHOST}`,
    );
  });
});

describe("login with a code typed on any device", () => {
  async function deviceLogin(
    answers: readonly DeviceAnswer[],
    options: { device?: boolean; canOpen?: boolean } = { device: true },
  ): Promise<{ readonly h: Harness; readonly timing: ReturnType<typeof fakeTiming>; readonly run: Promise<unknown> }> {
    issuer = await startFakeIssuer({ device: true, deviceAnswers: answers });
    useSelfhost();
    const timing = fakeTiming();
    const h = await harness(announced(issuer), { timing, canOpenBrowser: () => options.canOpen ?? true });
    return { h, timing, run: login({ device: options.device }, h.deps) };
  }

  it("prints the address and code, waits through pending and slow_down, then stores the sign-in", async () => {
    const { h, timing, run } = await deviceLogin(["authorization_pending", "slow_down", "approve"]);
    await run;

    const text = h.progress.join("");
    expect(text).toContain(`To sign in, open ${issuer?.issuer}/activate and enter ABCD-EFGH`);
    expect(text).toContain(`or open ${issuer?.issuer}/activate?user_code=ABCD-EFGH`);
    expect(timing.slept).toEqual([1000, 1000, 6000]);
    expect(h.opened).toEqual([]);

    const entry = load().backends?.acme;
    expect(entry?.token).toMatch(/^access-/);
    expect(entry?.oidc_issuer).toBe(issuer?.issuer);
    const deviceRequest = issuer?.forms.find((f) => f.path === "/device/code")?.form;
    expect(deviceRequest?.get("audience")).toBe(AUDIENCE);
    expect(deviceRequest?.get("scope")).toBe("openid profile email offline_access");
  });

  it("signs in with a code by itself where no browser can open and the issuer offers it", async () => {
    const { h, run } = await deviceLogin(["approve"], { canOpen: false });
    await run;
    expect(h.opened).toEqual([]);
    expect(h.progress.join("")).toContain("enter ABCD-EFGH");
  });

  it("ends a refused sign-in in plain words with the next step", async () => {
    const { run } = await deviceLogin(["authorization_pending", "access_denied"]);
    const err = await refusal(run);
    expect(err.message).toBe("the sign-in was refused on the other device");
    expect(err.hints).toEqual(["Run 'stigmer auth login --device' to try again."]);
  });

  it("ends on an expired code with how to get a new one", async () => {
    const { run } = await deviceLogin(["expired_token"]);
    const err = await refusal(run);
    expect(err.message).toBe("the sign-in code expired before it was entered");
  });

  it("refuses --device where the issuer offers no device sign-in", async () => {
    issuer = await startFakeIssuer({ device: false });
    useSelfhost();
    const err = await refusal(login({ device: true }, (await harness(announced(issuer))).deps));
    expect(err.message).toBe("this server's sign-in provider doesn't offer sign-in with a code");
  });

  it("falls back to the browser's address where no browser opens and the issuer has no device sign-in", async () => {
    issuer = await startFakeIssuer({ device: false });
    useSelfhost();
    const h = await harness(announced(issuer), { canOpenBrowser: () => false });
    await login({}, h.deps);
    expect(h.progress.join("")).toContain("If it doesn't open, visit:");
    expect(load().backends?.acme?.token).toMatch(/^access-/);
  });
});
