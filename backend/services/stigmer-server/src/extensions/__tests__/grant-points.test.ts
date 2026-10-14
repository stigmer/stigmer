/**
 * Pins the three registry points the Grant domain adds and the one
 * contract it widens, in the
 * driver-point shape the registry already enforces for
 * identityAccountStore and identityFederation:
 *
 *   - `drivers.grantStore` — the store driver (the cloud serves the
 *     domain over cloud.grant through it); single instance; absent =
 *     the OSS adapter over the generic Store;
 *   - `drivers.grantScope` — which kinds a user may grant on and
 *     with which roles; single instance; absent =
 *     open source's default, the organization and nothing else;
 *   - `drivers.authorizationQueries` — the tuple-half query engine;
 *     single instance; absent = the three tuple-half RPCs and a
 *     contextual checkMyPermission refuse UNIMPLEMENTED with the edition
 *     reason (the domain suite pins the refusal; this file pins the
 *     registry);
 *   - `drivers.principalDisplay` — how an access list names a grantee
 *     that is not a person (a team); single instance; absent = the id
 *     fallback shape;
 *   - `ResourceAuthorizationLifecycle` gains the OPTIONAL `onGranted`
 *     and `onRevoked`: a unit's lifecycle that carries them
 *     resolves through the existing single-instance point with both hooks
 *     intact, and one that implements only the three required methods
 *     still resolves — the widening is additive.
 */
import { describe, expect, it } from "vitest";

import type { GrantStore } from "../../domain/grant/store.js";
import type { AuthorizationQueryEngine } from "../authorization-queries.js";
import type { GrantScope } from "../grant-scope.js";
import type { PrincipalDisplay } from "../principal-display.js";
import { resolveExtensions } from "../registry.js";
import type { ResourceAuthorizationLifecycle } from "../resource-authorization.js";

const unimplemented = () => Promise.reject(new Error("not exercised here"));

const store: GrantStore = {
  save: unimplemented,
  deleteById: unimplemented,
  findById: unimplemented,
  findByPrincipal: unimplemented,
  findByResource: unimplemented,
  findByPrincipalAndResource: unimplemented,
  findByResourceWithRelations: unimplemented,
  countDistinctPrincipalsByResource: unimplemented,
  findScopeTuple: unimplemented,
  findByResourceKindAndRelation: unimplemented,
  listChanges: unimplemented,
  pruneChanges: unimplemented,
  lastChangeSequence: unimplemented,
};

const scope: GrantScope = {
  grantableRoles: () => [],
};

const engine: AuthorizationQueryEngine = {
  check: unimplemented,
  listResourceIds: unimplemented,
  listPrincipalIds: unimplemented,
};

describe("the grantStore driver point", () => {
  it("is undefined with no extensions — the OSS adapter serves", () => {
    expect(resolveExtensions([]).drivers.grantStore).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { grantStore: store } },
    ]);
    expect(resolved.drivers.grantStore).toBe(store);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "store-a", drivers: { grantStore: store } },
        { name: "store-b", drivers: { grantStore: store } },
      ]),
    ).toThrowError(
      /extension 'store-b' registers an GrantStore, but 'store-a' already did/,
    );
  });
});

describe("the grantScope driver point", () => {
  it("is undefined with no extensions — open source grants on organizations only", () => {
    expect(resolveExtensions([]).drivers.grantScope).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { grantScope: scope } },
    ]);
    expect(resolved.drivers.grantScope).toBe(scope);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "scope-a", drivers: { grantScope: scope } },
        { name: "scope-b", drivers: { grantScope: scope } },
      ]),
    ).toThrowError(
      /extension 'scope-b' registers a GrantScope, but 'scope-a' already did/,
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
      onGranted: unimplemented,
      onRevoked: unimplemented,
    };
    const resolved = resolveExtensions([
      {
        name: "cloud-iam",
        drivers: { resourceAuthorizationLifecycle: tupleDriver },
      },
    ]);
    expect(resolved.drivers.resourceAuthorizationLifecycle).toBe(tupleDriver);
    expect(
      resolved.drivers.resourceAuthorizationLifecycle?.onGranted,
    ).toBe(unimplemented);
    expect(
      resolved.drivers.resourceAuthorizationLifecycle?.onRevoked,
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
      resolved.drivers.resourceAuthorizationLifecycle?.onGranted,
    ).toBeUndefined();
  });
});
