import { describe, it, expect } from "vitest";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  blueprintVisibilityLevels,
  environmentVisibilityLevels,
  instanceVisibilityLevels,
  visibilityLabel,
  visibilityOption,
} from "../visibilityLevels";

describe("environmentVisibilityLevels", () => {
  it("offers exactly Private and Organization in cloud mode", () => {
    const levels = environmentVisibilityLevels("cloud");
    expect(levels.map((l) => l.value)).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
    ]);
  });

  it("never offers platform — secrets stay inside the org", () => {
    for (const mode of ["cloud", "local"] as const) {
      const values = environmentVisibilityLevels(mode).map((l) => l.value);
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

  it("offers the cloud shape in enterprise mode — org sharing is an FGA-model question, not a facility", () => {
    expect(environmentVisibilityLevels("enterprise").map((l) => l.value)).toEqual(
      environmentVisibilityLevels("cloud").map((l) => l.value),
    );
  });
});

describe("blueprintVisibilityLevels", () => {
  it("offers Private and Organization when the owning org operates no identity provider", () => {
    expect(
      blueprintVisibilityLevels({ hasIdentityProvider: false }).map((l) => l.value),
    ).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
    ]);
  });

  it("adds Platform, and only Platform, when the owning org operates an identity provider", () => {
    expect(
      blueprintVisibilityLevels({ hasIdentityProvider: true }).map((l) => l.value),
    ).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
      ApiResourceVisibility.visibility_platform,
    ]);
  });

  it("confirms a Platform escalation with a blocking dialog that names the audience", () => {
    const platform = blueprintVisibilityLevels({ hasIdentityProvider: true }).find(
      (l) => l.value === ApiResourceVisibility.visibility_platform,
    );
    expect(platform?.confirmDialog?.description).toContain("Every organization managed by your platform");
  });

  it("locks no level — every offered level is self-service", () => {
    for (const level of blueprintVisibilityLevels({ hasIdentityProvider: true })) {
      expect(level.lockedReason, `${level.label} must stay self-service`).toBeUndefined();
    }
  });
});

describe("instanceVisibilityLevels", () => {
  it("offers exactly Private and Organization — instances never take the platform level", () => {
    expect(instanceVisibilityLevels().map((l) => l.value)).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
    ]);
  });

  it("describes the org level in execution terms", () => {
    const org = instanceVisibilityLevels().find(
      (l) => l.value === ApiResourceVisibility.visibility_org,
    );
    expect(org?.description).toContain("executions");
  });
});

describe("the retired public level", () => {
  it("is offered by no level list", () => {
    const offered = [
      ...blueprintVisibilityLevels({ hasIdentityProvider: true }),
      ...instanceVisibilityLevels(),
      ...environmentVisibilityLevels("cloud"),
    ].map((l) => l.value);
    expect(offered).not.toContain(ApiResourceVisibility.visibility_public);
  });

  it("still renders truthfully for a stored value from before the retirement", () => {
    // A row on a server not yet upgraded can carry the level; a badge that
    // fell through to "Private" would lie about who can read the row.
    const option = visibilityOption(ApiResourceVisibility.visibility_public);
    expect(option.label).toBe("Public");
    expect(option.tone).toBe("public");
    expect(option.description).toContain("Retired");
    expect(option.confirmPrompt).toBeUndefined();
    expect(option.confirmDialog).toBeUndefined();
    expect(visibilityLabel(ApiResourceVisibility.visibility_public)).toBe("Public");
  });
});
