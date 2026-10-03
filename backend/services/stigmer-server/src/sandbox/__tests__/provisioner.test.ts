/**
 * Pins the sandbox driver seam's selection and naming contracts (§6d,
 * O6):
 *
 *   - "" selects NO provisioner — the external-runner default whose
 *     byte-identity the conformance rosters ride;
 *   - unknown names are loud boot throws listing every known type;
 *   - extension-registered factories are reachable behind the knob but
 *     can never shadow a built-in name;
 *   - sandboxBaseName is the Java SandboxObjectNaming derivation
 *     (sbx-<code>-<12-hex-sha256>), deterministic and DNS-1123-safe for
 *     resource-id alphabets, and byte-identical to the runner attach
 *     waiter's own derivation (shared vectors).
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { sandboxBaseName } from "../naming.js";
import type {
  SandboxDriverConfig,
  SandboxProvisioner,
  SandboxProvisionerFactory,
} from "../provisioner.js";
import {
  BUILT_IN_SANDBOX_PROVISIONER_TYPES,
  newSandboxProvisioner,
} from "../provisioner.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const driverConfig: SandboxDriverConfig = {
  backendEndpoint: "http://host.docker.internal:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "host.docker.internal:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: "ghcr.io/stigmer/runner:latest",
  runnerCommand: "stigmer-runner",
  kubernetesNamespace: "stigmer-sandboxes",
};

function fakeFactory(marker: {
  constructed: number;
}): SandboxProvisionerFactory {
  return () => {
    marker.constructed += 1;
    return {} as SandboxProvisioner;
  };
}

describe("newSandboxProvisioner selection", () => {
  it("empty type selects nothing — the external-runner default", () => {
    const provisioner = newSandboxProvisioner(
      "",
      { config: driverConfig, logger: silentLogger },
      new Map(),
      new Map(),
    );
    expect(provisioner).toBeUndefined();
  });

  it("an unknown type is a loud boot throw naming the known set", () => {
    const marker = { constructed: 0 };
    expect(() =>
      newSandboxProvisioner(
        "daytona",
        { config: driverConfig, logger: silentLogger },
        new Map([["docker", fakeFactory(marker)]]),
        new Map([["fly-machines", fakeFactory(marker)]]),
      ),
    ).toThrowError(
      "unknown sandbox provisioner type 'daytona' — known types: 'docker', 'fly-machines'",
    );
    expect(marker.constructed, "no factory may run on a failed selection").toBe(
      0,
    );
  });

  it("selects a built-in factory and constructs it exactly once", () => {
    const marker = { constructed: 0 };
    const provisioner = newSandboxProvisioner(
      "docker",
      { config: driverConfig, logger: silentLogger },
      new Map([["docker", fakeFactory(marker)]]),
      new Map(),
    );
    expect(provisioner).toBeDefined();
    expect(marker.constructed).toBe(1);
  });

  it("selects an extension-registered factory beyond the built-ins", () => {
    const marker = { constructed: 0 };
    const provisioner = newSandboxProvisioner(
      "fly-machines",
      { config: driverConfig, logger: silentLogger },
      new Map(),
      new Map([["fly-machines", fakeFactory(marker)]]),
    );
    expect(provisioner).toBeDefined();
    expect(marker.constructed).toBe(1);
  });

  it("an unselected driver constructs nothing (§6b's factory discipline)", () => {
    const selected = { constructed: 0 };
    const bystander = { constructed: 0 };
    newSandboxProvisioner(
      "docker",
      { config: driverConfig, logger: silentLogger },
      new Map([
        ["docker", fakeFactory(selected)],
        ["kubernetes", fakeFactory(bystander)],
      ]),
      new Map(),
    );
    expect(bystander.constructed).toBe(0);
  });

  it("the built-in name set is DD-002's isolation ladder", () => {
    expect([...BUILT_IN_SANDBOX_PROVISIONER_TYPES]).toEqual([
      "local-process",
      "docker",
      "kubernetes",
    ]);
  });
});

describe("sandboxBaseName (the Java SandboxObjectNaming derivation)", () => {
  it("is deterministic per scope+id and distinct across scopes", () => {
    const a = sandboxBaseName("session", "ses_01ABC");
    expect(a).toBe(sandboxBaseName("session", "ses_01ABC"));
    expect(a).not.toBe(sandboxBaseName("workflow", "ses_01ABC"));
    expect(a).not.toBe(sandboxBaseName("session", "ses_01ABD"));
  });

  it("emits the sbx-<code>-<12-hex> shape, DNS-safe for id alphabets", () => {
    for (const [scope, code] of [
      ["session", "ses"],
      ["workflow", "wfx"],
      ["connect", "mcp"],
    ] as const) {
      const name = sandboxBaseName(scope, "wfx_01J_UNDERSCORED.id");
      expect(name).toMatch(new RegExp(`^sbx-${code}-[0-9a-f]{12}$`));
    }
  });

  // The runner's attach waiter derives the same name from the queue it is
  // pushed and refuses a queue whose name is not its own sandbox's; it imports
  // nothing from the server, so both packages pin these vectors
  // (backend/services/runner/src/attach/__tests__/push.test.ts).
  it("matches the vectors the runner's attach waiter pins", () => {
    expect(sandboxBaseName("session", "ses_01m3zkdb7wxbe2gx0ezmf8fmaq")).toBe("sbx-ses-4e918096d317");
    expect(sandboxBaseName("workflow", "wfx_01m3zk8zjqdj5jsep1zngaawxq")).toBe("sbx-wfx-6406dd0a36ee");
    expect(sandboxBaseName("connect", "aex_01m3zkdb6zbg983x4yvttsysyy")).toBe("sbx-mcp-aa8898c8a32c");
  });
});
