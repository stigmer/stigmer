// Pins the conformance helper that reads how the server's refusal copy names
// an organization the caller acts in (support/organizations.ts): its slug,
// read from the organization the value names, and the value as given when
// the server answers no slug.
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { organizationSlug } from "../organizations";

function queryAnswering(slug: string | undefined): ConformanceClients["organizationQuery"] {
  return {
    get: async () => ({ metadata: slug === undefined ? undefined : { slug } }),
  } as unknown as ConformanceClients["organizationQuery"];
}

describe("organizationSlug", () => {
  it("answers the slug of the organization a value names", async () => {
    expect(await organizationSlug(queryAnswering("acme"), "org_01jaaaaaaaaaaaaaaaaaaaaaaa")).toBe("acme");
  });

  it("answers the value as given when the server answers no slug", async () => {
    expect(await organizationSlug(queryAnswering(undefined), "org_01jaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});
