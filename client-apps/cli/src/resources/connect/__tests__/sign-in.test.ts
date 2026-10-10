// The interactive sign-in `connect plugin` runs, and the address mirror it
// checks My vault with.
//
// Pins: the address rule's table (scheme and host case, a default port, one
// trailing slash, query and fragment dropped, a placeholder or another scheme
// naming none), and the github.com login filling GitHub's API-hosted tools;
// the sign-in starts in the caller's My vault at the server's address,
// returning to the console's page, and opens the login page it answers; the
// wait ends once My vault holds a login there, treats a missing My vault as
// none yet, and times out with the command to run again; an unreachable local
// console is refused with the other ways, a pasted key only where the server
// accepts one; and the browser opener per platform.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { type StartSignInInput, SignInReturn } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { StigmerError } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { holdsLoginFor, toolAddress } from "../address.js";
import { browserCommand, runSignIn, type SignInClient, type SignInDeps, waitForLogin } from "../sign-in.js";

const ADDRESS = "https://mcp.linear.app/mcp";

// A My vault that holds the login from the `loginOnRead`th read on; reads
// before the first answer NOT_FOUND when `missingFirst` is set.
function fakeClient(loginOnRead: number, missingFirst = false): {
  client: SignInClient;
  reads: () => number;
  started: StartSignInInput[];
} {
  let reads = 0;
  const started: StartSignInInput[] = [];
  const client = {
    vault: {
      startSignIn: async (input: StartSignInInput) => {
        started.push(input);
        return { authorizationUrl: "https://linear.app/oauth/authorize?x=1", state: "s", providerName: "Linear", scopes: [] };
      },
      getMine: async () => {
        reads += 1;
        if (missingFirst && reads === 1) throw new StigmerError("not-found", "no My vault", Code.NotFound);
        return create(VaultSchema, {
          spec: { connections: reads >= loginOnRead ? { [ADDRESS]: {} } : {} },
        });
      },
    },
  } as unknown as SignInClient;
  return { client, reads: () => reads, started };
}

function deps(client: SignInClient, overrides: Partial<SignInDeps> = {}): SignInDeps {
  return {
    client,
    address: ADDRESS,
    serverName: "linear",
    rerun: "stigmer connect plugin linear",
    org: "acme",
    consoleURL: "https://app.stigmer.ai",
    probeLocalConsole: false,
    now: () => 0,
    sleep: async () => {},
    log: () => {},
    ...overrides,
  };
}

describe("toolAddress", () => {
  it.each([
    ["https://MCP.Linear.app:443/mcp/?x=1#frag", "https://mcp.linear.app/mcp"],
    ["http://localhost:8080/mcp", "http://localhost:8080/mcp"],
    ["http://example.com:80/", "http://example.com"],
  ])("normalizes %s to %s", (input, address) => {
    expect(toolAddress(input)).toBe(address);
  });

  it.each(["https://${HOST}/mcp", "ftp://example.com/mcp", "https://user:pw@example.com/mcp", "not a url", ""])(
    "names no address for %j",
    (input) => {
      expect(toolAddress(input)).toBeUndefined();
    },
  );
});

describe("holdsLoginFor", () => {
  it("matches the exact address, and the github.com login for GitHub's API hosts over HTTPS", () => {
    expect(holdsLoginFor({ [ADDRESS]: {} }, ADDRESS)).toBe(true);
    expect(holdsLoginFor({ "https://mcp.linear.app": {} }, ADDRESS)).toBe(false);
    expect(holdsLoginFor({ "github.com": {} }, "https://api.githubcopilot.com/mcp")).toBe(true);
    expect(holdsLoginFor({ "github.com": {} }, "http://api.githubcopilot.com/mcp")).toBe(false);
  });
});

describe("runSignIn", () => {
  it("starts the sign-in in My vault at the address, opens its login page, and waits for the login", async () => {
    const { client, started, reads } = fakeClient(2);
    const opened: string[] = [];
    await runSignIn(deps(client, { openBrowser: async (url) => void opened.push(url) }));
    expect(started).toHaveLength(1);
    expect(started[0]?.address).toBe(ADDRESS);
    expect(started[0]?.returnTo).toBe(SignInReturn.web);
    expect(started[0]?.vault?.org).toBe("acme");
    expect(started[0]?.vault?.vault).toEqual({ case: "mine", value: true });
    expect(opened).toEqual(["https://linear.app/oauth/authorize?x=1"]);
    expect(reads()).toBe(2);
  });

  it("refuses an unreachable local console with the other ways, a pasted key only where accepted", async () => {
    const { client, started } = fakeClient(1);
    const probeConsole = async (): Promise<boolean> => false;
    const signInOnly = await runSignIn(deps(client, { probeLocalConsole: true, probeConsole })).catch((e: unknown) => e);
    expect(signInOnly).toBeInstanceOf(UsageError);
    expect(String((signInOnly as Error).message)).toContain("stigmer config backend set cloud");
    expect(String((signInOnly as Error).message)).not.toContain("set-secret");

    const withKey = await runSignIn(
      deps(client, { probeLocalConsole: true, probeConsole, loginKey: "LINEAR_TOKEN" }),
    ).catch((e: unknown) => e);
    expect(String((withKey as Error).message)).toContain(
      "stigmer vault set-secret LINEAR_TOKEN --mine, then run stigmer connect plugin linear",
    );
    expect(started).toHaveLength(0);
  });
});

describe("waitForLogin", () => {
  it("treats a missing My vault as no login yet and resolves once the login lands", async () => {
    const { client, reads } = fakeClient(3, true);
    await expect(waitForLogin(deps(client))).resolves.toBeUndefined();
    expect(reads()).toBe(3);
  });

  it("times out with the command to run again", async () => {
    const { client, reads } = fakeClient(Number.POSITIVE_INFINITY);
    const clock = [0, 11 * 60 * 1000];
    await expect(waitForLogin(deps(client, { now: () => clock.shift() ?? Number.MAX_SAFE_INTEGER }))).rejects.toThrow(
      "timed out waiting for the sign-in to 'linear'; run stigmer connect plugin linear to try again",
    );
    expect(reads()).toBe(0);
  });
});

describe("browserCommand", () => {
  it("maps each supported platform to its opener and none to the rest", () => {
    expect(browserCommand("darwin", "https://x")).toEqual(["open", ["https://x"]]);
    expect(browserCommand("linux", "https://x")).toEqual(["xdg-open", ["https://x"]]);
    expect(browserCommand("win32", "https://x")).toEqual(["rundll32", ["url.dll,FileProtocolHandler", "https://x"]]);
    expect(browserCommand("aix", "https://x")[0]).toBeUndefined();
  });
});
