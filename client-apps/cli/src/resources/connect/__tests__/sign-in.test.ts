// The interactive sign-in `connect plugin` runs, and the address mirror it
// checks My vault with.
//
// Pins: the address rule's table (scheme and host case, a default port, one
// trailing slash, query and fragment dropped, a placeholder or another scheme
// naming none), and the github.com login filling GitHub's API-hosted tools;
// the sign-in starts in the caller's My vault at the server's address,
// returning to the console's page, and opens the login page it answers; the
// wait asks the server to finish that sign-in (its state, no code) until it
// is saved and prints whose login it is; a transient failure is asked again,
// and a sign-in that ended right after one reports that failure, not "ended";
// a sign-in that ended otherwise names the command to run again; the login
// page's refusal ends the wait in its words; a missing My vault reads as
// none; an unreachable local console is refused with the other ways, a
// pasted key only where the server accepts one. How the browser opens is
// sign-in-defaults.test.ts's.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import {
  type CompleteSignInInput,
  type CompleteSignInOutput,
  CompleteSignInOutputSchema,
  type StartSignInInput,
  SignInReturn,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { StigmerError } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { holdsLoginFor, toolAddress } from "../address.js";
import { readMyVault, runSignIn, type SignInClient, type SignInDeps, waitForSignIn } from "../sign-in.js";

const ADDRESS = "https://mcp.linear.app/mcp";

const PENDING = create(CompleteSignInOutputSchema, { pending: true });
const SAVED = create(CompleteSignInOutputSchema, { address: ADDRESS, description: "Linear @ana" });

/** The refusal of a sign-in that is over, as the server sends it: its reason in an ErrorInfo. */
function signInEnded(): StigmerError {
  const message = "this sign-in has expired or was already used: start it again";
  const cause = new ConnectError(message, Code.FailedPrecondition, undefined, [
    { desc: ErrorInfoSchema, value: create(ErrorInfoSchema, { reason: "SIGN_IN_ENDED", domain: "stigmer.ai" }) },
  ]);
  return new StigmerError("failed-precondition", message, Code.FailedPrecondition, { cause });
}

// A server that answers each ask with the next of `answers` (an output, or
// an error thrown), and keeps answering the last.
function fakeClient(answers: ReadonlyArray<CompleteSignInOutput | Error> = [SAVED]): {
  client: SignInClient;
  asks: CompleteSignInInput[];
  started: StartSignInInput[];
} {
  const asks: CompleteSignInInput[] = [];
  const started: StartSignInInput[] = [];
  const client = {
    vault: {
      startSignIn: async (input: StartSignInInput) => {
        started.push(input);
        return { authorizationUrl: "https://linear.app/oauth/authorize?x=1", state: "st-1", providerName: "Linear", scopes: [] };
      },
      completeSignIn: async (input: CompleteSignInInput) => {
        asks.push(input);
        const answer = answers[Math.min(asks.length, answers.length) - 1];
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  } as unknown as SignInClient;
  return { client, asks, started };
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
    canOpenBrowser: () => true,
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
  it("says to open the address by hand when the browser does not open", async () => {
    const { client } = fakeClient([SAVED]);
    const lines: string[] = [];
    await runSignIn(
      deps(client, {
        openBrowser: async () => {
          throw new Error("no opener");
        },
        log: (line) => lines.push(line),
      }),
    );
    expect(lines).toContain("  Could not open the browser automatically. Open the URL above in your browser.");
  });

  it("starts the sign-in in My vault at the address, opens its login page, and finishes that sign-in", async () => {
    const { client, started, asks } = fakeClient([PENDING, SAVED]);
    const opened: string[] = [];
    const lines: string[] = [];
    await runSignIn(deps(client, { openBrowser: async (url) => void opened.push(url), log: (line) => lines.push(line) }));
    expect(started).toHaveLength(1);
    expect(started[0]?.address).toBe(ADDRESS);
    expect(started[0]?.returnTo).toBe(SignInReturn.web);
    expect(started[0]?.vault?.org).toBe("acme");
    expect(started[0]?.vault?.vault).toEqual({ case: "mine", value: true });
    expect(opened).toEqual(["https://linear.app/oauth/authorize?x=1"]);
    expect(asks.map((ask) => [ask.state, ask.code])).toEqual([
      ["st-1", ""],
      ["st-1", ""],
    ]);
    expect(lines).toContain(`Signed in to 'linear'. Saved in My vault as "Linear @ana".\n`);
  });

  it("refuses an unreachable local console with the other ways, a pasted key only where accepted", async () => {
    const { client, started } = fakeClient();
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

describe("waitForSignIn", () => {
  it("asks again while pending and prints whose login was saved, the address when the login names no one", async () => {
    const lines: string[] = [];
    const { client, asks } = fakeClient([PENDING, PENDING, create(CompleteSignInOutputSchema, { address: ADDRESS })]);
    await waitForSignIn(deps(client, { log: (line) => lines.push(line) }), "st-1");
    expect(asks).toHaveLength(3);
    expect(lines).toContain(`Signed in to 'linear'. Saved in My vault as "${ADDRESS}".\n`);
  });

  it("asks again after a transient failure, at a growing pause", async () => {
    const pauses: number[] = [];
    const unavailable = new StigmerError("unavailable", "server restarting", Code.Unavailable);
    const { client, asks } = fakeClient([unavailable, unavailable, PENDING, SAVED]);
    await waitForSignIn(deps(client, { sleep: async (ms) => void pauses.push(ms) }), "st-1");
    expect(asks).toHaveLength(4);
    expect(pauses).toEqual([2000, 4000, 8000, 2000]);
  });

  it("reports the failed ask that took the sign-in, not that the sign-in ended", async () => {
    // The exchange failed at the login server (UNAVAILABLE); that ask took the sign-in.
    const exchange = new StigmerError("unavailable", "token exchange failed: invalid_grant", Code.Unavailable);
    const { client } = fakeClient([PENDING, exchange, signInEnded()]);
    await expect(waitForSignIn(deps(client), "st-1")).rejects.toBe(exchange);
  });

  it("names the command to run again for a sign-in that ended with no failure before it", async () => {
    const { client } = fakeClient([PENDING, signInEnded()]);
    const err = await waitForSignIn(deps(client), "st-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toBe(
      "the sign-in to 'linear' expired or was already used; run stigmer connect plugin linear to try again",
    );
  });

  it("ends in the login page's words when it refused", async () => {
    const refused = new StigmerError(
      "failed-precondition",
      "The login page did not sign you in: access_denied. Nothing was saved",
      Code.FailedPrecondition,
    );
    const { client, asks } = fakeClient([PENDING, refused]);
    await expect(waitForSignIn(deps(client), "st-1")).rejects.toBe(refused);
    expect(asks).toHaveLength(2);
  });
});

describe("readMyVault", () => {
  it("reads a missing My vault as none", async () => {
    const client = {
      vault: {
        getMine: async () => {
          throw new StigmerError("not-found", "no My vault", Code.NotFound);
        },
      },
    } as unknown as SignInClient;
    await expect(readMyVault(client, "acme")).resolves.toBeUndefined();
  });

  it("answers the vault when there is one", async () => {
    const vault = create(VaultSchema, { spec: { connections: { [ADDRESS]: {} } } });
    const client = { vault: { getMine: async () => vault } } as unknown as SignInClient;
    await expect(readMyVault(client, "acme")).resolves.toBe(vault);
  });
});
