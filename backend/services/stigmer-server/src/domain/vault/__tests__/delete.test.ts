/**
 * Pins the vault delete tail's edges: an account's deletion removes its
 * My vault in every organization and no one else's, its sealed values
 * destroyed and its names freed, found by the person each row belongs to,
 * so a vault whose name claim is missing or held by another row goes too;
 * a member's departure from one organization does the same there alone; a My vault row that does not decode
 * fails the account's deletion before any vault goes, and the retry after
 * the repair deletes them all; and a name that cannot be released after
 * the row is gone is logged, never failing the delete.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";

import { deleteAllMyVaultsOf, deleteMyVaultOf, releaseVaultNames } from "../delete.js";
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

describe("deleteAllMyVaultsOf over a row that does not decode", () => {
  it("fails before deleting any vault, and the retry after the repair deletes them all", async () => {
    const ids: string[] = [];
    for (const org of ["acme", "globex"]) {
      const mine = await rig.vaults.ensureMine(org, ana);
      await rig.vaults.setSecrets(mine.metadata!.id, { API_KEY: { value: `sk-${org}`, description: "" } }, ana);
      ids.push(mine.metadata!.id);
    }
    const broken = ids[1]!;
    // The store answers the globex row with bytes no vault decodes from.
    const queryResources: Store["queryResources"] = async (declaration, query) =>
      (await rig.store.queryResources(declaration, query)).map((row) =>
        row.id === broken ? { ...row, data: new Uint8Array([0xff, 0xff, 0xff]) } : row,
      );
    const damaged = new Proxy(rig.store, {
      get(target, property) {
        if (property === "queryResources") {
          return queryResources;
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const system = testCallerIdentity({ identityId: "system", callerClass: "internal" });
    const deps = (store: Store): VaultDeleteDeps & { readonly vaults: VaultService } => ({
      store,
      logger: silentLogger,
      secretService: rig.secrets,
      authorizationLifecycle: undefined,
      vaults: rig.vaults,
    });

    const failure = await deleteAllMyVaultsOf(deps(damaged), "ida_ana", system).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Internal);
    expect((failure as ConnectError).rawMessage).toContain(broken);
    // Nothing went: both vaults and their sealed values wait for the retry.
    expect((await rig.vaults.findMine("acme", "ida_ana"))?.metadata?.id).toBe(ids[0]);
    expect((await rig.vaults.findMine("globex", "ida_ana"))?.metadata?.id).toBe(broken);
    expect(rig.codec.deleted).toEqual([]);

    expect(await deleteAllMyVaultsOf(deps(rig.store), "ida_ana", system)).toBe(2);
    expect(await rig.vaults.findMine("acme", "ida_ana")).toBeUndefined();
    expect(await rig.vaults.findMine("globex", "ida_ana")).toBeUndefined();
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
