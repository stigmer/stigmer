/**
 * Pins the extension registry's merge semantics and the DD-006 §2b
 * loud-fail contract (sub-project 20260826.09/O1): explicit empty
 * defaults, unit-order concatenation for list points, single-declaration
 * enforcement for authorizer and edition, unique unit names, the
 * unknown-gate-slot boot throw, and the O5 driver points (single-instance
 * providers, name-keyed storage-driver registration with duplicate and
 * built-in-shadow throws). The composed-server behavior (services on
 * both routers, edition on the wire) is pinned by
 * extension-composition.test.ts; empty-set wire byte-identity is pinned by
 * the conformance rosters.
 */
import { describe, expect, it } from "vitest";

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type { DescMessage } from "@bufbuild/protobuf";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { ModelCatalogProvider } from "../../domain/workflow/registry/model-catalog-provider.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../../sandbox/provisioner.js";
import type { WorkerFactory } from "../../temporal/manager.js";
import type { Authorizer } from "../authorizer.js";
import type { GateSlotName } from "../gate-slots.js";
import type { IdentityVerifier } from "../identity.js";
import { resolveExtensions } from "../registry.js";
import type { ServerExtension } from "../registry.js";

const allowAll: Authorizer = {
  authorize: () => Promise.resolve({ kind: "allow" }),
};

const denyAll: Authorizer = {
  authorize: () => Promise.resolve({ kind: "deny", reason: "unit test" }),
};

function verifier(name: string): IdentityVerifier {
  return { name, verify: () => Promise.resolve(null) };
}

// Never invoked — the factory's identity is what the merge tests assert.
const workerFactory: WorkerFactory = () =>
  Promise.reject(new Error("unit-test worker factory — never started"));

// Driver fakes: identity is all the merge tests assert; no method runs.
function fakeCatalog(): ModelCatalogProvider {
  return {
    document: () => "{}",
    isValidModel: () => false,
    hasHarness: () => false,
    hasAnyModels: () => false,
    isValidModelOnAnyHarness: () => false,
    canonicalModelsAcrossHarnesses: () => [],
    canonicalModels: () => [],
    hasPricingVariant: () => false,
    hasPricingVariantForHarness: () => false,
    canonicalModelsWithVariant: () => [],
    canonicalModelsWithVariantForHarness: () => [],
    hasCapabilityForHarness: () => false,
    canonicalModelsWithCapabilityForHarness: () => [],
  };
}

function fakeCredentials(): RunnerCredentialProvider {
  return {
    isEnabled: () => false,
    mint: () => {
      throw new Error("unit-test credential provider — never minted");
    },
    verify: () => {
      throw new Error("unit-test credential provider — never verified");
    },
  };
}

const fakeStorageDriver = (): ArtifactStorage => {
  throw new Error("unit-test storage driver factory — never constructed");
};

const fakeSandboxDriver: SandboxProvisionerFactory = () => {
  throw new Error("unit-test sandbox driver factory — never constructed");
};

describe("resolveExtensions — defaults", () => {
  it("resolves the omitted set to explicit empty defaults, edition oss", () => {
    const resolved = resolveExtensions();
    expect(resolved.unitNames).toEqual([]);
    expect(resolved.edition).toBe(ServerEdition.oss);
    expect(resolved.authorizer).toBeUndefined();
    expect(resolved.identityVerifiers).toEqual([]);
    expect(resolved.gateSteps.size).toBe(0);
    expect(resolved.statusObservers).toEqual([]);
    expect(resolved.responseDecorators).toEqual([]);
    expect(resolved.drivers.modelCatalogProvider).toBeUndefined();
    expect(resolved.drivers.runnerCredentialProvider).toBeUndefined();
    expect(resolved.drivers.artifactStorageDrivers.size).toBe(0);
    expect(resolved.drivers.sandboxProvisionerDrivers.size).toBe(0);
    expect(resolved.services).toEqual([]);
    expect(resolved.workers).toEqual([]);
  });

  it("resolves the empty list identically to the omitted set", () => {
    expect(resolveExtensions([])).toEqual(resolveExtensions());
  });
});

