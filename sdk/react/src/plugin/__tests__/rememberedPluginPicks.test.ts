/**
 * The plugin picks a browser remembers per organization. Pins: picks round
 * trip per organization and never cross to another; an empty list forgets
 * them; a value of the wrong shape is dropped entry by entry, and one that
 * is not JSON reads as nothing; storage that throws reads as nothing and
 * writes nothing, without throwing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PLUGIN_PICKS_STORAGE_KEY, readRememberedPluginPicks, rememberPluginPicks } from "../rememberedPluginPicks.js";

afterEach(() => {
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
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readRememberedPluginPicks("acme")).toEqual([]);
    expect(() => rememberPluginPicks("acme", [{ org: "acme", slug: "linear" }])).not.toThrow();
  });
});
