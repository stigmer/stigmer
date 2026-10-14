// Pins the conformance helpers in support/grants.ts: the kind's api version
// and kind string, the not-found copy, the three annotation sentences the
// Grant service's protos declare as their error_msg (read from the protos
// themselves, so a reworded proto fails here before a suite's assertion
// does), and the triple builders (organizationRole names the identity
// account as principal and the organization by id; grantTriple carries a
// principal relation, empty when none is given).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_GRANT_DENIED_MESSAGE,
  CLEANUP_RESOURCE_GRANTS_DENIED_MESSAGE,
  GRANT_API_VERSION,
  GRANT_KIND,
  VIEW_GRANTS_DENIED_MESSAGE,
  grantNotFoundMessage,
  grantTriple,
  organizationRole,
} from "../grants";

/** The `error_msg` strings a Grant service proto declares. */
function errorMessagesOf(file: string): ReadonlyArray<string> {
  const proto = readFileSync(
    new URL(`../../../../../apis/ai/stigmer/iam/grant/v1/${file}`, import.meta.url),
    "utf8",
  );
  return [...proto.matchAll(/\.error_msg = "([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("the kind's constants", () => {
  it("are the Grant kind's api version and kind string", () => {
    expect(GRANT_API_VERSION).toBe("iam.stigmer.ai/v1");
    expect(GRANT_KIND).toBe("Grant");
  });

  it("answer an unknown id with the Grant not-found copy", () => {
    expect(grantNotFoundMessage("grt_x")).toBe("Grant not found: grt_x");
  });
});

describe("the annotation copy", () => {
  it("is the error_msg the Grant protos declare", () => {
    expect(errorMessagesOf("query.proto")).toContain(VIEW_GRANTS_DENIED_MESSAGE);
    expect(errorMessagesOf("command.proto")).toEqual(
      expect.arrayContaining([BOOTSTRAP_GRANT_DENIED_MESSAGE, CLEANUP_RESOURCE_GRANTS_DENIED_MESSAGE]),
    );
  });
});

describe("the triple builders", () => {
  it("organizationRole names the identity account as principal and the organization by id", () => {
    expect(organizationRole("ida_01person", "admin", "org_01acme")).toMatchObject({
      principal: { kind: "identity_account", id: "ida_01person", relation: "" },
      relation: "admin",
      resource: { kind: "organization", id: "org_01acme" },
    });
  });

  it("grantTriple carries a principal's relation when it names one", () => {
    expect(grantTriple({ kind: "team", id: "tm_sre", relation: "member" }, "viewer", { kind: "agent", id: "agt_1" })).toMatchObject({
      principal: { kind: "team", id: "tm_sre", relation: "member" },
      relation: "viewer",
      resource: { kind: "agent", id: "agt_1" },
    });
  });
});