describe("resolveExtensions — merge semantics", () => {
  it("concatenates list points in unit order and keeps declared singletons", () => {
    const registerA = (): void => {};
    const registerB = (): void => {};
    const observerA = (): void => {};
    const decoratorB = (): void => {};
    const resolved = resolveExtensions([
      {
        name: "alpha",
        identityVerifiers: [verifier("a1"), verifier("a2")],
        services: [registerA],
        statusTransitionHooks: { observers: [observerA] },
      },
      {
        name: "beta",
        edition: ServerEdition.cloud,
        authorizer: allowAll,
        identityVerifiers: [verifier("b1")],
        services: [registerB],
        workers: [workerFactory],
        statusTransitionHooks: { responseDecorators: [decoratorB] },
      },
    ]);
    expect(resolved.unitNames).toEqual(["alpha", "beta"]);
    expect(resolved.edition).toBe(ServerEdition.cloud);
    expect(resolved.authorizer).toBe(allowAll);
    expect(resolved.identityVerifiers.map((v) => v.name)).toEqual([
      "a1",
      "a2",
      "b1",
    ]);
    expect(resolved.services).toEqual([registerA, registerB]);
    expect(resolved.workers).toEqual([workerFactory]);
    expect(resolved.statusObservers).toEqual([observerA]);
    expect(resolved.responseDecorators).toEqual([decoratorB]);
  });

  it("merges the O5 driver points: singleton providers, name-keyed storage drivers across units", () => {
    const catalog = fakeCatalog();
    const credentials = fakeCredentials();
    const resolved = resolveExtensions([
      {
        name: "catalog-unit",
        drivers: {
          modelCatalogProvider: catalog,
          artifactStorageDrivers: new Map([["r2-skill", fakeStorageDriver]]),
        },
      },
      {
        name: "credential-unit",
        drivers: {
          runnerCredentialProvider: credentials,
          artifactStorageDrivers: new Map([["r2-artifacts", fakeStorageDriver]]),
        },
      },
    ]);
    expect(resolved.drivers.modelCatalogProvider).toBe(catalog);
    expect(resolved.drivers.runnerCredentialProvider).toBe(credentials);
    expect([...resolved.drivers.artifactStorageDrivers.keys()].sort()).toEqual([
      "r2-artifacts",
      "r2-skill",
    ]);
    expect(resolved.drivers.artifactStorageDrivers.get("r2-skill")).toBe(
      fakeStorageDriver,
    );
  });

  it("merges the O6 sandbox-provisioner drivers as a name-keyed map across units", () => {
    const resolved = resolveExtensions([
      {
        name: "fly-unit",
        drivers: {
          sandboxProvisionerDrivers: new Map([
            ["fly-machines", fakeSandboxDriver],
          ]),
        },
      },
      {
        name: "firecracker-unit",
        drivers: {
          sandboxProvisionerDrivers: new Map([
            ["firecracker", fakeSandboxDriver],
          ]),
        },
      },
    ]);
    expect(
      [...resolved.drivers.sandboxProvisionerDrivers.keys()].sort(),
    ).toEqual(["firecracker", "fly-machines"]);
    expect(resolved.drivers.sandboxProvisionerDrivers.get("fly-machines")).toBe(
      fakeSandboxDriver,
    );
  });
});

