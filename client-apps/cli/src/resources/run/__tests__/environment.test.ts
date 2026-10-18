// `stigmer run --environment`: how the reference becomes the Environment
// reference a new conversation stores. Pins that no flag names none, that a
// slug and an org/slug are sent as written with kind environment, that an
// Environment id is looked up for its organization and slug, and that a
// malformed reference is refused naming --environment before anything is
// sent. The shared rule behind every run flag is pinned in full by
// vaults.test.ts.

import { describe, expect, it } from "vitest";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { UsageError } from "../../../errors/index.js";
import { type EnvironmentReader, resolveRunEnvironment } from "../environment.js";

const ENVIRONMENT_ID = "env_01hzzzzzzzzzzzzzzzzzzzzzzz";

function reader(lookups: string[] = []): EnvironmentReader {
  return {
    environment: {
      get: (id: string) => {
        lookups.push(id);
        return Promise.resolve({ metadata: { id, org: "platform", slug: "data-science" } });
      },
    },
  } as unknown as EnvironmentReader;
}

describe("resolveRunEnvironment", () => {
  it("names none when the flag is not given, reading nothing", async () => {
    const lookups: string[] = [];
    expect(await resolveRunEnvironment(reader(lookups), "", "acme")).toBeUndefined();
    expect(lookups).toEqual([]);
  });

  it("sends a slug in the run's organization, with kind environment", async () => {
    const lookups: string[] = [];
    const ref = await resolveRunEnvironment(reader(lookups), "base-tools", "acme");
    expect([ref?.kind, ref?.org, ref?.slug]).toEqual([ApiResourceKind.environment, "acme", "base-tools"]);
    expect(lookups).toEqual([]);
  });

  it("sends an org/slug as written", async () => {
    const ref = await resolveRunEnvironment(reader(), "platform/data-science", "acme");
    expect([ref?.kind, ref?.org, ref?.slug]).toEqual([ApiResourceKind.environment, "platform", "data-science"]);
  });

  it("looks an Environment id up for its organization and slug", async () => {
    const lookups: string[] = [];
    const ref = await resolveRunEnvironment(reader(lookups), ENVIRONMENT_ID, "acme");
    expect(lookups).toEqual([ENVIRONMENT_ID]);
    expect(`${ref?.org}/${ref?.slug}`).toBe("platform/data-science");
  });

  it("refuses a malformed reference, naming the flag, before reading anything", async () => {
    const lookups: string[] = [];
    await expect(resolveRunEnvironment(reader(lookups), "acme/", "acme")).rejects.toThrow(UsageError);
    await expect(resolveRunEnvironment(reader(lookups), "a/b/c", "acme")).rejects.toThrow(
      "invalid --environment value 'a/b/c': name an environment by id, org/slug or slug",
    );
    expect(lookups).toEqual([]);
  });
});
