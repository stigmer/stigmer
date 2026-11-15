/**
 * Pins the vault delete tail's edges: an account's deletion removes its
 * My vault in every organization and no one else's, its sealed values
 * destroyed and its names freed, found by the person each row belongs to,
 * so a vault whose name claim is missing or held by another row goes too;
 * a member's departure from one organization does the same there alone; a
 * name that cannot be released, or a Connect link that cannot be removed,
 * after the row is gone is logged, never failing the delete.
 *
 * And a vault row the real store cannot decode, planted as an older binary
 * writes one (stigmer/stigmer#2774): it fails an account's deletion before
 * any vault goes, whoever's it is, and the retry after the repair deletes
 * them all; it fails a departure when the person's own claim names it, and
 * no other departure.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";

import {
  deleteAllMyVaultsOf,
  deleteMyVaultOf,
  newDeleteVaultConnectLinksStep,
  releaseVaultNames,
} from "../delete.js";
import type { VaultDeleteDeps } from "../delete.js";
import { loadVault } from "../service.js";
import type { VaultService } from "../service.js";
import type { VaultRig } from "./support.js";
import { openVaultRig, seedMyVaultRow, silentLogger } from "./support.js";

const ana = testCallerIdentity({ identityId: "ida_ana" });
const ben = testCallerIdentity({ identityId: "ida_ben" });

let rig: VaultRig;

beforeEach(() => {
  rig = openVaultRig();
});

afterEach(() => {
  rig.close();
});

describe("deleteAllMyVaultsOf", () => {
  it("deletes the person's My vault in every organization, sealed values destroyed, and keeps a teammate's", async () => {
    for (const org of ["acme", "globex"]) {
      const mine = await rig.vaults.ensureMine(org, ana);
      await rig.vaults.setSecrets(mine.metadata!.id, { API_KEY: { value: `sk-${org}`, description: "" } }, ana);
    }
    const bens = await rig.vaults.ensureMine("acme", ben);

    const deleted = await deleteAllMyVaultsOf(
      {
        store: rig.store,
        logger: silentLogger,
        secretService: rig.secrets,
        authorizationLifecycle: undefined,
        vaults: rig.vaults,
      },
      "ida_ana",
      testCallerIdentity({ identityId: "system", callerClass: "internal" }),
    );

    expect(deleted).toBe(2);
    expect(await rig.vaults.findMine("acme", "ida_ana")).toBeUndefined();
    expect(await rig.vaults.findMine("globex", "ida_ana")).toBeUndefined();
    expect((await rig.vaults.findMine("acme", "ida_ben"))?.metadata?.id).toBe(bens.metadata?.id);
    expect(rig.codec.deleted).toHaveLength(2);
    // The names are free: the person's next first write creates a new vault.
    const again = await rig.vaults.ensureMine("acme", ana);
    expect(again.metadata?.id).toBeDefined();
  });
});

describe("deleteAllMyVaultsOf finds the rows by person, not by name claim", () => {
  it("deletes a My vault whose claim is missing, and one beside the vault that holds the claim, sealed values destroyed", async () => {
    const claimed = await rig.vaults.ensureMine("acme", ana);
    const unclaimed = await seedMyVaultRow(rig.store, "globex", "ida_ana", { API_KEY: "enc:v9:Z2xvYmV4" });
    const beside = await seedMyVaultRow(rig.store, "acme", "ida_ana_twin", { API_KEY: "enc:v9:YWNtZQ==" });
    beside.spec!.owner = { case: "person", value: "ida_ana" };
    await rig.store.saveResource(ApiResourceKind.vault, beside.metadata!.id, VaultSchema, beside);

    const deleted = await deleteAllMyVaultsOf(
      {
        store: rig.store,
        logger: silentLogger,
        secretService: rig.secrets,
        authorizationLifecycle: undefined,
        vaults: rig.vaults,
      },
      "ida_ana",
      testCallerIdentity({ identityId: "system", callerClass: "internal" }),
    );

    expect(deleted).toBe(3);
    for (const vault of [claimed, unclaimed, beside]) {
      expect(await loadVault(rig.store, vault.metadata!.id)).toBeUndefined();
    }
    expect([...rig.codec.deleted].sort()).toEqual(["enc:v9:YWNtZQ==", "enc:v9:Z2xvYmV4"]);
  });
});

describe("deleteMyVaultOf finds the rows by person in the one organization, not by name claim", () => {
  it("deletes the departing member's claimed My vault and one beside it there, and one with no claim, keeping their other organization's", async () => {
    const deps = {
      store: rig.store,
      logger: silentLogger,
      secretService: rig.secrets,
      authorizationLifecycle: undefined,
      vaults: rig.vaults,
    };
    const system = testCallerIdentity({ identityId: "system", callerClass: "internal" });
    const claimed = await rig.vaults.ensureMine("acme", ana);
    const beside = await seedMyVaultRow(rig.store, "acme", "ida_ana_twin", { API_KEY: "enc:v9:YWNtZQ==" });
    beside.spec!.owner = { case: "person", value: "ida_ana" };
    await rig.store.saveResource(ApiResourceKind.vault, beside.metadata!.id, VaultSchema, beside);
    const elsewhere = await seedMyVaultRow(rig.store, "globex", "ida_ana", { API_KEY: "enc:v9:Z2xvYmV4" });

    expect(await deleteMyVaultOf(deps, "acme", "ida_ana", system)).toBe(true);
    for (const vault of [claimed, beside]) {
      expect(await loadVault(rig.store, vault.metadata!.id)).toBeUndefined();
    }
    expect(rig.codec.deleted).toEqual(["enc:v9:YWNtZQ=="]);
    expect((await loadVault(rig.store, elsewhere.metadata!.id))?.metadata?.org).toBe("globex");

    // A My vault with no name claim at all: the claim alone would find none.
    expect(await deleteMyVaultOf(deps, "globex", "ida_ana", system)).toBe(true);
    expect(await loadVault(rig.store, elsewhere.metadata!.id)).toBeUndefined();
    expect(rig.codec.deleted).toEqual(["enc:v9:YWNtZQ==", "enc:v9:Z2xvYmV4"]);
    expect(await deleteMyVaultOf(deps, "globex", "ida_ana", system), "none left").toBe(false);
  });
});

// A vault row the real store cannot decode, planted as an older binary
// writes one (stigmer/stigmer#2774).
const garbage = new Uint8Array([0xff, 0xff, 0xff]);
const system = testCallerIdentity({ identityId: "system", callerClass: "internal" });
const deps = (): VaultDeleteDeps & { readonly vaults: VaultService } => ({
  store: rig.store,
  logger: silentLogger,
  secretService: rig.secrets,
  authorizationLifecycle: undefined,
  vaults: rig.vaults,
});

/** A person's My vault in `org`, with one sealed value, claimed as a first write claims it. */
async function myVault(org: string, who: typeof ana): Promise<string> {
  const mine = await rig.vaults.ensureMine(org, who);
  await rig.vaults.setSecrets(mine.metadata!.id, { API_KEY: { value: `sk-${org}`, description: "" } }, who);
  return mine.metadata!.id;
}

