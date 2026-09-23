/**
 * Pins `supportsVisibility` and `supportedVisibilityLevels`
 * (pipeline/apiresource-meta.ts), the one predicate behind the
 * ValidateVisibility doors on every create and updateVisibility chain.
 *
 * The retired public level is the reason this file exists: no kind config
 * declares it any more, so the predicate cannot read a flag for it and must
 * answer from its own text. The first test walks EVERY kind that has
 * `kind_meta` and asserts the level is refused; the door is one function,
 * and this is the pin that it holds for kinds nobody thought to try. The
 * rest of the file pins the levels that remain against the proto's
 * declarations for the kinds whose configs differ (a blueprint, an
 * instance, an org-only kind, a kind with no config), and the copy fragment
 * both editions build the INVALID_ARGUMENT sentence from.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import {
  getKindMeta,
  supportedVisibilityLevels,
  supportsVisibility,
} from "../apiresource-meta.js";

const V = ApiResourceVisibility;

/** Every enum member that carries kind_meta (the unknown kind does not). */
const KINDS_WITH_META: ApiResourceKind[] = Object.values(ApiResourceKind)
  .filter((value): value is ApiResourceKind => typeof value === "number")
  .filter((kind) => {
    try {
      getKindMeta(kind);
      return true;
    } catch {
      return false;
    }
  });

describe("supportsVisibility", () => {
  it("refuses the retired public level for every kind", () => {
    expect(KINDS_WITH_META.length).toBeGreaterThan(20);
    for (const kind of KINDS_WITH_META) {
      expect(supportsVisibility(kind, V.visibility_public)).toBe(false);
    }
  });

  it("private and unspecified are supported by every kind", () => {
    for (const kind of KINDS_WITH_META) {
      expect(supportsVisibility(kind, V.visibility_private)).toBe(true);
      expect(
        supportsVisibility(kind, V.api_resource_visibility_unspecified),
      ).toBe(true);
    }
  });

  it("a blueprint kind holds org and platform", () => {
    expect(supportsVisibility(ApiResourceKind.agent, V.visibility_org)).toBe(
      true,
    );
    expect(
      supportsVisibility(ApiResourceKind.agent, V.visibility_platform),
    ).toBe(true);
  });

  it("an instance kind holds org but never platform (tenant isolation)", () => {
    expect(
      supportsVisibility(ApiResourceKind.agent_instance, V.visibility_org),
    ).toBe(true);
    expect(
      supportsVisibility(ApiResourceKind.agent_instance, V.visibility_platform),
    ).toBe(false);
  });

  it("an org-only kind holds org alone (environment: secrets never cross the org)", () => {
    expect(
      supportsVisibility(ApiResourceKind.environment, V.visibility_org),
    ).toBe(true);
    expect(
      supportsVisibility(ApiResourceKind.environment, V.visibility_platform),
    ).toBe(false);
  });

  it("a kind with no visibility config is private-only", () => {
    expect(supportsVisibility(ApiResourceKind.session, V.visibility_org)).toBe(
      false,
    );
    expect(
      supportsVisibility(ApiResourceKind.session, V.visibility_platform),
    ).toBe(false);
  });
});

describe("supportedVisibilityLevels (the copy fragment)", () => {
  it("names the levels that remain, private first, never the retired one", () => {
    expect(supportedVisibilityLevels(ApiResourceKind.agent)).toBe(
      "visibility_private, visibility_org, visibility_platform",
    );
    expect(supportedVisibilityLevels(ApiResourceKind.agent_instance)).toBe(
      "visibility_private, visibility_org",
    );
    expect(supportedVisibilityLevels(ApiResourceKind.session)).toBe(
      "visibility_private",
    );
    for (const kind of KINDS_WITH_META) {
      expect(supportedVisibilityLevels(kind)).not.toContain(
        "visibility_public",
      );
    }
  });
});
