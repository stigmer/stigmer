/**
 * Pins the three registry points the IamPolicy domain adds and the one
 * contract it widens (20260913.01, T01_1_review.md Q-OR-10), in the O5
 * driver-point shape the registry already enforces for
 * identityAccountStore and identityFederation:
 *
 *   - `drivers.iamPolicyStore` — the store driver (the cloud serves the
 *     domain over cloud.iam_policy through it); single instance; absent =
 *     the OSS adapter over the generic Store;
 *   - `drivers.policyGrantScope` — which kinds a user may grant on and
 *     with which roles (P1 gate Q7 iii; Q-OR-3); single instance; absent =
 *     open source's default, the organization and nothing else;
 *   - `drivers.authorizationQueries` — the tuple-half query engine
 *     (Q-OR-8); single instance; absent = the three tuple-half RPCs and a
 *     contextual checkMyPermission refuse UNIMPLEMENTED with the edition
 *     reason (the domain suite pins the refusal; this file pins the
 *     registry);
 *   - `drivers.principalDisplay` — how an access list names a grantee
 *     that is not a person (a team); single instance; absent = the id
 *     fallback shape;
 *   - `ResourceAuthorizationLifecycle` gains the OPTIONAL `onPolicyGranted`
 *     and `onPolicyRevoked` (Q7 i): a unit's lifecycle that carries them
 *     resolves through the existing single-instance point with both hooks
 *     intact, and one that implements only the three required methods
 *     still resolves — the widening is additive.
 */
import { describe, expect, it } from "vitest";

import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import type { AuthorizationQueryEngine } from "../authorization-queries.js";
import type { PolicyGrantScope } from "../policy-grant-scope.js";
import type { PrincipalDisplay } from "../principal-display.js";
import { resolveExtensions } from "../registry.js";
import type { ResourceAuthorizationLifecycle } from "../resource-authorization.js";

const unimplemented = () => Promise.reject(new Error("not exercised here"));

const store: IamPolicyStore = {
  save: unimplemented,
  deleteById: unimplemented,
  findById: unimplemented,
  findByPrincipal: unimplemented,
  findByResource: unimplemented,
  findByPrincipalAndResource: unimplemented,
  findByResourceWithRelations: unimplemented,
  countDistinctPrincipalsByResource: unimplemented,
  findScopeTuple: unimplemented,
};

const scope: PolicyGrantScope = {
  grantableRoles: () => [],
};

const engine: AuthorizationQueryEngine = {
  check: unimplemented,
  listResourceIds: unimplemented,
  listPrincipalIds: unimplemented,
};

describe("the iamPolicyStore driver point", () => {
  it("is undefined with no extensions — the OSS adapter serves", () => {
    expect(resolveExtensions([]).drivers.iamPolicyStore).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { iamPolicyStore: store } },
    ]);
    expect(resolved.drivers.iamPolicyStore).toBe(store);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "store-a", drivers: { iamPolicyStore: store } },
        { name: "store-b", drivers: { iamPolicyStore: store } },
      ]),
    ).toThrowError(
      /extension 'store-b' registers an IamPolicyStore, but 'store-a' already did/,
    );
  });
});

describe("the policyGrantScope driver point", () => {
  it("is undefined with no extensions — open source grants on organizations only", () => {
    expect(resolveExtensions([]).drivers.policyGrantScope).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { policyGrantScope: scope } },
    ]);
    expect(resolved.drivers.policyGrantScope).toBe(scope);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "scope-a", drivers: { policyGrantScope: scope } },
        { name: "scope-b", drivers: { policyGrantScope: scope } },
      ]),
    ).toThrowError(
      /extension 'scope-b' registers a PolicyGrantScope, but 'scope-a' already did/,
    );
  });
});

describe("the authorizationQueries capability point", () => {
  it("is undefined with no extensions — the tuple-half RPCs refuse", () => {
    expect(resolveExtensions([]).drivers.authorizationQueries).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { authorizationQueries: engine } },
    ]);
    expect(resolved.drivers.authorizationQueries).toBe(engine);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "engine-a", drivers: { authorizationQueries: engine } },
        { name: "engine-b", drivers: { authorizationQueries: engine } },
      ]),
    ).toThrowError(
      /extension 'engine-b' registers an AuthorizationQueryEngine, but 'engine-a' already did/,
    );
  });
});

describe("the principalDisplay driver point", () => {
  const display: PrincipalDisplay = { resolve: unimplemented };

  it("is undefined with no extensions — a non-person grantee renders by its id", () => {
    expect(resolveExtensions([]).drivers.principalDisplay).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { principalDisplay: display } },
    ]);
    expect(resolved.drivers.principalDisplay).toBe(display);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "display-a", drivers: { principalDisplay: display } },
        { name: "display-b", drivers: { principalDisplay: display } },
      ]),
    ).toThrowError(
      /extension 'display-b' registers a PrincipalDisplay, but 'display-a' already did/,
    );
  });
});

describe("the widened ResourceAuthorizationLifecycle contract", () => {
  const resourceHooks = {
    onResourceCreated: unimplemented,
    onResourceDeleted: unimplemented,
    onVisibilityChanged: unimplemented,
  };

  it("a lifecycle carrying the two policy hooks resolves with both intact — the cloud's tuple driver", () => {
    const tupleDriver: ResourceAuthorizationLifecycle = {
      ...resourceHooks,
      onPolicyGranted: unimplemented,
      onPolicyRevoked: unimplemented,
    };
    const resolved = resolveExtensions([
      {
        name: "cloud-iam",
        drivers: { resourceAuthorizationLifecycle: tupleDriver },
      },
    ]);
    expect(resolved.drivers.resourceAuthorizationLifecycle).toBe(tupleDriver);
    expect(
      resolved.drivers.resourceAuthorizationLifecycle?.onPolicyGranted,
    ).toBe(unimplemented);
    expect(
      resolved.drivers.resourceAuthorizationLifecycle?.onPolicyRevoked,
    ).toBe(unimplemented);
  });

  it("a lifecycle with only the three required methods still resolves — the widening is additive", () => {
    const minimal: ResourceAuthorizationLifecycle = resourceHooks;
    const resolved = resolveExtensions([
      {
        name: "some-unit",
        drivers: { resourceAuthorizationLifecycle: minimal },
      },
    ]);
    expect(resolved.drivers.resourceAuthorizationLifecycle).toBe(minimal);
    expect(
      resolved.drivers.resourceAuthorizationLifecycle?.onPolicyGranted,
    ).toBeUndefined();
  });
});