/** Damages a vault row as a bad write would, answering its repair: the good bytes written back. */
async function damage(id: string): Promise<() => void> {
  const good = toBinary(VaultSchema, (await loadVault(rig.store, id))!);
  rig.writeVaultAsOlderBinary(id, garbage);
  return () => rig.writeVaultAsOlderBinary(id, good);
}

async function refusal(work: Promise<unknown>): Promise<ConnectError> {
  const failure = await work.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ConnectError);
  return failure as ConnectError;
}

describe("deleteAllMyVaultsOf over a row that does not decode", () => {
  it("fails before deleting any vault, and the retry after the repair deletes them all", async () => {
    const acme = await myVault("acme", ana);
    const broken = await myVault("globex", ana);
    const repair = await damage(broken);

    const failure = await refusal(deleteAllMyVaultsOf(deps(), "ida_ana", system));
    expect(failure.code).toBe(Code.Internal);
    expect(failure.rawMessage).toContain(broken);
    // Nothing went: the readable vault and every sealed value wait for the retry.
    expect((await rig.vaults.findMine("acme", "ida_ana"))?.metadata?.id).toBe(acme);
    expect(rig.codec.deleted).toEqual([]);

    repair();
    expect(await deleteAllMyVaultsOf(deps(), "ida_ana", system)).toBe(2);
    expect(await rig.vaults.findMine("acme", "ida_ana")).toBeUndefined();
    expect(await rig.vaults.findMine("globex", "ida_ana")).toBeUndefined();
    expect(rig.codec.deleted).toHaveLength(2);
  });

  it("fails while any vault row is damaged, since no read ties a damaged row to a person", async () => {
    await myVault("acme", ana);
    const repair = await damage(await myVault("acme", ben));

    const failure = await refusal(deleteAllMyVaultsOf(deps(), "ida_ana", system));
    expect(failure.code).toBe(Code.Internal);
    expect(rig.codec.deleted).toEqual([]);

    repair();
    expect(await deleteAllMyVaultsOf(deps(), "ida_ana", system)).toBe(1);
  });
});

