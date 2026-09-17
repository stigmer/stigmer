/**
 * The browser's marketplace list: the official one first and immovable,
 * GitHub sources added under a name and remembered in localStorage in the
 * CLI's entry shape, the reserved and taken names refused with a sentence,
 * an entry this version cannot read listed as unreadable with its reason,
 * and every mounted consumer seeing a change at once.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { MARKETPLACES_STORAGE_KEY, OFFICIAL_MARKETPLACE_NAME, useMarketplaces } from "../useMarketplaces.js";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("useMarketplaces", () => {
  it("starts with the official marketplace alone", () => {
    const { result } = renderHook(() => useMarketplaces());
    expect(result.current.marketplaces).toEqual([{ name: OFFICIAL_MARKETPLACE_NAME, source: { type: "official" } }]);
    expect(result.current.unreadable).toEqual([]);
  });

  it("adds a GitHub source under a name, in the CLI's entry shape, and removes it", () => {
    const { result } = renderHook(() => useMarketplaces());
    let refusal: string | null = "unset";
    act(() => {
      refusal = result.current.add("cursor-plugins", "https://github.com/cursor/plugins/tree/main");
    });
    expect(refusal).toBeNull();
    expect(result.current.marketplaces[1]).toEqual({
      name: "cursor-plugins",
      source: { type: "github", repo: "cursor/plugins", ref: "main" },
    });
    expect(JSON.parse(window.localStorage.getItem(MARKETPLACES_STORAGE_KEY) ?? "{}")).toEqual({
      "cursor-plugins": { type: "github", repo: "cursor/plugins", ref: "main" },
    });

    act(() => {
      refusal = result.current.remove("cursor-plugins");
    });
    expect(refusal).toBeNull();
    expect(result.current.marketplaces).toHaveLength(1);
    expect(window.localStorage.getItem(MARKETPLACES_STORAGE_KEY)).toBeNull();
  });

  it("refuses the reserved name, a taken name, a bad name and a non-source", () => {
    const { result } = renderHook(() => useMarketplaces());
    expect(result.current.add(OFFICIAL_MARKETPLACE_NAME, "cursor/plugins")).toContain("built-in");
    expect(result.current.add("Bad Name", "cursor/plugins")).toContain("not a marketplace name");
    expect(result.current.add("mine", "not a repo")).toContain("not a GitHub");
    act(() => {
      result.current.add("mine", "cursor/plugins");
    });
    expect(result.current.add("mine", "other/repo")).toContain("already configured");
    expect(result.current.remove(OFFICIAL_MARKETPLACE_NAME)).toContain("cannot be removed");
    expect(result.current.remove("ghost")).toContain("no marketplace named");
  });

  it("lists an entry it cannot read with its reason, never silently", () => {
    window.localStorage.setItem(
      MARKETPLACES_STORAGE_KEY,
      JSON.stringify({ good: { type: "github", repo: "a/b" }, broken: { type: "local", path: "/tmp" }, typeless: {} }),
    );
    const { result } = renderHook(() => useMarketplaces());
    expect(result.current.marketplaces.map((m) => m.name)).toEqual([OFFICIAL_MARKETPLACE_NAME, "good"]);
    expect(result.current.unreadable).toEqual([
      { name: "broken", reason: "unknown type 'local' (expected 'github')" },
      { name: "typeless", reason: "no 'type' (expected 'github')" },
    ]);
  });

  it("notifies every mounted consumer of a change", () => {
    const first = renderHook(() => useMarketplaces());
    const second = renderHook(() => useMarketplaces());
    act(() => {
      first.result.current.add("shared", "cursor/plugins");
    });
    expect(second.result.current.marketplaces.map((m) => m.name)).toEqual([OFFICIAL_MARKETPLACE_NAME, "shared"]);
  });
});
