import { describe, it, expect } from "vitest";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { environmentVisibilityLevels } from "../visibilityLevels";

describe("environmentVisibilityLevels", () => {
  it("offers exactly Private and Organization in cloud mode", () => {
    const levels = environmentVisibilityLevels("cloud");
    expect(levels.map((l) => l.value)).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
    ]);
  });

  it("never offers public or platform — secrets stay inside the org", () => {
    for (const mode of ["cloud", "local"] as const) {
      const values = environmentVisibilityLevels(mode).map((l) => l.value);
      expect(values).not.toContain(ApiResourceVisibility.visibility_public);
      expect(values).not.toContain(ApiResourceVisibility.visibility_platform);
    }
  });

  it("confirms before escalating to org (credentials become runtime-usable org-wide)", () => {
    const org = environmentVisibilityLevels("cloud").find(
      (l) => l.value === ApiResourceVisibility.visibility_org,
    );
    expect(org?.confirmPrompt).toBeTruthy();
    expect(org?.description).toContain("secret values stay hidden");
  });

  it("collapses to a single read-only level in local mode", () => {
    expect(environmentVisibilityLevels("local")).toHaveLength(1);
  });
});