describe("deleteMyVaultOf over a row that does not decode", () => {
  it("fails when the person's own claimed vault is damaged, deleting nothing, and the retry after the repair deletes it", async () => {
    const broken = await myVault("acme", ana);
    const beside = await seedMyVaultRow(rig.store, "acme", "ida_ana_twin", { API_KEY: "enc:v9:YmVzaWRl" });
    beside.spec!.owner = { case: "person", value: "ida_ana" };
    await rig.store.saveResource(ApiResourceKind.vault, beside.metadata!.id, VaultSchema, beside);
    const repair = await damage(broken);

    const failure = await refusal(deleteMyVaultOf(deps(), "acme", "ida_ana", system));
    expect(failure.code).toBe(Code.Internal);
    expect(failure.rawMessage).toContain(broken);
    expect(
      (await loadVault(rig.store, beside.metadata!.id))?.metadata?.id,
      "a readable vault of hers waits with the damaged one",
    ).toBe(beside.metadata!.id);
    expect(rig.codec.deleted).toEqual([]);

    repair();
    expect(await deleteMyVaultOf(deps(), "acme", "ida_ana", system)).toBe(true);
    expect(await rig.vaults.findMine("acme", "ida_ana")).toBeUndefined();
    expect(await loadVault(rig.store, beside.metadata!.id)).toBeUndefined();
    expect(rig.codec.deleted).toHaveLength(2);
  });

  it("lets another person's departure, and her departure from another organization, go through", async () => {
    const broken = await myVault("acme", ana);
    const elsewhere = await myVault("globex", ana);
    const bens = await myVault("acme", ben);
    await damage(broken);

    expect(await deleteMyVaultOf(deps(), "acme", "ida_ben", system)).toBe(true);
    expect(await loadVault(rig.store, bens)).toBeUndefined();
    expect(await deleteMyVaultOf(deps(), "globex", "ida_ana", system)).toBe(true);
    expect(await loadVault(rig.store, elsewhere)).toBeUndefined();
    expect(rig.codec.deleted).toHaveLength(2);
  });
});

describe("releaseVaultNames", () => {
  it("logs a name it cannot release and never throws", async () => {
    const errors: string[] = [];
    const store = {
      resourceNames: {
        release: async () => {
          throw new Error("names table gone");
        },
      },
    } as unknown as Store;
    const logger = {
      ...silentLogger,
      error: (message: string) => {
        errors.push(message);
      },
    };
    await releaseVaultNames(
      store,
      logger,
      create(VaultSchema, {
        metadata: { id: "vlt_1", org: "acme" },
        spec: { owner: { case: "person", value: "ida_ana" }, externalId: "" },
      }),
    );
    expect(errors).toEqual(["vault deleted but a name it held could not be released"]);
  });
});

describe("the Connect links of a deleted vault", () => {
  it("are removed with it, and one that cannot be is logged, never failing the delete", async () => {
    const errors: string[] = [];
    const store = {
      connectLinks: {
        deleteByVault: async () => {
          throw new Error("links table gone");
        },
      },
    } as unknown as Store;
    const logger = {
      ...silentLogger,
      error: (message: string) => {
        errors.push(message);
      },
    };
    const ctx = new RequestContext(VaultSchema, create(VaultSchema), ana);
    ctx.set(EXISTING_RESOURCE_KEY, create(VaultSchema, { metadata: { id: "vlt_gone", org: "acme" } }));
    await newDeleteVaultConnectLinksStep<typeof VaultSchema>(store, logger).execute(ctx);
    expect(errors).toEqual(["vault deleted but its Connect links could not be removed"]);
  });
});
