/**
 * Pins Connect links at the handler layer, over a REAL sqlite store and
 * vault service with the sign-in rig's recording fetch
 * (sign-in/__tests__/support.ts):
 *
 *   - creation refuses My vault, an address nothing can sign in to, a
 *     return URL that is not https (http only for this machine) or carries
 *     credentials, and a vault of another organization; it answers the
 *     console's page for the link and keeps only the secret's SHA-256;
 *   - a link saves a sign-in into its vault with no Stigmer sign-in, saved
 *     by the link's maker, and answers its return URL with
 *     stigmer_connect=connected;
 *   - a link works once: used again, expired or unknown, it answers
 *     NOT_FOUND the same way;
 *   - a state belongs to its link: another link's state, and a person's,
 *     cannot complete it, and a person cannot complete a link's state;
 *   - a maker who can no longer edit the vault spends nothing: the start
 *     answers NOT_FOUND and the completion answers not_allowed; the maker is
 *     re-checked as the caller class and bound organization that made the
 *     link;
 *   - a sign-in that fails after the login page answers the return URL with
 *     its reason and leaves the link usable; a link that expires while its
 *     customer is on the login page sends them back with reason=expired,
 *     and one long expired answers NOT_FOUND;
 *   - a link's sign-in never inherits the refresh token another customer's
 *     sign-in at the address left.
 */
import { create } from "@bufbuild/protobuf";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CompleteConnectLinkInputSchema,
  ConnectLinkTokenInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import {
  CompleteSignInInputSchema,
  CreateConnectLinkInputSchema,
  StartSignInInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  completeConnectLink,
  createConnectLink,
  getConnectLink,
  hashLinkToken,
  startConnectLink,
} from "../connect-link.js";
import { completePersonSignIn, startPersonSignIn } from "../sign-in/person.js";
import {
  MCP_ADDRESS,
  ORG,
  OTHER_ORG,
  VENDOR_ADDRESS,
  alice,
  expectRefusal,
  openSignInRig,
  seedOrganizationApp,
  seedSharedVault,
  vaultLogin,
} from "../sign-in/__tests__/support.js";
import type { SignInRig } from "../sign-in/__tests__/support.js";

let rig: SignInRig;

beforeEach(() => {
  rig = openSignInRig();
});

afterEach(() => {
  rig.close();
});

const RETURN_URL = "https://helpdesk.example/integrations/done";

async function makeLink(
  init: {
    vaultId?: string;
    address?: string;
    returnUrl?: string;
    expiresInSeconds?: number;
    org?: string;
    maker?: CallerIdentity;
  } = {},
): Promise<{ token: string; url: string; expiresAtMs: number }> {
  const link = await createConnectLink(
    rig.deps(),
    create(CreateConnectLinkInputSchema, {
      org: init.org ?? ORG,
      vaultId: init.vaultId ?? "vlt_shared",
      address: init.address ?? VENDOR_ADDRESS,
      returnUrl: init.returnUrl ?? RETURN_URL,
      expiresInSeconds: init.expiresInSeconds ?? 0,
    }),
    init.maker ?? alice,
  );
  return {
    token: link.url.slice(link.url.lastIndexOf("/") + 1),
    url: link.url,
    expiresAtMs: timestampMs(link.expiresAt!),
  };
}

const tokenInput = (token: string) => create(ConnectLinkTokenInputSchema, { token });

async function finish(token: string, state: string, code = "code", error = "") {
  return completeConnectLink(rig.deps(), create(CompleteConnectLinkInputSchema, { token, state, code, error }));
}

async function seeded(): Promise<void> {
  await seedOrganizationApp(rig);
  await seedSharedVault(rig);
}

