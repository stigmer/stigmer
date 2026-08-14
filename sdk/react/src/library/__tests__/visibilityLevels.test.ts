import { describe, it, expect } from "vitest";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  blueprintVisibilityLevels,
  environmentVisibilityLevels,
  instanceVisibilityLevels,
  PUBLIC_LOCKED_REASON,
  type VisibilityLevelOption,
} from "../visibilityLevels";

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

describe("operator-gated PUBLIC level", () => {
  const publicOf = (levels: readonly VisibilityLevelOption[]) =>
    levels.find((l) => l.value === ApiResourceVisibility.visibility_public);

  it("locks Public with the platform-team copy when the caller may not publish", () => {
    const blueprint = publicOf(
      blueprintVisibilityLevels({
        deploymentMode: "cloud",
        hasIdentityProvider: false,
        canSetPublicVisibility: false,
      }),
    );
    const instance = publicOf(
      instanceVisibilityLevels({ canSetPublicVisibility: false }),
    );

    expect(blueprint?.lockedReason).toBe(PUBLIC_LOCKED_REASON);
    expect(instance?.lockedReason).toBe(PUBLIC_LOCKED_REASON);
  });

  it("offers Public unlocked for callers with the publish grant", () => {
    const blueprint = publicOf(
      blueprintVisibilityLevels({
        deploymentMode: "cloud",
        hasIdentityProvider: true,
        canSetPublicVisibility: true,
      }),
    );
    const instance = publicOf(
      instanceVisibilityLevels({ canSetPublicVisibility: true }),
    );

    expect(blueprint?.lockedReason).toBeUndefined();
    expect(instance?.lockedReason).toBeUndefined();
  });

  it("never locks any level below Public — org/platform sharing stays self-service", () => {
    const levels = blueprintVisibilityLevels({
      deploymentMode: "cloud",
      hasIdentityProvider: true,
      canSetPublicVisibility: false,
    });
    for (const level of levels) {
      if (level.value === ApiResourceVisibility.visibility_public) continue;
      expect(level.lockedReason, `${level.label} must stay self-service`).toBeUndefined();
    }
  });

  it("keeps the instance Public row's execution-oriented description when locked", () => {
    // The lock replaces the rendered detail line, but the option data keeps
    // its identity (label, tone, confirmation) so an unlock is a pure
    // context change.
    const instance = publicOf(
      instanceVisibilityLevels({ canSetPublicVisibility: false }),
    );
    expect(instance?.lockedReason).toBe(PUBLIC_LOCKED_REASON);
    expect(instance?.confirmDialog).toBeDefined();
  });
});
