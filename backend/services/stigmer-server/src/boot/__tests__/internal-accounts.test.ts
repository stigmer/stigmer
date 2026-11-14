/**
 * Pins STIGMER_INTERNAL_ACCOUNTS (internal-accounts.ts): exact addresses
 * and one-`*` patterns match without regard to case, an empty address never
 * matches, and every bad entry is dropped with a warning that names it and
 * the fix while the good ones around it are kept.
 */
import { describe, expect, it } from "vitest";

import { NO_INTERNAL_ACCOUNTS, isInternalAccount, parseInternalAccounts } from "../internal-accounts.js";

describe("parseInternalAccounts", () => {
  it("lists nobody when unset or blank", () => {
    expect(parseInternalAccounts(undefined)).toEqual(NO_INTERNAL_ACCOUNTS);
    expect(parseInternalAccounts("")).toEqual(NO_INTERNAL_ACCOUNTS);
    expect(parseInternalAccounts(" , ,")).toEqual(NO_INTERNAL_ACCOUNTS);
  });

  it("keeps exact addresses and one-star patterns, lowercased, once each, in order", () => {
    const accounts = parseInternalAccounts(" Sam@Example.com, *@stigmer.ai ,walk+*@example.com,sam@example.com");
    expect(accounts.entries).toEqual(["sam@example.com", "*@stigmer.ai", "walk+*@example.com"]);
    expect(accounts.warnings).toEqual([]);
  });

  it("drops each bad entry with a warning naming it, and keeps the rest", () => {
    const accounts = parseInternalAccounts("sam, @example.com, sam@, a@b@c, *@*.com, sam smith@example.com, ok@example.com");
    expect(accounts.entries).toEqual(["ok@example.com"]);
    expect(accounts.warnings).toEqual([
      "STIGMER_INTERNAL_ACCOUNTS entry 'sam' is not an address — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com",
      "STIGMER_INTERNAL_ACCOUNTS entry '@example.com' is not an address — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com",
      "STIGMER_INTERNAL_ACCOUNTS entry 'sam@' is not an address — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com",
      "STIGMER_INTERNAL_ACCOUNTS entry 'a@b@c' is not an address — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com",
      "STIGMER_INTERNAL_ACCOUNTS entry '*@*.com' holds more than one * — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com",
      "STIGMER_INTERNAL_ACCOUNTS entry 'sam smith@example.com' holds a space — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com",
    ]);
  });
});

describe("isInternalAccount", () => {
  const accounts = parseInternalAccounts("sam@example.com, *@stigmer.ai, walk+*@example.com");

  it("matches an exact address whatever its case", () => {
    expect(isInternalAccount(accounts, "SAM@example.com")).toBe(true);
    expect(isInternalAccount(accounts, "sam@example.co")).toBe(false);
    expect(isInternalAccount(accounts, "xsam@example.com")).toBe(false);
  });

  it("matches around a pattern's one star, and the star may stand for nothing", () => {
    expect(isInternalAccount(accounts, "priya@stigmer.ai")).toBe(true);
    expect(isInternalAccount(accounts, "walk+2026-11-14@example.com")).toBe(true);
    expect(isInternalAccount(accounts, "walk+@example.com")).toBe(true);
    expect(isInternalAccount(accounts, "walk@example.com")).toBe(false);
    expect(isInternalAccount(accounts, "priya@stigmer.ai.evil.com")).toBe(false);
  });

  it("never matches an empty or missing address", () => {
    expect(isInternalAccount(accounts, "")).toBe(false);
    expect(isInternalAccount(accounts, "  ")).toBe(false);
    expect(isInternalAccount(accounts, undefined)).toBe(false);
    expect(isInternalAccount(NO_INTERNAL_ACCOUNTS, "sam@example.com")).toBe(false);
  });
});
