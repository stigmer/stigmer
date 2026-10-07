/**
 * Pins checkDerivedSlug's third answer (slug.ts): when the shared validator
 * cannot evaluate the slug rules at all, the refusal is Internal, a server
 * defect, never the InvalidArgument a bad name earns, and it names the
 * slug validation. The validator is replaced for this file alone, since the
 * real metadata rules always compile.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

vi.mock("../steps/validation.js", () => ({
  validator: () => ({
    validate: () => ({ kind: "error", error: new Error("rule did not compile") }),
  }),
}));

const { checkDerivedSlug } = await import("../steps/slug.js");

describe("checkDerivedSlug when the rules cannot be evaluated", () => {
  it("refuses with Internal, naming the slug validation, not with InvalidArgument", () => {
    let thrown: unknown;
    try {
      checkDerivedSlug("my-agent", { from: "the name 'My Agent'", fix: "set metadata.slug" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.Internal);
    expect((thrown as ConnectError).rawMessage).toContain("slug validation");
  });
});
