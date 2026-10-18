/**
 * Pins the runner's half of a sandbox's Environment (environment.ts):
 *
 *   - runnerEnvironmentOf gives `{network, packages}` with the network as
 *     its bare mode, never the host list (enforcing that is the driver's),
 *     every manager's packages copied, and `undefined` when no Environment
 *     governs the sandbox;
 *   - runnerEnvironmentValue is that object as JSON, or `undefined`;
 *   - environmentNeeds asks for limited networking only under `limited`,
 *     and for packages when any one manager lists one.
 */
import { describe, expect, it } from "vitest";

import {
  environmentNeeds,
  runnerEnvironmentOf,
  runnerEnvironmentValue,
} from "../environment.js";
import type {
  EnvironmentFacts,
  EnvironmentPackageSet,
} from "../provisioner.js";

const noPackages: EnvironmentPackageSet = {
  apt: [],
  cargo: [],
  gem: [],
  go: [],
  npm: [],
  pip: [],
};

const unrestricted: EnvironmentFacts = {
  id: "env_1",
  network: { mode: "unrestricted" },
  packages: { ...noPackages, apt: ["ripgrep"], pip: ["requests==2.32.3"] },
};

const limited: EnvironmentFacts = {
  id: "env_2",
  network: {
    mode: "limited",
    hosts: [
      { host: "example.com", cleartext: false },
      { host: "deb.debian.org", cleartext: true },
    ],
  },
  packages: noPackages,
};

describe("runnerEnvironmentOf", () => {
  it("is undefined when no Environment governs the sandbox", () => {
    expect(runnerEnvironmentOf(undefined)).toBeUndefined();
  });

  it("gives the network mode and the packages, never the host list", () => {
    expect(runnerEnvironmentOf(unrestricted)).toEqual({
      network: "unrestricted",
      packages: {
        apt: ["ripgrep"],
        cargo: [],
        gem: [],
        go: [],
        npm: [],
        pip: ["requests==2.32.3"],
      },
    });
    const half = runnerEnvironmentOf(limited);
    expect(half).toEqual({ network: "limited", packages: noPackages });
    expect(Object.keys(half ?? {}).sort()).toEqual(["network", "packages"]);
  });

  it("copies the package lists, so the facts' own arrays are never handed on", () => {
    const half = runnerEnvironmentOf(unrestricted);
    expect(half?.packages.apt).not.toBe(unrestricted.packages.apt);
  });
});

describe("runnerEnvironmentValue", () => {
  it("is the runner's half as JSON, or undefined with no Environment", () => {
    expect(runnerEnvironmentValue(undefined)).toBeUndefined();
    const value = runnerEnvironmentValue(limited);
    expect(value).toBeDefined();
    expect(JSON.parse(value ?? "")).toEqual({
      network: "limited",
      packages: noPackages,
    });
    expect(value).not.toContain("example.com");
  });
});

describe("environmentNeeds", () => {
  it("asks for limited networking only under limited, and packages when any manager lists one", () => {
    expect(environmentNeeds(unrestricted)).toEqual({
      limitedNetworking: false,
      packages: true,
    });
    expect(environmentNeeds(limited)).toEqual({
      limitedNetworking: true,
      packages: false,
    });
    for (const manager of Object.keys(noPackages) as Array<
      keyof EnvironmentPackageSet
    >) {
      expect(
        environmentNeeds({
          ...limited,
          packages: { ...noPackages, [manager]: ["x"] },
        }).packages,
        manager,
      ).toBe(true);
    }
  });
});
