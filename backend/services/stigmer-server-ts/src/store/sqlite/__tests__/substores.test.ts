/**
 * Pins the consolidated sub-stores against their Go references: the
 * two-phase signal-dedupe hold (Gap B2 / oss#442 —
 * workflowexecution/dedupe/signal_dedupe_store.go), the OAuth grant store,
 * and the once-only pending-OAuth-state redemption with its 10-minute TTL
 * (mcpserver/oauth/*.go). These surfaces were DB() escape hatches in Go;
 * here they are interface members (D2 §3, OD-3) and these tests are their
 * behavioral contract for the #19/#20 domain ports.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  IN_FLIGHT_CLAIM_TTL_MS,
  type OAuthGrant,
  type PendingOAuthState,
} from "../../interface.js";
import { tempStore, type TempStore } from "./support.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("signal dedupe (two-phase hold)", () => {
  it("claims a fresh key, reports the holder on a duplicate claim", async () => {
    const first = await temp.store.signalDedupe.claim(
      "acme", "key-1", "wfe_1", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(first.status).toBe("SUCCESS");
    expect(first.record).toBeUndefined();

    const second = await temp.store.signalDedupe.claim(
      "acme", "key-1", "wfe_2", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(second.status).toBe("DUPLICATE");
    // The caller branches on the HOLDER's state: CLAIMED = in-flight
    // conflict, DELIVERED = true duplicate.
    expect(second.record?.status).toBe("CLAIMED");
    expect(second.record?.executionId).toBe("wfe_1");
  });

  it("keys are org-scoped: the same idempotency key in another org claims freely", async () => {
    await temp.store.signalDedupe.claim("acme", "key-1", "wfe_1", "resume", IN_FLIGHT_CLAIM_TTL_MS);
    const other = await temp.store.signalDedupe.claim(
      "globex", "key-1", "wfe_9", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(other.status).toBe("SUCCESS");
  });

  it("markDelivered flips the status and extends the hold to the 24h window", async () => {
    await temp.store.signalDedupe.claim("acme", "key-1", "wfe_1", "resume", IN_FLIGHT_CLAIM_TTL_MS);
    await temp.store.signalDedupe.markDelivered("acme", "key-1");

    const dup = await temp.store.signalDedupe.claim(
      "acme", "key-1", "wfe_2", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(dup.status).toBe("DUPLICATE");
    expect(dup.record?.status).toBe("DELIVERED");
    expect(dup.record?.deliveredAt).not.toBe("");
    // Delivery EARNS the long window: expiry moved past the in-flight TTL.
    const expiry = Date.parse(dup.record!.expiresAt);
    expect(expiry).toBeGreaterThan(Date.now() + IN_FLIGHT_CLAIM_TTL_MS);
  });

  it("markDelivered on a missing or already-delivered key is a tolerant no-op", async () => {
    await expect(temp.store.signalDedupe.markDelivered("acme", "ghost")).resolves.toBeUndefined();
    await temp.store.signalDedupe.claim("acme", "key-1", "wfe_1", "resume", IN_FLIGHT_CLAIM_TTL_MS);
    await temp.store.signalDedupe.markDelivered("acme", "key-1");
    await expect(temp.store.signalDedupe.markDelivered("acme", "key-1")).resolves.toBeUndefined();
  });

  it("release frees a CLAIMED key immediately but never a DELIVERED one", async () => {
    await temp.store.signalDedupe.claim("acme", "key-1", "wfe_1", "resume", IN_FLIGHT_CLAIM_TTL_MS);
    await temp.store.signalDedupe.release("acme", "key-1");
    const reclaimed = await temp.store.signalDedupe.claim(
      "acme", "key-1", "wfe_2", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(reclaimed.status, "a released key is claimable at once").toBe("SUCCESS");

    await temp.store.signalDedupe.markDelivered("acme", "key-1");
    await temp.store.signalDedupe.release("acme", "key-1"); // guarded no-op
    const stillBlocked = await temp.store.signalDedupe.claim(
      "acme", "key-1", "wfe_3", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(stillBlocked.status, "a delivered key survives a misplaced release").toBe("DUPLICATE");
  });

  it("an expired hold self-heals: the next claim cleans it up and wins", async () => {
    // Crash recovery path: a claim whose delivery died holds only the
    // short TTL. Simulate the lapse by aging the row directly.
    await temp.store.signalDedupe.claim("acme", "key-1", "wfe_1", "resume", IN_FLIGHT_CLAIM_TTL_MS);
    const db = new DatabaseSync(temp.dbPath);
    db.prepare(`UPDATE signal_dedupe SET expires_at = ? WHERE id = 'acme:key-1'`).run(
      new Date(Date.now() - 1000).toISOString(),
    );
    db.close();

    const reclaimed = await temp.store.signalDedupe.claim(
      "acme", "key-1", "wfe_2", "resume", IN_FLIGHT_CLAIM_TTL_MS,
    );
    expect(reclaimed.status).toBe("SUCCESS");
  });
});

describe("oauth grants", () => {
  const grant: OAuthGrant = {
    identityAccountId: "ida_1",
    resourceId: "mcp_1",
    resourceKind: "mcp_server",
    orgId: "acme",
    accessTokenExpiresAt: 1755648000,
    clientId: "client-1",
    authMethod: "mcp_oauth",
    tokenEndpoint: "https://example.test/token",
    accessTokenEnvVar: "TOKEN",
    refreshTokenEnvVar: "REFRESH",
    environmentId: "env_1",
    createdAt: 0,
    updatedAt: 0,
  };

  it("upsert stamps createdAt on first insert and refreshes updatedAt on replace", async () => {
    await temp.store.oauthGrants.upsert(grant);
    const first = await temp.store.oauthGrants.find("ida_1", "mcp_1", "acme");
    expect(first).toBeDefined();
    expect(first!.createdAt).toBeGreaterThan(0);

    await temp.store.oauthGrants.upsert({ ...grant, clientId: "client-2" });
    const second = await temp.store.oauthGrants.find("ida_1", "mcp_1", "acme");
    expect(second!.clientId).toBe("client-2");
    expect(second!.createdAt, "createdAt survives the upsert").toBe(first!.createdAt);
  });

  it("find returns undefined (not an error) when absent; delete removes by composite key", async () => {
    expect(await temp.store.oauthGrants.find("ida_x", "mcp_x", "acme")).toBeUndefined();

    await temp.store.oauthGrants.upsert(grant);
    await temp.store.oauthGrants.delete("ida_1", "mcp_1", "acme");
    expect(await temp.store.oauthGrants.find("ida_1", "mcp_1", "acme")).toBeUndefined();
  });
});

describe("pending oauth state", () => {
  const state: PendingOAuthState = {
    state: "state-1",
    codeVerifier: "enc:v1:sealed-verifier",
    clientId: "client-1",
    clientSecret: "",
    tokenEndpoint: "https://example.test/token",
    mcpServerId: "mcp_1",
    identityAccountId: "ida_1",
    targetEnvVar: "TOKEN",
    authMethod: "mcp_oauth",
    tokenAuthMethod: "",
    redirectUri: "http://127.0.0.1/cb",
    org: "acme",
    createdAt: 0,
  };

  it("getAndDelete redeems a state exactly once", async () => {
    await temp.store.pendingOAuthStates.save(state);

    const redeemed = await temp.store.pendingOAuthStates.getAndDelete("state-1");
    expect(redeemed?.codeVerifier).toBe("enc:v1:sealed-verifier");
    expect(redeemed?.org).toBe("acme");

    const second = await temp.store.pendingOAuthStates.getAndDelete("state-1");
    expect(second, "a state can never be redeemed twice").toBeUndefined();
  });

  it("an expired state is deleted on redemption and returns undefined", async () => {
    await temp.store.pendingOAuthStates.save({
      ...state,
      // Aged past the 10-minute TTL.
      createdAt: Math.floor(Date.now() / 1000) - 11 * 60,
    });

    expect(await temp.store.pendingOAuthStates.getAndDelete("state-1")).toBeUndefined();

    const db = new DatabaseSync(temp.dbPath);
    const count = db.prepare(`SELECT COUNT(*) AS count FROM pending_oauth_state`).get() as {
      count: number;
    };
    db.close();
    expect(count.count, "the expired row is gone").toBe(0);
  });

  it("unknown states return undefined; cleanupExpired reports the count removed", async () => {
    expect(await temp.store.pendingOAuthStates.getAndDelete("ghost")).toBeUndefined();

    await temp.store.pendingOAuthStates.save(state); // fresh
    await temp.store.pendingOAuthStates.save({
      ...state,
      state: "state-old",
      createdAt: Math.floor(Date.now() / 1000) - 11 * 60,
    });

    expect(await temp.store.pendingOAuthStates.cleanupExpired()).toBe(1);
    expect(await temp.store.pendingOAuthStates.getAndDelete("state-1")).toBeDefined();
  });
});
