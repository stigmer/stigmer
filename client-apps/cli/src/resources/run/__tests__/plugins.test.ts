// `stigmer run --plugin`: how each reference becomes the plugin reference a
// new conversation stores. Pins that a slug and an org/slug are sent as
// written with kind plugin, that a plugin id is looked up for its
// organization and slug, that a repeat is sent once in its first place, and
// that a malformed reference is refused naming --plugin. The shared rule
// behind both run flags is pinned in full by vaults.test.ts.

import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { UsageError } from "../../../errors/index.js";
import { type PluginReader, resolveRunPlugins } from "../plugins.js";

const PLUGIN_ID = "plg_01hzzzzzzzzzzzzzzzzzzzzzzz";

function reader(lookups: string[] = []): PluginReader {
  return {
    plugin: {
      get: (id: string) => {
        lookups.push(id);
        return Promise.resolve({ metadata: { id, org: "platform", slug: "github" } });
      },
    },
  } as unknown as PluginReader;
}

describe("resolveRunPlugins", () => {
  it("sends slugs and org/slugs as plugin references, in order, a repeat once", async () => {
    const lookups: string[] = [];
    const refs = await resolveRunPlugins(reader(lookups), ["linear", "platform/github", "acme/linear"], "acme");
    expect(refs.map((ref) => [ref.kind, ref.org, ref.slug])).toEqual([
      [ApiResourceKind.plugin, "acme", "linear"],
      [ApiResourceKind.plugin, "platform", "github"],
    ]);
    expect(lookups).toEqual([]);
  });

  it("looks a plugin id up for its organization and slug", async () => {
    const lookups: string[] = [];
    const refs = await resolveRunPlugins(reader(lookups), [PLUGIN_ID], "acme");
    expect(lookups).toEqual([PLUGIN_ID]);
    expect(refs.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(["platform/github"]);
  });

  it("refuses a malformed reference, naming the flag", async () => {
    await expect(resolveRunPlugins(reader(), ["acme/"], "acme")).rejects.toThrow(UsageError);
    await expect(resolveRunPlugins(reader(), ["a/b/c"], "acme")).rejects.toThrow(
      "invalid --plugin value 'a/b/c': name a plugin by id, org/slug or slug",
    );
  });
});
