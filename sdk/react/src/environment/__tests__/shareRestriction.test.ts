import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { isShareRestrictedEnvironment } from "../shareRestriction";

function env(labels: Record<string, string>) {
  return create(EnvironmentSchema, {
    metadata: { id: "env_1", org: "acme", labels },
  });
}

describe("isShareRestrictedEnvironment", () => {
  it("restricts personal environments", () => {
    expect(
      isShareRestrictedEnvironment(env({ "stigmer.ai/personal": "true" })),
    ).toBe(true);
  });

  it("restricts OAuth-managed environments", () => {
    expect(
      isShareRestrictedEnvironment(env({ "stigmer.ai/managed": "true" })),
    ).toBe(true);
  });

  it("does not restrict ordinary environments", () => {
    expect(isShareRestrictedEnvironment(env({}))).toBe(false);
    expect(isShareRestrictedEnvironment(env({ team: "payments" }))).toBe(false);
  });

  it("only the literal 'true' value restricts", () => {
    expect(
      isShareRestrictedEnvironment(env({ "stigmer.ai/personal": "false" })),
    ).toBe(false);
  });
});
