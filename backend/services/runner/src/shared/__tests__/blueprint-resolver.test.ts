/**
 * `shared/blueprint-resolver.ts` `mergeSkillRefs`: the one merge of the
 * agent's and the session's skill refs the turn runtime resolves from
 * (`resolveAgentBlueprint`). Union, deduplicated by slug, the session's ref
 * winning a collision (it may pin a different version).
 *
 * Carried from `skill-writer.test.ts` at S3 M2b, when the native
 * orchestrator's byte-twin of this function was deleted with its module;
 * until then the runtime's copy was tested only through the twin.
 */

import { describe, it, expect } from "vitest";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { mergeSkillRefs } from "../blueprint-resolver.js";

function makeRef(slug: string, org = "test-org"): ApiResourceReference {
  return { slug, org, $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference" } as ApiResourceReference;
}

describe("mergeSkillRefs", () => {
  it("returns empty for no refs", () => {
    expect(mergeSkillRefs([], [])).toEqual([]);
  });

  it("returns the agent's refs when the session names none", () => {
    const result = mergeSkillRefs([makeRef("skill-a"), makeRef("skill-b")], []);
    expect(result.map((r) => r.slug)).toEqual(["skill-a", "skill-b"]);
  });

  it("deduplicates by slug with the session's ref winning", () => {
    const result = mergeSkillRefs([makeRef("skill-a", "org1")], [makeRef("skill-a", "org2")]);
    expect(result).toHaveLength(1);
    expect(result[0].org).toBe("org2");
  });

  it("unions distinct skills from both sources", () => {
    expect(mergeSkillRefs([makeRef("skill-a")], [makeRef("skill-b")])).toHaveLength(2);
  });

  it("ignores a ref with no slug (nothing to key it by)", () => {
    expect(mergeSkillRefs([makeRef("")], [])).toEqual([]);
  });
});
