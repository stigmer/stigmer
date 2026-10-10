// The sign-in's own side effects, when no test double is injected: the
// browser opens through the platform's launcher (spawned detached, its output
// ignored), and a platform with none is told to open the URL itself; the
// guidance goes to stderr; the wait polls every 3 seconds on the real clock;
// the console probe counts any HTTP answer as serving and a refused
// connection as not; and a vault read failing for any reason but a missing
// My vault fails the wait. The launcher is replaced at its module seam
// (node:child_process), so no browser starts; the probe runs over a real
// loopback listener.

import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { StigmerError } from "@stigmer/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { runSignIn, type SignInClient, type SignInDeps, waitForLogin } from "../sign-in.js";

const launcher = vi.hoisted(() => ({
  calls: [] as { command: string; args: readonly string[]; options: unknown }[],
}));

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: readonly string[], options: unknown) => {
    launcher.calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => {};
    return child;
  },
}));

const ADDRESS = "https://mcp.linear.app/mcp";
const LOGIN_PAGE = "https://linear.app/oauth/authorize?x=1";

// A My vault holding the login from the `loginOnRead`th read on.
function fakeClient(loginOnRead: number): { client: SignInClient; reads: () => number } {
  let reads = 0;
  const client = {
    vault: {
      startSignIn: async () => ({ authorizationUrl: LOGIN_PAGE, state: "s", providerName: "", scopes: [] }),
      getMine: async () => {
        reads += 1;
        return create(VaultSchema, { spec: { connections: reads >= loginOnRead ? { [ADDRESS]: {} } : {} } });
      },
    },
  } as unknown as SignInClient;
  return { client, reads: () => reads };
}

function deps(client: SignInClient, overrides: Partial<SignInDeps> = {}): SignInDeps {
  return {
    client,
    address: ADDRESS,
    serverName: "linear",
    rerun: "stigmer connect plugin linear",
    org: "acme",
    consoleURL: "http://127.0.0.1:1",
    probeLocalConsole: false,
    ...overrides,
  };
}

const originalPlatform = process.platform;
let stderr: string;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

beforeEach(() => {
  launcher.calls.length = 0;
  stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  setPlatform(originalPlatform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runSignIn with its own effects", () => {
  it("opens the login page with the platform's launcher, guides on stderr, and polls every 3 seconds", async () => {
    setPlatform("darwin");
    vi.useFakeTimers();
    const { client, reads } = fakeClient(2);
    const done = runSignIn(deps(client));

    await vi.advanceTimersByTimeAsync(3000);
    expect(reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    await done;

    expect(reads()).toBe(2);
    expect(launcher.calls).toEqual([{ command: "open", args: [LOGIN_PAGE], options: { stdio: "ignore", detached: true } }]);
    expect(stderr).toContain("Sign in to 'linear' with its login server.");
    expect(stderr).toContain(`If the browser doesn't open automatically, visit:\n  ${LOGIN_PAGE}`);
    expect(stderr).toContain("Signed in.");
  });

  it("tells the user to open the URL when the platform has no launcher", async () => {
    setPlatform("aix");
    const { client } = fakeClient(1);
    await runSignIn(deps(client, { sleep: async () => {} }));
    expect(launcher.calls).toHaveLength(0);
    expect(stderr).toContain("Could not open the browser automatically. Open the URL above in your browser.");
  });
});

describe("the local console probe", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const listening = server;
    server = undefined;
    if (listening !== undefined) await new Promise<void>((resolve) => listening.close(() => resolve()));
  });

  async function listen(status: number): Promise<string> {
    const started = createServer((_req, res) => {
      res.statusCode = status;
      res.end("console");
    });
    server = started;
    await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  }

  it("counts any HTTP answer, an error status included, as a running console", async () => {
    setPlatform("aix");
    const consoleURL = await listen(500);
    const { client, reads } = fakeClient(1);
    await runSignIn(deps(client, { consoleURL, probeLocalConsole: true, sleep: async () => {} }));
    expect(reads()).toBe(1);
  });

  it("refuses with the other ways when nothing answers at the console's address", async () => {
    const consoleURL = await listen(200);
    const listening = server;
    server = undefined;
    await new Promise<void>((resolve) => listening?.close(() => resolve()));

    const { client, reads } = fakeClient(1);
    const err = await runSignIn(deps(client, { consoleURL, probeLocalConsole: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("returns to the web console, which is not running for this local backend");
    expect(reads()).toBe(0);
  });
});

describe("waitForLogin", () => {
  it("fails on a vault read refused for any reason but a missing My vault", async () => {
    const denied = new StigmerError("permission-denied", "not yours", Code.PermissionDenied);
    const client = {
      vault: {
        getMine: async () => {
          throw denied;
        },
      },
    } as unknown as SignInClient;
    await expect(waitForLogin(deps(client, { sleep: async () => {} }))).rejects.toBe(denied);
  });
});
