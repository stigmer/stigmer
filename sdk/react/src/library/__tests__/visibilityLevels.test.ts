import { describe, it, expect } from "vitest";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  blueprintVisibilityLevels,
  environmentVisibilityLevels,
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

  it("never offers child organizations — secrets stay inside the org", () => {
    for (const mode of ["cloud", "local"] as const) {
      const values = environmentVisibilityLevels(mode).map((l) => l.value);
      expect(values).not.toContain(ApiResourceVisibility.visibility_child_orgs);
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
  it("offers Private and Organization when child organizations are not offered (a child, or a single-organization server)", () => {
    expect(
      blueprintVisibilityLevels({ offersChildOrgs: false }).map((l) => l.value),
    ).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
    ]);
  });

  it("adds Child organizations, and only it, when the owning organization may share with children", () => {
    expect(
      blueprintVisibilityLevels({ offersChildOrgs: true }).map((l) => l.value),
    ).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
      ApiResourceVisibility.visibility_child_orgs,
    ]);
  });

  it("confirms a Child organizations escalation with a blocking dialog that names the audience", () => {
    const childOrgs = blueprintVisibilityLevels({ offersChildOrgs: true }).find(
      (l) => l.value === ApiResourceVisibility.visibility_child_orgs,
    );
    expect(childOrgs?.confirmDialog?.description).toContain("Everyone in every child organization");
  });

  it("locks no level — every offered level is self-service", () => {
    for (const level of blueprintVisibilityLevels({ offersChildOrgs: true })) {
      expect(level.lockedReason, `${level.label} must stay self-service`).toBeUndefined();
    }
  });
});

describe("the retired public level", () => {
  it("is offered by no level list", () => {
    const offered = [
      ...blueprintVisibilityLevels({ offersChildOrgs: true }),
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
