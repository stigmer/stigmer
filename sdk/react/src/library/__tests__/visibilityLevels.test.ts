/**
 * The visibility levels each kind's selector offers and the copy they
 * carry: a vault offers Private and Organization only, says that a private
 * vault is used by organization admins and its grantees (grants only where
 * the edition offers them), and confirms before every member may use it.
 */
import { describe, it, expect } from "vitest";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  blueprintVisibilityLevels,
  vaultVisibilityLevels,
} from "../visibilityLevels";

describe("vaultVisibilityLevels", () => {
  it("offers exactly Private and Organization", () => {
    expect(vaultVisibilityLevels().map((l) => l.value)).toEqual([
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
    ]);
  });

  it("never offers child organizations — saved values stay inside the org", () => {
    const values = vaultVisibilityLevels().map((l) => l.value);
    expect(values).not.toContain(ApiResourceVisibility.visibility_child_orgs);
  });

  it("says a private vault is used by admins and grantees, grants where the edition offers them", () => {
    const priv = vaultVisibilityLevels().find(
      (l) => l.value === ApiResourceVisibility.visibility_private,
    );
    expect(priv?.description).toContain("organization admins");
    expect(priv?.description).toContain("people and teams granted access");
    expect(priv?.description).toContain("where this edition offers grants");
  });

  it("confirms before letting every member use the vault", () => {
    const org = vaultVisibilityLevels().find(
      (l) => l.value === ApiResourceVisibility.visibility_org,
    );
    expect(org?.confirmPrompt).toBeTruthy();
    expect(org?.description).toContain("saved values stay hidden");
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

