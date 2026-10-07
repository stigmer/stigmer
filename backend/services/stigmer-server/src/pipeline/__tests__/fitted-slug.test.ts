/**
 * Pins fittedSlug (slug.ts): a slug fitted to metadata.slug's own rules
 * for every name the server may choose (an account's email or subject, a
 * managed resource's name), checked through the same checkDerivedSlug
 * every other kind's derivation answers to. A name whose slug the rules
 * already admit keeps the slug every earlier release derived; a name that
 * starts with a digit gains `a-`; a name with no ASCII letter or digit
 * falls back to the subject; a name too long is cut and hashed, so two long
 * names sharing their first 54 characters still differ. fittedName cuts a
 * server-chosen name to metadata.name's 200 characters, never through one.
 */
import { describe, expect, it } from "vitest";

import { checkDerivedSlug, fittedName, fittedSlug, generateSlug } from "../steps/slug.js";

const VALID = { from: "the account's name", fix: "none" };

function expectValid(slug: string): void {
  expect(() => checkDerivedSlug(slug, VALID), slug).not.toThrow();
}

describe("fittedSlug", () => {
  it("keeps the slug the shared generator derives whenever the rules admit it", () => {
    for (const name of ["pat@example.com", "The Operator", "ops-team.alerts@acme.io"]) {
      expect(fittedSlug(name, "auth0|1")).toBe(generateSlug(name));
    }
  });

  it("puts a letter in front of a slug that starts with a digit", () => {
    expect(fittedSlug("2024intern@acme.com", "auth0|1")).toBe("a-2024internacme-com");
    expect(fittedSlug("12345", "stgm_pc|acme|12345")).toBe("a-12345");
    expect(fittedSlug("550e8400-e29b-41d4-a716-446655440000", "x")).toBe(
      "a-550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("falls back, in order, when the name has no ASCII letter or digit", () => {
    expect(fittedSlug("李明", "local|ops@example.com", "ida_01x")).toBe("localopsexample-com");
    expect(fittedSlug("李明", "", "ida_01x")).toBe("ida01x");
    expect(() => fittedSlug("李明", "!!!")).toThrow("ASCII letter or digit");
  });

  it("cuts a long slug to 63 with a hash of its source, so two long names still differ", () => {
    const shared = `${"x".repeat(60)}`;
    const one = fittedSlug(`${shared}one@example.com`, "s");
    const two = fittedSlug(`${shared}two@example.com`, "s");
    expect(one).toHaveLength(63);
    expect(one).not.toBe(two);
    expect(one.startsWith("x".repeat(54))).toBe(true);
  });

  it("lengthens a one-character slug with the hash", () => {
    const slug = fittedSlug("x", "s");
    expect(slug).toMatch(/^x-[0-9a-f]{8}$/);
  });

  it("derives a slug the rules admit for every shape of name the server chooses", () => {
    const names = [
      "pat@example.com",
      "2024intern@acme.com",
      "12345",
      "550e8400-e29b-41d4-a716-446655440000",
      "李明",
      "x",
      "-",
      `${"9".repeat(80)}@example.com`,
      `${"a-".repeat(40)}b`,
      "auth0|5f8a1b2c3d4e5f6a7b8c9d0e",
      "abc123@clients",
    ];
    for (const name of names) {
      expectValid(fittedSlug(name, "local|ops@example.com", "ida_01x"));
    }
  });
});

describe("fittedName", () => {
  it("keeps a name within the bound, and cuts a longer one to 200 characters", () => {
    expect(fittedName("OAuth: Customer Support")).toBe("OAuth: Customer Support");
    const atBound = `OAuth: ${"y".repeat(193)}`;
    expect(fittedName(atBound)).toBe(atBound);
    expect(fittedName(`OAuth: ${"y".repeat(200)}`)).toBe(`OAuth: ${"y".repeat(193)}`);
  });

  it("counts characters, not UTF-16 units, so the cut never splits one", () => {
    const name = "😀".repeat(201);
    const fitted = fittedName(name);
    expect(Array.from(fitted)).toHaveLength(200);
    expect(fitted).toBe("😀".repeat(200));
  });
});
