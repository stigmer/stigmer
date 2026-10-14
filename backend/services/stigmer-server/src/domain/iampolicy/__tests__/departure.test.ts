/**
 * Pins a person's departure from an organization: when the grant path's
 * sweep runs (a revoke that leaves the person no row on the organization,
 * and every revokeOrgAccess), the leaving person's My vault in that
 * organization is deleted with every sealed value it held handed to the
 * secret facade's destroy, and nothing else: a teammate's My vault, the
 * same person's My vault in another organization and a person who keeps a
 * role all stay. A person with no My vault is a no-op, so a retry
 * converges; a departure that fails fails the revoke after the role is
 * gone, and a retry of the same revoke (the row already gone) sweeps
 * again and deletes the My vault, its sealed values destroyed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { SecretService } from "../../../encryption/encryption.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { newVaultService } from "../../vault/service.js";
import type { VaultService } from "../../vault/service.js";
import { newMyVaultDeparture } from "../departure.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import { NO_STORED_RESOURCES, fakeIamPolicyStore, orgRole } from "./support.js";
import type { RecordedEvent } from "./support.js";

const ORG = "org_01jz0000000000000000000000";
const OTHER_ORG = "org_01jz0000000000000000000001";
const ALICE = "ida_wtr3jcf281yfk9xx61kj59fsme";
const BOB = "ida_0byc5k14t1e7b7kdxft7hwz1f7";

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function person(id: string): CallerIdentity {
  return { identityId: id, callerClass: "user", issuer: "", rawToken: "" };
}

const admin: CallerIdentity = person("ida_admin00000000000000000000");

let dir: string;
let store: SqliteStore;
let secretService: SecretService;
let vaults: VaultService;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stigmer-departure-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, { listIndexes: LIST_INDEXES });
  secretService = SecretService.create(Buffer.alloc(32, 7));
  vaults = newVaultService({
    store,
    logger: silentLogger,
    secretService,
    authorizationLifecycle: undefined,
  });
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function myVaultWithSecret(org: string, who: string): Promise<string> {
  const vault = await vaults.ensureMine(org, person(who));
  const id = vault.metadata?.id ?? "";
  await vaults.setSecrets(
    id,
    { OPENAI_API_KEY: { value: `sk-${who}-${org}`, description: "" } },
    person(who),
  );
  await vaults.setConnection(
    id,
    "https://mcp.linear.app/mcp",
    { token: `lin-${who}`, source: VaultConnectionSource.pasted, description: "" },
    person(who),
  );
  return id;
}

function grantPath(failing: boolean | (() => boolean) = false) {
  const recorded: RecordedEvent[] = [];
  const failsNow = typeof failing === "function" ? failing : () => failing;
  const departure = newMyVaultDeparture({
    store,
    logger: silentLogger,
    secretService,
    authorizationLifecycle: undefined,
    vaults,
  });
  return newIamPolicyGrantPath({
    policies: fakeIamPolicyStore(recorded),
    resources: NO_STORED_RESOURCES,
    lifecycle: undefined,
    logger: silentLogger,
    departures: async (...args) => {
      if (failsNow()) {
        throw new Error("vault store unavailable");
      }
      await departure(...args);
    },
  });
}

describe("a person leaving an organization takes their My vault with them", () => {
  it("revoking a member's last role deletes their My vault there and destroys its sealed values", async () => {
    const aliceVault = await myVaultWithSecret(ORG, ALICE);
    const bobVault = await myVaultWithSecret(ORG, BOB);
    const aliceElsewhere = await myVaultWithSecret(OTHER_ORG, ALICE);
    const stored = await vaults.findById(aliceVault);
    const sealed = [
      stored?.spec?.secrets["OPENAI_API_KEY"]?.value ?? "",
      stored?.spec?.connections["https://mcp.linear.app/mcp"]?.token ?? "",
    ];
    expect(sealed.every((value) => value.startsWith("enc:"))).toBe(true);
    const destroyed = vi.spyOn(secretService, "delete");

    const path = grantPath();
    await path.grant(orgRole(ALICE, "member", ORG), admin, "grant");
    await path.revokeBySpec(orgRole(ALICE, "member", ORG), admin);

    expect(await vaults.findById(aliceVault)).toBeUndefined();
    expect(await vaults.findMine(ORG, ALICE)).toBeUndefined();
    expect(destroyed.mock.calls.map(([value]) => value).sort()).toEqual(
      [...sealed].sort(),
    );
    expect(await vaults.findById(bobVault), "a teammate's My vault stays").toBeDefined();
    expect(
      await vaults.findById(aliceElsewhere),
      "her My vault in another organization stays",
    ).toBeDefined();
  });

  it("a person who keeps another role on the organization keeps their My vault", async () => {
    const aliceVault = await myVaultWithSecret(ORG, ALICE);
    const path = grantPath();
    await path.grant(orgRole(ALICE, "member", ORG), admin, "grant");
    await path.grant(orgRole(ALICE, "admin", ORG), admin, "grant");
    await path.revokeBySpec(orgRole(ALICE, "admin", ORG), admin);

    expect(await vaults.findById(aliceVault)).toBeDefined();
  });

  it("revokeOrgAccess deletes it, and a retry with nothing left converges", async () => {
    const aliceVault = await myVaultWithSecret(ORG, ALICE);
    const path = grantPath();
    await path.grant(orgRole(ALICE, "member", ORG), admin, "grant");
    await path.revokeOrgAccess(ALICE, ORG, admin);
    expect(await vaults.findById(aliceVault)).toBeUndefined();

    await expect(path.revokeOrgAccess(ALICE, ORG, admin)).resolves.toBeUndefined();
  });

  it("a person who returns starts with an empty My vault of their own", async () => {
    const before = await myVaultWithSecret(ORG, ALICE);
    const path = grantPath();
    await path.grant(orgRole(ALICE, "member", ORG), admin, "grant");
    await path.revokeOrgAccess(ALICE, ORG, admin);

    const after = await vaults.ensureMine(ORG, person(ALICE));
    expect(after.metadata?.id).not.toBe(before);
    expect(Object.keys(after.spec?.secrets ?? {})).toEqual([]);
  });

  it("a departure that fails fails the revoke after the role is gone", async () => {
    const path = grantPath(true);
    await path.grant(orgRole(ALICE, "member", ORG), admin, "grant");
    await expect(path.revokeBySpec(orgRole(ALICE, "member", ORG), admin)).rejects.toThrow(
      "vault store unavailable",
    );
  });

  it("a retried revoke after a failed departure deletes the My vault and destroys its sealed values", async () => {
    const aliceVault = await myVaultWithSecret(ORG, ALICE);
    const stored = await vaults.findById(aliceVault);
    const sealed = [
      stored?.spec?.secrets["OPENAI_API_KEY"]?.value ?? "",
      stored?.spec?.connections["https://mcp.linear.app/mcp"]?.token ?? "",
    ];
    const destroyed = vi.spyOn(secretService, "delete");
    let failures = 1;
    const path = grantPath(() => failures-- > 0);
    await path.grant(orgRole(ALICE, "member", ORG), admin, "grant");

    await expect(path.revokeBySpec(orgRole(ALICE, "member", ORG), admin)).rejects.toThrow(
      "vault store unavailable",
    );
    expect(await vaults.findById(aliceVault), "the failed departure deleted nothing").toBeDefined();
    expect(destroyed).not.toHaveBeenCalled();

    // The role row went with the first attempt; the retry finds none and sweeps again.
    await expect(path.revokeBySpec(orgRole(ALICE, "member", ORG), admin)).resolves.toBeUndefined();
    expect(await vaults.findById(aliceVault)).toBeUndefined();
    expect(await vaults.findMine(ORG, ALICE)).toBeUndefined();
    expect(destroyed.mock.calls.map(([value]) => value).sort()).toEqual([...sealed].sort());
  });
});