describe("creating a link", () => {
  it("answers the console's page for it, 30 minutes by default, keeping only the secret's SHA-256", async () => {
    await seeded();
    const before = Date.now();
    const link = await makeLink();
    expect(link.url).toBe(`http://127.0.0.1:8234/connect/${link.token}`);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.expiresAtMs - before).toBeGreaterThanOrEqual(29 * 60 * 1000);
    expect(link.expiresAtMs - before).toBeLessThanOrEqual(31 * 60 * 1000);
    const stored = await rig.store.connectLinks.findUsable(hashLinkToken(link.token), Math.floor(Date.now() / 1000));
    expect(stored).toMatchObject({ vaultId: "vlt_shared", address: VENDOR_ADDRESS, createdBy: alice.identityId, usedAt: 0 });
    expect(JSON.stringify(stored)).not.toContain(link.token);
  });

  it("refuses My vault: a link is for someone else", async () => {
    await seedOrganizationApp(rig);
    const mine = await rig.vaults.ensureMine(ORG, alice);
    await expectRefusal(makeLink({ vaultId: mine.metadata!.id }), Code.FailedPrecondition, "a Connect link saves into a shared vault");
  });

  it("refuses an address nothing can sign in to, registering nothing", async () => {
    await seedSharedVault(rig);
    await expectRefusal(makeLink({ address: "gitlab.example.com" }), Code.FailedPrecondition, "nothing can sign in to gitlab.example.com");
    rig.levers.noRegistration = true;
    await expectRefusal(makeLink({ address: MCP_ADDRESS }), Code.FailedPrecondition, `nothing can sign in to ${MCP_ADDRESS}`);
    expect(rig.requestsTo("https://login.linear.example/register")).toEqual([]);
  });

  it("asks a discovered login server without registering with it", async () => {
    await seedSharedVault(rig);
    await makeLink({ address: MCP_ADDRESS });
    expect(rig.requestsTo("https://login.linear.example/register")).toEqual([]);
  });

  it.each([
    ["an http URL off this machine", "http://helpdesk.example/done", "must be an https URL"],
    ["a URL with credentials", "https://user:pass@helpdesk.example/done", "must not carry a user name or password"],
    ["a relative URL", "/done", "must be an absolute https URL"],
  ])("refuses %s as the return URL", async (_what, returnUrl, fragment) => {
    await seeded();
    await expectRefusal(makeLink({ returnUrl }), Code.InvalidArgument, fragment);
  });

  it("takes http for localhost, for development", async () => {
    await seeded();
    await makeLink({ returnUrl: "http://localhost:3000/done" });
  });

  it("answers NOT_FOUND for a vault of another organization", async () => {
    await seeded();
    await expectRefusal(makeLink({ org: OTHER_ORG }), Code.NotFound, "vault not found");
  });
});

