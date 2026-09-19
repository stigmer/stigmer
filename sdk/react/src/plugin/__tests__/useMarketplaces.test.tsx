/**
 * The browser's source list: the four built-ins first and immovable (the
 * CLI's list, so the two clients cannot drift), GitHub sources added after
 * being read (the name defaulting to the marketplace file's own) and
 * remembered in localStorage in the CLI's entry shape, the reserved and
 * taken names and a repository that is not a marketplace refused with a
 * sentence, an entry this version cannot read listed as unreadable with its
 * reason, a remembered entry under a built-in name yielding to the built-in,
 * and every mounted consumer seeing a change at once.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  type AddSourceOutcome,
  MARKETPLACES_STORAGE_KEY,
  OFFICIAL_MARKETPLACE_NAME,
  useMarketplaces,
} from "../useMarketplaces.js";
import { HOSTED_MARKETPLACE_NAME, HOSTED_REPO, hostedFetch } from "./fixtures/hosted-marketplace.js";

const BUILT_IN_NAMES = [OFFICIAL_MARKETPLACE_NAME];

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("useMarketplaces", () => {
  it("starts with the official catalogue alone; a vendor's name is not reserved", () => {
    const { result } = renderHook(() => useMarketplaces());
    expect(result.current.marketplaces.map((m) => m.name)).toEqual(BUILT_IN_NAMES);
    expect(result.current.marketplaces[0]?.source).toEqual({ type: "official" });
    expect(result.current.unreadable).toEqual([]);
    for (const name of BUILT_IN_NAMES) expect(result.current.isBuiltIn(name)).toBe(true);
    expect(result.current.isBuiltIn("cursor-plugins")).toBe(false);
  });

  it("reads a GitHub source, records it under the file's own name in the CLI's entry shape, and removes it", async () => {
    const { fetchImpl } = hostedFetch();
    const { result } = renderHook(() => useMarketplaces({ fetchImpl }));
    let outcome: AddSourceOutcome | undefined;
    await act(async () => {
      outcome = await result.current.add(`https://github.com/${HOSTED_REPO}/tree/main`);
    });
    expect(outcome).toEqual({ ok: true, name: HOSTED_MARKETPLACE_NAME });
    expect(result.current.marketplaces.at(-1)).toEqual({
      name: HOSTED_MARKETPLACE_NAME,
      source: { type: "github", repo: HOSTED_REPO, ref: "main" },
    });
    expect(JSON.parse(window.localStorage.getItem(MARKETPLACES_STORAGE_KEY) ?? "{}")).toEqual({
      [HOSTED_MARKETPLACE_NAME]: { type: "github", repo: HOSTED_REPO, ref: "main" },
    });

    let refusal: string | null = "unset";
    act(() => {
      refusal = result.current.remove(HOSTED_MARKETPLACE_NAME);
    });
    expect(refusal).toBeNull();
    expect(result.current.marketplaces.map((m) => m.name)).toEqual(BUILT_IN_NAMES);
    expect(window.localStorage.getItem(MARKETPLACES_STORAGE_KEY)).toBeNull();
  });

  it("takes a given name over the file's, and refuses a built-in, a taken and a bad name, a non-source, and a repository that is not a marketplace", async () => {
    const { fetchImpl } = hostedFetch();
    const { result } = renderHook(() => useMarketplaces({ fetchImpl }));

    expect(await result.current.add("not a repo")).toMatchObject({ ok: false, message: expect.stringContaining("GitHub") });
    expect(await result.current.add("other/repo")).toMatchObject({
      ok: false,
      message: expect.stringContaining("not"),
    });
    expect(await result.current.add(HOSTED_REPO, OFFICIAL_MARKETPLACE_NAME)).toEqual({
      ok: false,
      message: `'${OFFICIAL_MARKETPLACE_NAME}' is a built-in source and cannot be added or replaced; choose another name`,
    });
    expect(await result.current.add(HOSTED_REPO, "Bad Name")).toMatchObject({
      ok: false,
      message: expect.stringContaining("not a source name"),
    });

    await act(async () => {
      expect(await result.current.add(HOSTED_REPO, "mine")).toEqual({ ok: true, name: "mine" });
    });
    expect(await result.current.add(HOSTED_REPO, "mine")).toMatchObject({
      ok: false,
      message: expect.stringContaining("already added"),
    });
    expect(result.current.remove(OFFICIAL_MARKETPLACE_NAME)).toBe(
      `'${OFFICIAL_MARKETPLACE_NAME}' is a built-in source and cannot be removed`,
    );
    expect(result.current.remove("ghost")).toContain("no source named");
  });

  it("lists an entry it cannot read with its reason, never silently, and lets the built-in win a remembered name", () => {
    window.localStorage.setItem(
      MARKETPLACES_STORAGE_KEY,
      JSON.stringify({
        good: { type: "github", repo: "a/b" },
        [OFFICIAL_MARKETPLACE_NAME]: { type: "github", repo: "someone/fork" },
        broken: { type: "local", path: "/tmp" },
        typeless: {},
      }),
    );
    const { result } = renderHook(() => useMarketplaces());
    expect(result.current.marketplaces.map((m) => m.name)).toEqual([...BUILT_IN_NAMES, "good"]);
    expect(result.current.marketplaces[0]?.source).toEqual({ type: "official" });
    expect(result.current.unreadable).toEqual([
      { name: "broken", reason: "unknown type 'local' (expected 'github')" },
      { name: "typeless", reason: "no 'type' (expected 'github')" },
    ]);
  });

  it("notifies every mounted consumer of a change", async () => {
    const { fetchImpl } = hostedFetch();
    const first = renderHook(() => useMarketplaces({ fetchImpl }));
    const second = renderHook(() => useMarketplaces());
    await act(async () => {
      await first.result.current.add(HOSTED_REPO, "shared");
    });
    expect(second.result.current.marketplaces.map((m) => m.name)).toEqual([...BUILT_IN_NAMES, "shared"]);
  });
});
