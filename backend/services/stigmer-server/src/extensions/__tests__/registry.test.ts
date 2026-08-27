/**
 * Pins the extension registry's merge semantics and the DD-006 §2b
 * loud-fail contract (sub-project 20260826.09/O1): explicit empty
 * defaults, unit-order concatenation for list points, single-declaration
 * enforcement for authorizer and edition, unique unit names, and the
 * unknown-gate-slot boot throw. The composed-server behavior (services on
 * both routers, edition on the wire) is pinned by
 * extension-composition.test.ts; empty-set wire byte-identity is pinned by
 * the conformance rosters.
 */
import { describe, expect, it } from "vitest";

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type { DescMessage } from "@bufbuild/protobuf";

import type { PipelineStep } from "../../pipeline/pipeline.js";
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
});
