import { describe, it, expect } from "vitest";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  blueprintVisibilityLevels,
  visibilityLabel,
  visibilityOption,
} from "../visibilityLevels";

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
