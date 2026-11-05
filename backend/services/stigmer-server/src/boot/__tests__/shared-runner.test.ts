/**
 * Pins when a server may run every agent on one shared runner
 * (shared-runner.ts): only the Enterprise edition, with an organization
 * limit other than 1 and no sandbox driver, is refused, and its operator's
 * acknowledgement turns the refusal into one warning. Open source, the
 * hosted edition, a one-organization license and any sandbox driver boot
 * as they are. The setting takes one value (config.ts).
 */
import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { SHARED_RUNNER_REFUSAL, SHARED_RUNNER_WARNING, sharedRunnerRefusal } from "../shared-runner.js";

const base = { edition: ServerEdition.enterprise, orgLimit: undefined, sandboxProvisionerType: "", acknowledged: false };

describe("sharedRunnerRefusal", () => {
  it("refuses an Enterprise server that may hold several organizations with no sandbox driver", () => {
    expect(sharedRunnerRefusal(base)).toBe("refused");
    expect(sharedRunnerRefusal({ ...base, orgLimit: 5 })).toBe("refused");
  });

  it("counts local-process as no driver: its runners are the server's own user, with the server's environment", () => {
    expect(sharedRunnerRefusal({ ...base, sandboxProvisionerType: "local-process" })).toBe("refused");
    expect(sharedRunnerRefusal({ ...base, sandboxProvisionerType: "local-process", acknowledged: true })).toBe(
      "acknowledged",
    );
  });

  it("boots it with the warning once its operator accepts the sharing", () => {
    expect(sharedRunnerRefusal({ ...base, acknowledged: true })).toBe("acknowledged");
  });

  it("leaves a one-organization license, any sandbox driver, open source and the hosted edition alone", () => {
    expect(sharedRunnerRefusal({ ...base, orgLimit: 1 })).toBe("not-shared");
    for (const driver of ["docker", "agent-sandbox", "substrate", "cloud-substrate"]) {
      expect(sharedRunnerRefusal({ ...base, sandboxProvisionerType: driver })).toBe("not-shared");
    }
    expect(sharedRunnerRefusal({ ...base, edition: ServerEdition.oss })).toBe("not-shared");
    expect(sharedRunnerRefusal({ ...base, edition: ServerEdition.cloud })).toBe("not-shared");
  });

  it("names both fixes in its refusal, and what is shared in its warning", () => {
    expect(SHARED_RUNNER_REFUSAL).toContain("SANDBOX_PROVISIONER_TYPE to docker, agent-sandbox or substrate");
    expect(SHARED_RUNNER_REFUSAL).toContain("STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS=accepted");
    expect(SHARED_RUNNER_WARNING).toContain("share one runner user");
  });
});

describe("STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS", () => {
  it("is false unset or empty, true for accepted, and stops the boot for anything else", () => {
    expect(loadConfig({}).sharedRunnerAcrossOrganizations).toBe(false);
    expect(loadConfig({ STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS: "" }).sharedRunnerAcrossOrganizations).toBe(false);
    expect(loadConfig({ STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS: "accepted" }).sharedRunnerAcrossOrganizations).toBe(true);
    for (const value of ["true", "Accepted", "yes"]) {
      expect(() => loadConfig({ STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS: value })).toThrow(
        `STIGMER_SHARED_RUNNER_ACROSS_ORGANIZATIONS is "${value}"; the one value it takes is "accepted", or leave it unset`,
      );
    }
  });
});
