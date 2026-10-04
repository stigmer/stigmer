// Unit tests for the organization-name helpers the commands that compare or
// print organizations use (client/organizations.ts): equal strings need no
// call, an id and a slug of one organization are the same, a value the
// caller cannot see (NotFound or PermissionDenied) is a different
// organization and prints as given. Any other failure (an unreachable
// server) rejects the lookup and the comparison, and a label falls back to
// the value as given.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Stigmer } from "@stigmer/sdk";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { describe, expect, it } from "vitest";
import {
  cannotSeeOrganization,
  organizationLabel,
  organizationLabels,
  organizationNamed,
  sameOrganization,
} from "../organizations.js";

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

/**
 * A client whose organization get answers acme by slug or id, refuses
 * `secret` as the server refuses an organization the caller cannot see, and
 * answers NotFound for anything else.
 */
function stigmerKnowingAcme(): Stigmer & { gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    organization: {
      get: async (value: string) => {
        gets.push(value);
        if (value === "secret") throw new ConnectError("not allowed", Code.PermissionDenied);
        if (value !== "acme" && value !== ACME_ID) throw new ConnectError("not found", Code.NotFound);
        return create(OrganizationSchema, { metadata: { id: ACME_ID, slug: "acme" } });
      },
    },
  } as unknown as Stigmer & { gets: string[] };
}

/** A client whose organization get fails as an unreachable server does. */
function stigmerUnreachable(): Stigmer {
  return {
    organization: {
      get: async () => {
        throw new ConnectError("connection refused", Code.Unavailable);
      },
    },
  } as unknown as Stigmer;
}

describe("organization names", () => {
  it("answers the organization a slug or id names, and undefined for one the caller cannot see", async () => {
    const stigmer = stigmerKnowingAcme();
    expect(await organizationNamed(stigmer, "acme")).toEqual({ id: ACME_ID, slug: "acme" });
    expect(await organizationNamed(stigmer, ACME_ID)).toEqual({ id: ACME_ID, slug: "acme" });
    expect(await organizationNamed(stigmer, "globex")).toBeUndefined();
    expect(await organizationNamed(stigmer, "secret")).toBeUndefined();
    expect(await organizationNamed(stigmer, "")).toBeUndefined();
  });

  it("rejects with any failure other than not being able to see it", async () => {
    await expect(organizationNamed(stigmerUnreachable(), "acme")).rejects.toThrow(/connection refused/);
    await expect(sameOrganization(stigmerUnreachable(), "acme", ACME_ID)).rejects.toThrow(/connection refused/);
  });

  it("reads NotFound and PermissionDenied, and nothing else, as a value the caller cannot see", () => {
    expect(cannotSeeOrganization(new ConnectError("x", Code.NotFound))).toBe(true);
    expect(cannotSeeOrganization(new ConnectError("x", Code.PermissionDenied))).toBe(true);
    expect(cannotSeeOrganization(new ConnectError("x", Code.Unauthenticated))).toBe(false);
    expect(cannotSeeOrganization(new ConnectError("x", Code.Unavailable))).toBe(false);
    expect(cannotSeeOrganization(new Error("fetch failed"))).toBe(false);
  });

  it("treats a slug and an id of one organization as the same, without a call for equal strings", async () => {
    const stigmer = stigmerKnowingAcme();
    expect(await sameOrganization(stigmer, "acme", "acme")).toBe(true);
    expect(stigmer.gets).toEqual([]);
    expect(await sameOrganization(stigmer, "acme", ACME_ID)).toBe(true);
    expect(await sameOrganization(stigmer, "acme", "globex")).toBe(false);
  });

  it("labels an organization by its slug, or by the value as given when the caller cannot see it", async () => {
    const stigmer = stigmerKnowingAcme();
    expect(await organizationLabel(stigmer, ACME_ID)).toBe("acme");
    expect(await organizationLabel(stigmer, "org_01jbbbbbbbbbbbbbbbbbbbbbbb")).toBe(
      "org_01jbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  it("labels by the value as given when the lookup fails, so printing never fails a command", async () => {
    expect(await organizationLabel(stigmerUnreachable(), ACME_ID)).toBe(ACME_ID);
  });

  it("labels many values with one lookup per distinct non-empty value", async () => {
    const stigmer = stigmerKnowingAcme();
    const labels = await organizationLabels(stigmer, [ACME_ID, "", ACME_ID, "globex"]);
    expect([...labels]).toEqual([
      [ACME_ID, "acme"],
      ["globex", "globex"],
    ]);
    expect(stigmer.gets).toEqual([ACME_ID, "globex"]);
  });
});