describe("using a link", () => {
  it("saves the sign-in into its vault with no Stigmer sign-in, saved by its maker, and answers the return URL", async () => {
    await seeded();
    const link = await makeLink();
    const info = await getConnectLink(rig.deps(), tokenInput(link.token));
    expect(info).toMatchObject({ providerName: "Vendor", address: VENDOR_ADDRESS });

    const started = await startConnectLink(rig.deps(), tokenInput(link.token));
    expect(new URL(started.authorizationUrl).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8234/auth/oauth/callback");
    const done = await finish(link.token, started.state);
    expect(done.returnUrl).toBe(`${RETURN_URL}?stigmer_connect=connected`);
    expect(await vaultLogin(rig, "vlt_shared", VENDOR_ADDRESS)).toBe("at-default");
    expect((await rig.vaults.findById("vlt_shared"))?.spec?.connections[VENDOR_ADDRESS]?.savedBy).toBe(alice.identityId);
  });

  it("works once: used, expired and unknown links answer NOT_FOUND alike", async () => {
    await seeded();
    const used = await makeLink();
    await finish(used.token, (await startConnectLink(rig.deps(), tokenInput(used.token))).state);
    const now = Math.floor(Date.now() / 1000);
    await rig.store.connectLinks.create({
      tokenHash: hashLinkToken("expired-token"),
      org: ORG,
      vaultId: "vlt_shared",
      address: VENDOR_ADDRESS,
      returnUrl: RETURN_URL,
      createdBy: alice.identityId,
      createdByClass: "user",
      createdByBoundOrg: "",
      createdAt: now - 1900,
      expiresAt: now - 100,
      usedAt: 0,
    });
    for (const token of [used.token, "expired-token", "never-issued"]) {
      await expectRefusal(getConnectLink(rig.deps(), tokenInput(token)), Code.NotFound, "Connect link not found");
      await expectRefusal(startConnectLink(rig.deps(), tokenInput(token)), Code.NotFound, "Connect link not found");
      await expectRefusal(finish(token, "any-state"), Code.NotFound, "Connect link not found");
    }
  });

  it("a state belongs to its link: another link's and a person's are refused, and a person cannot finish a link's", async () => {
    await seeded();
    const first = await makeLink();
    const second = await makeLink();
    const firstState = (await startConnectLink(rig.deps(), tokenInput(first.token))).state;
    await expectRefusal(finish(second.token, firstState), Code.FailedPrecondition, "was not started by this Connect link");

    const person = await startPersonSignIn(
      rig.deps(),
      create(StartSignInInputSchema, { vault: { org: ORG, vault: { case: "mine", value: true } }, address: VENDOR_ADDRESS }),
      alice,
    );
    await expectRefusal(finish(second.token, person.state), Code.FailedPrecondition, "was not started by this Connect link");

    const linkState = (await startConnectLink(rig.deps(), tokenInput(second.token))).state;
    await expectRefusal(
      completePersonSignIn(rig.deps(), create(CompleteSignInInputSchema, { state: linkState, code: "code" }), alice),
      Code.FailedPrecondition,
      "started by a Connect link",
    );
    expect(await vaultLogin(rig, "vlt_shared", VENDOR_ADDRESS)).toBeUndefined();
    expect(rig.requestsTo("https://login.vendor.example/token")).toEqual([]);
  });

  it("a maker who can no longer edit the vault spends nothing: start answers NOT_FOUND, completion not_allowed", async () => {
    await seeded();
    const link = await makeLink();
    const state = (await startConnectLink(rig.deps(), tokenInput(link.token))).state;
    rig.levers.denyVaultEditFor = alice.identityId;
    await expectRefusal(startConnectLink(rig.deps(), tokenInput(link.token)), Code.NotFound, "Connect link not found");
    expect((await finish(link.token, state)).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=not_allowed`);
    expect(rig.requestsTo("https://login.vendor.example/token")).toEqual([]);
  });

  it("re-checks its maker as the caller class and bound organization that made it", async () => {
    await seeded();
    const machine: CallerIdentity = { ...alice, callerClass: "machine", boundOrg: ORG };
    const link = await makeLink({ maker: machine });
    rig.levers.denyVaultEditForClass = "user";
    const state = (await startConnectLink(rig.deps(), tokenInput(link.token))).state;
    expect((await finish(link.token, state)).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=connected`);
  });

  it("sends a customer back with reason=expired when the link lapsed on the login page, and long-expired links answer NOT_FOUND", async () => {
    await seeded();
    const link = await makeLink({ expiresInSeconds: 60 });
    const state = (await startConnectLink(rig.deps(), tokenInput(link.token))).state;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 120_000);
      expect((await finish(link.token, state)).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=expired`);
      expect(rig.requestsTo("https://login.vendor.example/token")).toEqual([]);
      await expectRefusal(finish(link.token, state), Code.NotFound, "Connect link not found");

      const late = await makeLink({ expiresInSeconds: 60 });
      const lateState = (await startConnectLink(rig.deps(), tokenInput(late.token))).state;
      vi.setSystemTime(Date.now() + 20 * 60_000);
      await expectRefusal(finish(late.token, lateState), Code.NotFound, "Connect link not found");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never hands one customer's refresh token to another customer's sign-in at the address", async () => {
    await seeded();
    const first = await makeLink();
    rig.levers.tokenBodies.push({ body: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 } });
    await finish(first.token, (await startConnectLink(rig.deps(), tokenInput(first.token))).state);
    const second = await makeLink();
    rig.levers.tokenBodies.push({ body: { access_token: "at-2", expires_in: 3600 } });
    await finish(second.token, (await startConnectLink(rig.deps(), tokenInput(second.token))).state);

    const vault = (await rig.vaults.findById("vlt_shared"))!;
    const saved = (await rig.vaults.open(vault)).connections.get(VENDOR_ADDRESS)!;
    expect(saved.token).toBe("at-2");
    expect((await saved.refreshToken?.()) ?? "").toBe("");
  });

  it("answers its reason and stays usable when the customer declines, the sign-in expired, or the exchange failed", async () => {
    await seeded();
    const link = await makeLink();
    let state = (await startConnectLink(rig.deps(), tokenInput(link.token))).state;
    expect((await finish(link.token, state, "", "access_denied")).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=denied`);
    expect((await finish(link.token, "", "", "server_error")).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=provider_error`);
    expect((await finish(link.token, "a-state-long-gone")).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=expired`);

    state = (await startConnectLink(rig.deps(), tokenInput(link.token))).state;
    rig.levers.tokenBodies.push({ status: 500, body: { error: "server_error" } });
    expect((await finish(link.token, state)).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=error&reason=failed`);

    state = (await startConnectLink(rig.deps(), tokenInput(link.token))).state;
    expect((await finish(link.token, state)).returnUrl).toBe(`${RETURN_URL}?stigmer_connect=connected`);
    expect(await vaultLogin(rig, "vlt_shared", VENDOR_ADDRESS)).toBe("at-default");
  });
});