describe("resolveExtensions — loud-fail throws (DD-006 §2b)", () => {
  it("throws on an empty unit name", () => {
    expect(() => resolveExtensions([{ name: "" }])).toThrowError(
      /empty name/,
    );
  });

  it("throws on a duplicate unit name, naming it", () => {
    expect(() =>
      resolveExtensions([{ name: "billing" }, { name: "billing" }]),
    ).toThrowError(/duplicate extension name 'billing'/);
  });

  it("throws on a second Authorizer, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "first-authz", authorizer: allowAll },
        { name: "second-authz", authorizer: denyAll },
      ]),
    ).toThrowError(
      /extension 'second-authz' registers an Authorizer, but 'first-authz' already did/,
    );
  });

  it("throws on a second edition declaration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "first-edition", edition: ServerEdition.cloud },
        { name: "second-edition", edition: ServerEdition.oss },
      ]),
    ).toThrowError(
      /extension 'second-edition' declares the server edition, but 'first-edition' already did/,
    );
  });

  it("throws on a declared-but-unspecified edition", () => {
    expect(() =>
      resolveExtensions([
        { name: "vague", edition: ServerEdition.server_edition_unspecified },
      ]),
    ).toThrowError(/edition 'server_edition_unspecified'/);
  });

  it("throws on a registration into an unknown gate slot, naming the slot", () => {
    const step: PipelineStep<DescMessage> = {
      name: "UnitTestGate",
      execute: () => {},
    };
    // GateSlotName is the empty union until O4 declares the ratified
    // slots, so no registration typechecks — the cast exercises the
    // runtime arm of the two-layer contract (a JS consumer, or a
    // composition built against a pin where a slot has moved, must throw
    // at boot, never no-op).
    const gateSteps = new Map([
      ["agent-execution-create:pre-side-effect-gate", [step]],
    ]) as unknown as ReadonlyMap<
      GateSlotName,
      ReadonlyArray<PipelineStep<DescMessage>>
    >;
    const unit: ServerExtension = { name: "early-gate", gateSteps };
    expect(() => resolveExtensions([unit])).toThrowError(
      /extension 'early-gate' registered gate steps into unknown slot 'agent-execution-create:pre-side-effect-gate'.*none in this build/,
    );
  });

  it("throws on a second ModelCatalogProvider, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "first-catalog", drivers: { modelCatalogProvider: fakeCatalog() } },
        { name: "second-catalog", drivers: { modelCatalogProvider: fakeCatalog() } },
      ]),
    ).toThrowError(
      /extension 'second-catalog' registers a ModelCatalogProvider, but 'first-catalog' already did/,
    );
  });

  it("throws on a second RunnerCredentialProvider, naming both units", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-cred",
          drivers: { runnerCredentialProvider: fakeCredentials() },
        },
        {
          name: "second-cred",
          drivers: { runnerCredentialProvider: fakeCredentials() },
        },
      ]),
    ).toThrowError(
      /extension 'second-cred' registers a RunnerCredentialProvider, but 'first-cred' already did/,
    );
  });

  it("throws on a duplicate storage-driver name across units, naming both", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-blob",
          drivers: { artifactStorageDrivers: new Map([["gcs", fakeStorageDriver]]) },
        },
        {
          name: "second-blob",
          drivers: { artifactStorageDrivers: new Map([["gcs", fakeStorageDriver]]) },
        },
      ]),
    ).toThrowError(
      /extension 'second-blob' registers artifact-storage driver 'gcs', but 'first-blob' already did/,
    );
  });

  it("throws on a storage-driver name shadowing a built-in backend", () => {
    for (const name of ["local", "r2"]) {
      expect(() =>
        resolveExtensions([
          {
            name: "shadowing",
            drivers: { artifactStorageDrivers: new Map([[name, fakeStorageDriver]]) },
          },
        ]),
      ).toThrowError(
        new RegExp(
          `extension 'shadowing' registers artifact-storage driver '${name}', which shadows a built-in backend`,
        ),
      );
    }
  });

  it("throws on a duplicated sandbox-provisioner name across units, naming both", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-sbx",
          drivers: {
            sandboxProvisionerDrivers: new Map([["fly", fakeSandboxDriver]]),
          },
        },
        {
          name: "second-sbx",
          drivers: {
            sandboxProvisionerDrivers: new Map([["fly", fakeSandboxDriver]]),
          },
        },
      ]),
    ).toThrowError(
      /extension 'second-sbx' registers sandbox provisioner 'fly', but 'first-sbx' already did/,
    );
  });

  it("throws on a sandbox-provisioner name shadowing a built-in driver", () => {
    for (const name of ["local-process", "docker", "kubernetes"]) {
      expect(() =>
        resolveExtensions([
          {
            name: "shadowing",
            drivers: {
              sandboxProvisionerDrivers: new Map([[name, fakeSandboxDriver]]),
            },
          },
        ]),
      ).toThrowError(
        new RegExp(
          `extension 'shadowing' registers sandbox provisioner '${name}', which shadows a built-in driver`,
        ),
      );
    }
  });
});
