// Pins the Environment fixtures in support/environments.ts: the fixture
// every edition accepts is unrestricted, carries no packages and takes the
// default description unless given one, and the limited fixture lists the
// hosts it is given and nothing else.
// Pure: hand-built shapes, no target.
// Domain: conformance support (environments).
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { describe, expect, it } from "vitest";

import { ENVIRONMENT_API_VERSION, ENVIRONMENT_KIND, makeEnvironment, makeLimitedEnvironment } from "../environments";

describe("makeEnvironment", () => {
  it("shapes an unrestricted Environment with no packages and the default description", () => {
    expect(makeEnvironment("acme", "data-science")).toEqual({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Environment",
      metadata: { name: "data-science", org: "acme" },
      spec: { description: "conformance environment", networking: { type: NetworkingType.unrestricted } },
    });
  });

  it("carries the description it is given", () => {
    expect(makeEnvironment("acme", "data-science", "pandas and numpy").spec?.description).toBe("pandas and numpy");
  });
});

describe("makeLimitedEnvironment", () => {
  it("shapes a limited Environment listing exactly the hosts it is given", () => {
    expect(makeLimitedEnvironment("acme", "locked-down", ["api.example.com", "files.example.com"])).toEqual({
      apiVersion: ENVIRONMENT_API_VERSION,
      kind: ENVIRONMENT_KIND,
      metadata: { name: "locked-down", org: "acme" },
      spec: {
        networking: { type: NetworkingType.limited, allowedHosts: ["api.example.com", "files.example.com"] },
      },
    });
  });
});
