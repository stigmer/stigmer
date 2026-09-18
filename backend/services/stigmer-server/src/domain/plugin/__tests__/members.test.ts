/**
 * Pins the member rules on plain values, no store: the slug decision
 * (`judgeSlug`) in each of its five arms — free, ours, adopt when system
 * content meets system content, refused for an unmanaged row whenever
 * either side lacks the label, refused for another plugin's member
 * whatever labels either side carries — and the convergence and drop rules
 * over stored and planned members. The same decision through a composed
 * server, with a real authorizer, is plugin.test.ts's.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { droppedMembers, judgeSlug, membersConverge } from "../members.js";
import type { Member, PlannedMember, SlugHolder } from "../members.js";

const DIGEST = "d".repeat(64);
const OURS = "plg_ours";
const OTHER = "plg_other";

function stored(overrides: Partial<Member> = {}): Member {
  return {
    kind: ApiResourceKind.agent,
    id: "agt_1",
    slug: "assistant",
    name: "assistant",
    version: DIGEST,
    system: false,
    ...overrides,
  };
}

function planned(overrides: Partial<PlannedMember> = {}): PlannedMember {
  return {
    kind: ApiResourceKind.agent,
    slug: "assistant",
    name: "assistant",
    system: false,
    ...overrides,
  };
}

function heldBy(
  byPlugin: string | undefined,
  holder: Member = stored(),
): SlugHolder {
  return { held: true, byPlugin, holder };
}

describe("judgeSlug", () => {
  it("is free when nothing holds the slug", () => {
    expect(judgeSlug({ held: false }, planned(), OURS)).toEqual({
      kind: "free",
    });
  });

  it("is ours when this plugin already holds it, whatever the labels", () => {
    const holder = stored({ system: true });
    expect(judgeSlug(heldBy(OURS, holder), planned(), OURS)).toEqual({
      kind: "ours",
      holder,
    });
  });

  it("adopts an unmanaged row only when both sides are system content", () => {
    const holder = stored({ system: true });
    expect(
      judgeSlug(heldBy(undefined, holder), planned({ system: true }), OURS),
    ).toEqual({ kind: "adopt", holder });
  });

  it("refuses an unmanaged row when either side lacks the system label", () => {
    const userRow = stored({ system: false });
    expect(
      judgeSlug(heldBy(undefined, userRow), planned({ system: true }), OURS),
    ).toEqual({ kind: "held-unmanaged", holder: userRow });

    const systemRow = stored({ system: true });
    expect(
      judgeSlug(heldBy(undefined, systemRow), planned({ system: false }), OURS),
    ).toEqual({ kind: "held-unmanaged", holder: systemRow });

    expect(
      judgeSlug(heldBy(undefined, userRow), planned({ system: false }), OURS),
    ).toEqual({ kind: "held-unmanaged", holder: userRow });
  });

  it("never transfers another plugin's member, even system content to system content", () => {
    const holder = stored({ system: true });
    expect(
      judgeSlug(heldBy(OTHER, holder), planned({ system: true }), OURS),
    ).toEqual({ kind: "held-by-plugin", holder, pluginId: OTHER });
  });
});

describe("members: convergence and drops", () => {
  const stored: Member[] = [
    {
      kind: ApiResourceKind.skill,
      id: "skl_1",
      slug: "thermo-review",
      name: "thermo-review",
      version: DIGEST,
      system: false,
    },
    {
      kind: ApiResourceKind.agent,
      id: "agt_1",
      slug: "thermos",
      name: "thermos",
      version: DIGEST,
      system: false,
    },
  ];
  const planned: PlannedMember[] = [
    {
      kind: ApiResourceKind.skill,
      slug: "thermo-review",
      name: "thermo-review",
      system: false,
    },
    {
      kind: ApiResourceKind.agent,
      slug: "thermos",
      name: "thermos",
      system: false,
    },
  ];

  it("converges only when every planned member is present and stamped with the digest", () => {
    expect(membersConverge(stored, planned, DIGEST)).toBe(true);
    expect(membersConverge(stored, planned, "e".repeat(64))).toBe(false);
    expect(membersConverge(stored.slice(1), planned, DIGEST)).toBe(false);
    expect(
      membersConverge(
        [...stored, { ...stored[0]!, slug: "extra", id: "skl_2" }],
        planned,
        DIGEST,
      ),
    ).toBe(false);
  });

  it("drops the members the plan no longer names", () => {
    expect(droppedMembers(stored, planned.slice(1)).map((m) => m.slug)).toEqual(
      ["thermo-review"],
    );
    expect(droppedMembers(stored, planned)).toEqual([]);
  });
});
