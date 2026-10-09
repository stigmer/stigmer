/**
 * Pins which client a sign-in at an address uses, and what it sends, at
 * the handler layer over the rig's recording fetch (support.ts):
 *
 *   - the order: the organization's own app for the address, then
 *     Stigmer's catalog entry switched on by the deployment's settings, then
 *     the address's own login server; a Git host stops before discovery;
 *   - a discovered login server registers Stigmer once: two sign-ins at one
 *     address, and sign-ins at two addresses behind one login server, share
 *     one client; a client the login server has forgotten is dropped and
 *     registered again once, at the start's pre-flight or at the exchange's
 *     invalid_client;
 *   - a login server that takes a Client ID Metadata Document gets the
 *     document's URL as the client id and no registration, when the
 *     deployment offers one;
 *   - `resource` rides both requests to a discovered login server and
 *     neither through an app; the address's own scopes are asked first;
 *   - a protected-resource document naming another resource is discarded,
 *     so a sign-in never goes to the login server it names;
 *   - nothing to sign in with is refused, naming the address and what helps.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CompleteSignInInputSchema,
  StartSignInInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type { StartSignInOutput } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";

import type { ConnectLinkDeps } from "../../connect-link.js";
import { completePersonSignIn, startPersonSignIn } from "../person.js";
import {
  LOGIN_SERVER,
  MCP_ADDRESS,
  ORG,
  OTHER_MCP_ADDRESS,
  VENDOR_ADDRESS,
  alice,
  expectRefusal,
  myLogin,
  openSignInRig,
  seedOrganizationApp,
} from "./support.js";
import type { SignInRig } from "./support.js";

let rig: SignInRig;

beforeEach(() => {
  rig = openSignInRig();
});

afterEach(() => {
  rig.close();
});

function start(address: string, deps: Partial<ConnectLinkDeps> = {}): Promise<StartSignInOutput> {
  return startPersonSignIn(
    rig.deps(deps),
    create(StartSignInInputSchema, { vault: { org: ORG, vault: { case: "mine", value: true } }, address }),
    alice,
  );
}

function complete(state: string) {
  return completePersonSignIn(rig.deps(), create(CompleteSignInInputSchema, { state, code: "code" }), alice);
}

const params = (started: StartSignInOutput) => new URL(started.authorizationUrl).searchParams;
const registrations = () => rig.requestsTo(`${LOGIN_SERVER}/register`);
const GITHUB_SETTINGS = new Map([["github", { clientId: "gh-client", clientSecret: "gh-secret" }]]);

describe("the order a login is found in", () => {
  it("an organization's app for the address wins over Stigmer's catalog entry", async () => {
    await seedOrganizationApp(rig, { addresses: ["github.com"] });
    const started = await start("github.com", { loginProviders: GITHUB_SETTINGS });
    expect(started.providerName).toBe("Vendor");
    expect(params(started).get("client_id")).toBe("vendor-client");
  });

  it("Stigmer's catalog entry serves its addresses when switched on, and wins over discovery", async () => {
    const forGit = await start("github.com", { loginProviders: GITHUB_SETTINGS });
    expect(forGit.providerName).toBe("GitHub");
    expect(forGit.authorizationUrl.startsWith("https://github.com/login/oauth/authorize?")).toBe(true);
    expect(params(forGit).get("client_id")).toBe("gh-client");
    expect(params(forGit).get("scope")).toBe("repo read:user");

    const forTool = await start("https://api.githubcopilot.com/mcp", { loginProviders: GITHUB_SETTINGS });
    expect(params(forTool).get("client_id")).toBe("gh-client");
    // Through an app nothing is discovered and nothing is sent ahead.
    expect(rig.requests).toEqual([]);
  });

  it("a catalog entry switched off leaves a Git host with nothing to sign in with", async () => {
    await expectRefusal(
      start("github.com"),
      Code.FailedPrecondition,
      "nothing can sign in to github.com: no login app serves this Git host",
    );
    expect(rig.requests).toEqual([]);
  });

  it("an address with neither finds its own login server", async () => {
    const started = await start(MCP_ADDRESS);
    expect(started.providerName).toBe("mcp.linear.example");
    expect(started.authorizationUrl.startsWith(`${LOGIN_SERVER}/authorize?`)).toBe(true);
    // The address's own scopes are asked ahead of the login server's.
    expect(started.scopes).toEqual(["issues:read"]);
  });
});

describe("registration with a discovered login server", () => {
  it("registers once: a second sign-in, and a sign-in at another address behind the same login server, reuse the client", async () => {
    const first = await start(MCP_ADDRESS);
    const second = await start(MCP_ADDRESS);
    const elsewhere = await start(OTHER_MCP_ADDRESS);
    expect(registrations()).toHaveLength(1);
    expect(params(second).get("client_id")).toBe(params(first).get("client_id"));
    expect(params(elsewhere).get("client_id")).toBe(params(first).get("client_id"));
    expect(params(elsewhere).get("resource")).toBe(OTHER_MCP_ADDRESS);
    const registered = JSON.parse(registrations()[0]!.body) as { client_name: string; redirect_uris: string[] };
    expect(registered.client_name).toBe("Stigmer");
    expect(await rig.store.oauthClientRegistrations.find(LOGIN_SERVER, registered.redirect_uris[0]!)).toBe(
      params(first).get("client_id"),
    );
  });

  it("drops a client the login server forgot at the pre-flight, registers again once, and refuses a second refusal", async () => {
    const first = await start(MCP_ADDRESS);
    const forgotten = params(first).get("client_id")!;
    rig.levers.forgotten.add(forgotten);
    const again = await start(MCP_ADDRESS);
    expect(registrations()).toHaveLength(2);
    expect(params(again).get("client_id")).not.toBe(forgotten);

    // A login server that refuses every client: one new registration, then the refusal.
    rig.levers.rejectAuthorize = true;
    await expectRefusal(start(MCP_ADDRESS), Code.FailedPrecondition, "rejected the sign-in request before showing a login page");
    expect(registrations()).toHaveLength(3);
  });

  it("drops a client the login server forgot at the exchange's invalid_client, so the next sign-in registers anew", async () => {
    const started = await start(MCP_ADDRESS);
    const client = params(started).get("client_id")!;
    rig.levers.forgotten.add(client);
    await expectRefusal(complete(started.state), Code.FailedPrecondition, "no longer knows Stigmer's client: sign in again");
    expect(await myLogin(rig, alice, MCP_ADDRESS)).toBeUndefined();
    rig.levers.forgotten.clear();
    await start(MCP_ADDRESS);
    expect(registrations()).toHaveLength(2);
  });

  it("a login server taking a Client ID Metadata Document gets its URL as the client id and no registration", async () => {
    rig.levers.cimd = true;
    const documentUrl = "https://stigmer.example/v1/oauth/client.json";
    const started = await start(MCP_ADDRESS, { clientDocumentUrl: documentUrl });
    expect(params(started).get("client_id")).toBe(documentUrl);
    expect(registrations()).toEqual([]);
    // Without a public https origin the deployment offers no document, and registers.
    await start(MCP_ADDRESS);
    expect(registrations()).toHaveLength(1);
  });

  it("refuses a login server that registers no clients, naming the address and what helps", async () => {
    rig.levers.noRegistration = true;
    await expectRefusal(
      start(MCP_ADDRESS),
      Code.FailedPrecondition,
      `nothing can sign in to ${MCP_ADDRESS}: login.linear.example does not allow automatic client registration. Add a login app for ${MCP_ADDRESS} in Settings, or paste a token`,
    );
  });
});

describe("the resource a token is minted for", () => {
  it("rides the authorization request and the exchange to a discovered login server", async () => {
    const started = await start(MCP_ADDRESS);
    expect(params(started).get("resource")).toBe(MCP_ADDRESS);
    await complete(started.state);
    const exchange = rig.requestsTo(`${LOGIN_SERVER}/token`)[0]!;
    expect(new URLSearchParams(exchange.body).get("resource")).toBe(MCP_ADDRESS);
    expect(await myLogin(rig, alice, MCP_ADDRESS)).toBe("at-default");
  });

  it("is never sent through a login app", async () => {
    await seedOrganizationApp(rig);
    const started = await start(VENDOR_ADDRESS);
    expect(params(started).has("resource")).toBe(false);
    await complete(started.state);
    expect(new URLSearchParams(rig.requestsTo("https://login.vendor.example/token")[0]!.body).has("resource")).toBe(false);
  });

  it("never goes to a login server a protected-resource document names for another resource", async () => {
    rig.levers.foreignResource = true;
    await expectRefusal(start(MCP_ADDRESS), Code.FailedPrecondition, `nothing can sign in to ${MCP_ADDRESS}`);
    expect(rig.requestsTo("https://login.victim.example")).toEqual([]);
  });
});
