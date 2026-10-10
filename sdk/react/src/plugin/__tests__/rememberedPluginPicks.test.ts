/**
 * The plugin picks a browser remembers per organization. Pins: picks round
 * trip per organization and never cross to another; an empty list forgets
 * them; a value of the wrong shape is dropped entry by entry, and one that
 * is not JSON or not a list reads as nothing; storage that throws reads as
 * nothing and writes nothing, without throwing; an organization not yet
 * known (an empty org) is never remembered.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PLUGIN_PICKS_STORAGE_KEY, readRememberedPluginPicks, rememberPluginPicks } from "../rememberedPluginPicks.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("remembered plugin picks", () => {
  it("round-trips per organization, as plugin references", () => {
    rememberPluginPicks("acme", [{ org: "acme", slug: "linear" }]);
    rememberPluginPicks("globex", [{ org: "globex", slug: "notion" }]);

    expect(readRememberedPluginPicks("acme")).toEqual([{ org: "acme", slug: "linear", kind: ApiResourceKind.plugin }]);
    expect(readRememberedPluginPicks("globex")).toEqual([{ org: "globex", slug: "notion", kind: ApiResourceKind.plugin }]);
  });

  it("forgets the picks when the list is empty", () => {
    rememberPluginPicks("acme", [{ org: "acme", slug: "linear" }]);
    rememberPluginPicks("acme", []);
    expect(localStorage.getItem(`${PLUGIN_PICKS_STORAGE_KEY}:acme`)).toBeNull();
    expect(readRememberedPluginPicks("acme")).toEqual([]);
  });

  it("drops entries of the wrong shape and reads a value that is not JSON as nothing", () => {
    localStorage.setItem(`${PLUGIN_PICKS_STORAGE_KEY}:acme`, JSON.stringify([{ org: "acme", slug: "linear" }, { slug: 4 }, "x", { org: "acme", slug: "" }]));
    expect(readRememberedPluginPicks("acme").map((ref) => ref.slug)).toEqual(["linear"]);

    localStorage.setItem(`${PLUGIN_PICKS_STORAGE_KEY}:acme`, "{not json");
    expect(readRememberedPluginPicks("acme")).toEqual([]);
  });

  it("reads nothing and writes nothing when storage throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: vi.fn(blocked), setItem: vi.fn(blocked), removeItem: vi.fn(blocked) });
    expect(readRememberedPluginPicks("acme")).toEqual([]);
    expect(window.localStorage.getItem).toHaveBeenCalledWith(`${PLUGIN_PICKS_STORAGE_KEY}:acme`);
    expect(() => rememberPluginPicks("acme", [{ org: "acme", slug: "linear" }])).not.toThrow();
    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("reads a value that is not a list as nothing", () => {
    localStorage.setItem(`${PLUGIN_PICKS_STORAGE_KEY}:acme`, JSON.stringify({ org: "acme", slug: "linear" }));
    expect(readRememberedPluginPicks("acme")).toEqual([]);
  });

  it("remembers nothing for an organization not yet known", () => {
    rememberPluginPicks("", [{ org: "acme", slug: "linear" }]);
    expect(localStorage.length).toBe(0);
    expect(readRememberedPluginPicks("")).toEqual([]);
  });
});
