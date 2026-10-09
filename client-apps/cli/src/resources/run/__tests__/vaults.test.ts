// `stigmer run --vault`: how each reference becomes the reference a new
// conversation stores. Pins the three forms the vault verbs accept (id,
// org/slug, slug in the run's organization), that an id is looked up for its
// organization and slug, that order is kept and a repeat is sent once, and
// that an empty reference is refused before anything is sent.

import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { UsageError } from "../../../errors/index.js";
import { resolveRunVaults, type VaultReader } from "../vaults.js";

const VAULT_ID = "vlt_01hzzzzzzzzzzzzzzzzzzzzzzz";

function reader(lookups: string[] = []): VaultReader {
  return {
    vault: {
      get: (id: string) => {
        lookups.push(id);
        return Promise.resolve({ metadata: { id, org: "org_01hzzzzzzzzzzzzzzzzzzzzzzz", slug: "team-keys" } });
      },
    },
  } as unknown as VaultReader;
}

describe("resolveRunVaults", () => {
  it("names a slug in the run's organization and an org/slug as written, without a read", async () => {
    const lookups: string[] = [];
    const refs = await resolveRunVaults(reader(lookups), ["support-tools", "platform/shared"], "acme");
    expect(refs.map((ref) => [ref.kind, ref.org, ref.slug])).toEqual([
      [ApiResourceKind.vault, "acme", "support-tools"],
      [ApiResourceKind.vault, "platform", "shared"],
    ]);
    expect(lookups).toEqual([]);
  });

  it("looks a vault id up for its organization and slug", async () => {
    const lookups: string[] = [];
    const refs = await resolveRunVaults(reader(lookups), [VAULT_ID], "acme");
    expect(lookups).toEqual([VAULT_ID]);
    expect(refs.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(["org_01hzzzzzzzzzzzzzzzzzzzzzzz/team-keys"]);
  });

  it("keeps the order given and sends a repeated vault once, in its first place", async () => {
    const refs = await resolveRunVaults(reader(), ["b", "a", "acme/b"], "acme");
    expect(refs.map((ref) => ref.slug)).toEqual(["b", "a"]);
  });

  it("refuses an empty reference", async () => {
    await expect(resolveRunVaults(reader(), [" "], "acme")).rejects.toBeInstanceOf(UsageError);
  });
});
