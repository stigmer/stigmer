/**
 * Pins keptReference (stigmer#2172): a stored reference goes back by the
 * id it holds, so a renamed or deleted target is judged by id; a row
 * without one (just picked) goes by its org and slug; a pin rides along.
 */
import { describe, expect, it } from "vitest";
import { keptReference } from "../kept-reference.js";

describe("keptReference", () => {
  it("sends a stored reference back by its id, its pin kept", () => {
    expect(
      keptReference({
        org: "org_acme",
        slug: "test-bot",
        id: "agt_1",
        version: "stable",
      }),
    ).toEqual({
      org: "org_acme",
      slug: "",
      id: "agt_1",
      version: "stable",
    });
  });

  it("sends a deleted target's reference (id, no slug) back by its id", () => {
    expect(
      keptReference({ org: "org_acme", slug: "", id: "agt_gone" }),
    ).toEqual({ org: "org_acme", slug: "", id: "agt_gone" });
  });

  it("sends a just-picked row by its org and slug", () => {
    expect(keptReference({ org: "org_acme", slug: "support-bot" })).toEqual({
      org: "org_acme",
      slug: "support-bot",
    });
  });
});
