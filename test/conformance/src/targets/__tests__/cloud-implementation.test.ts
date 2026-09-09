// Unit arms for the cloud target's implementation declaration
// (CLOUD_ENV.implementation, stigmer#1012): REQUIRED and CLOSED. A connect-only
// target cannot learn from the wire whether Java or the TypeScript composition
// answers it, so the provisioner says — and a provisioner that forgot, or
// typed something else, is refused by name rather than inheriting the other
// implementation's registered quirks. Pure: the reader takes its env.
// Domain: conformance targets.
import { describe, expect, it } from "vitest";
import { CLOUD_ENV } from "../../harness/cloud-env";
import { CloudTarget, readCloudImplementation } from "../cloud";
import { CloudExecutionTarget } from "../cloud-execution";
import { LocalTarget } from "../local";
import { LocalExecutionTarget } from "../local-execution";
import { LocalPostgresExecutionTarget, LocalPostgresTarget } from "../local-postgres";
import { SERVER_IMPLEMENTATIONS, isServerImplementation } from "../target";

describe("readCloudImplementation", () => {
  it("accepts each server implementation as declared", () => {
    for (const implementation of SERVER_IMPLEMENTATIONS) {
      expect(readCloudImplementation({ [CLOUD_ENV.implementation]: implementation })).toBe(implementation);
    }
  });

  it("refuses an unset declaration by name — there is no default to inherit", () => {
    expect(() => readCloudImplementation({})).toThrow(
      `${CLOUD_ENV.implementation} is not set: the cloud target is connect-only and cannot tell which server answers it`,
    );
    expect(() => readCloudImplementation({ [CLOUD_ENV.implementation]: "" })).toThrow(
      `${CLOUD_ENV.implementation} is not set`,
    );
  });

  it("refuses a value outside the union, naming the offender — a typo cannot pass as either side", () => {
    expect(() => readCloudImplementation({ [CLOUD_ENV.implementation]: "java" })).toThrow(
      `${CLOUD_ENV.implementation} must be "stigmer-server" or "stigmer-service"; got "java"`,
    );
    expect(() => readCloudImplementation({ [CLOUD_ENV.implementation]: "Stigmer-Server" })).toThrow('got "Stigmer-Server"');
  });
});

describe("isServerImplementation", () => {
  it("is exactly the two-member union", () => {
    expect(SERVER_IMPLEMENTATIONS).toEqual(["stigmer-server", "stigmer-service"]);
    expect(isServerImplementation("stigmer-server")).toBe(true);
    expect(isServerImplementation("stigmer-service")).toBe(true);
    expect(isServerImplementation("cloud")).toBe(false);
    expect(isServerImplementation("")).toBe(false);
  });
});

describe("TargetProfile.implementation", () => {
  it("is the TypeScript server on every local target, by construction", () => {
    for (const target of [
      new LocalTarget(),
      new LocalExecutionTarget(),
      new LocalPostgresTarget(),
      new LocalPostgresExecutionTarget(),
    ]) {
      expect(target.implementation, target.name).toBe("stigmer-server");
    }
  });

  it("on the cloud targets is unknown until setup() has read the declaration, and says so", () => {
    expect(() => new CloudTarget().implementation).toThrow("CloudTarget.setup() must run before implementation is read");
    // The execution target delegates to the inner cloud target verbatim.
    expect(() => new CloudExecutionTarget().implementation).toThrow(
      "CloudTarget.setup() must run before implementation is read",
    );
  });
});
